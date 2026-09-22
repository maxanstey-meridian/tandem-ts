import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  collection,
  taskAgent,
  output,
  pipeline,
  route,
  run,
  inspectPipeline,
  inspectAccepted,
} from "../dist/index.js";
const mode = process.argv[2] ?? "agents";
const State = z.object({ values: z.array(z.string()) });
type State = z.infer<typeof State>;
import type { CollectionContext, TaskAgent } from "../dist/index.js";
const typeCheck = (context: CollectionContext, agent: TaskAgent<string, string>) => {
  // @ts-expect-error a numeric input cannot widen the declared string input
  void context.run(agent, 12);
};
void typeCheck;
const directory = await mkdtemp(join(tmpdir(), "tandem-collection-"));
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const text = body.messages.findLast(
    (message: { role: string }) => message.role === "user",
  ).content;
  response.writeHead(200, { "content-type": "text/event-stream" });
  const chunk = { id: "test", object: "chat.completion.chunk", created: 1, model: "test" };
  response.write(
    `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: mode === "invalid-agent-result" ? "" : text + "!" }, finish_reason: null }] })}\n\n`,
  );
  response.write(
    `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
  );
  response.end("data: [DONE]\n\n");
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
try {
  const address = server.address();
  assert(address && typeof address !== "string");
  const rewrite = taskAgent({
    id: "rewrite",
    instructions: "",
    input: z.string(),
    result: z.string().min(1),
    client: {
      kind: "openai-compatible",
      version: 1,
      endpoint: `http://127.0.0.1:${address.port}/v1`,
      model: "test",
      wireApi: "completions",
      verifyModel: false,
      maxAttempts: 1,
    },
    message: (text) => text,
    output: { raw: true, instructions: "", parse: (text) => text },
  });
  const controller = new AbortController();
  let entered = 0,
    active = 0,
    peak = 0,
    applied = 0;
  let savedContext: CollectionContext | undefined;
  const canonicalise = collection<State, string, string>({
    id: "canonicalise",
    item: z.string(),
    result: z.string(),
    agents: [rewrite],
    max: 3,
    items: (state) => state.values,
    execute: async (item, context) => {
      savedContext = context;
      entered++;
      peak = Math.max(peak, ++active);
      try {
        if (mode === "cancel" && entered === 3) controller.abort();
        if (mode === "failure" && item === "0") throw new Error("item failed");
        await delay(item === "0" ? 80 : 5, undefined, { signal: context.signal });
        if (mode === "undeclared") {
          const undeclared = taskAgent({
            id: "other",
            input: z.string(),
            result: z.string(),
            client: {
              kind: "openai-compatible",
              version: 1,
              endpoint: "http://127.0.0.1:1/v1",
              model: "test",
              wireApi: "completions",
            },
            instructions: "",
            message: (text) => text,
            output: { raw: true, instructions: "", parse: (text) => text },
          });
          return context.run(undeclared, item);
        }
        if (mode === "invalid-result") return 42 as unknown as string;
        return ["agents", "invalid-agent-result", "concurrent", "escaped"].includes(mode)
          ? await context.run(rewrite, item)
          : item + "!";
      } finally {
        active--;
      }
    },
    apply: (_, values) => {
      applied++;
      return { values: mode === "invalid-merge" ? [42 as unknown as string] : [...values] };
    },
  });
  const recover = collection<State, string, string>({
    id: "recover",
    item: z.string(),
    result: z.string(),
    agents: [rewrite],
    max: 3,
    items: (state) => state.values,
    execute: (claim, context) => (claim.startsWith("1") ? context.run(rewrite, claim) : claim),
    apply: (_, values) => ({ values: [...values] }),
  });
  const done = output<State>({ id: "done", summary: () => "done" });
  const graph = pipeline({
    name: "collection-example",
    state: State,
    start: canonicalise,
    nodes: [canonicalise, recover, done],
    routes: [
      route({ from: canonicalise, to: recover, label: "canonicalised" }),
      route({ from: recover, to: done, label: "resolved" }),
    ],
    outputs: [done],
    persist: mode === "agents" || mode === "concurrent",
  });
  const values = Array.from({ length: mode === "empty" ? 0 : mode === "single" ? 1 : 9 }, (_, i) =>
    String(i),
  );
  const ledgerPath = join(directory, "ledger.sqlite");
  const observations: import("../dist/index.js").RunObservation[] = [];
  if (mode.startsWith("invalid-") || mode === "undeclared") {
    await assert.rejects(run(graph, { values }, { ledgerPath }), /validation|declared|output/i);
    assert.equal(active, 0);
    assert.equal(applied, mode === "invalid-merge" ? 1 : 0);
  } else if (mode === "concurrent") {
    const results = await Promise.all([
      run(graph, { values: ["a", "1a"] }, { ledgerPath }),
      run(graph, { values: ["b", "1b"] }, { ledgerPath }),
    ]);
    assert.deepEqual(
      results.map((result) => result.state.values),
      [
        ["a!", "1a!!"],
        ["b!", "1b!!"],
      ],
    );
    for (const result of results) {
      const accepted = await inspectAccepted({ ledgerPath, runId: result.runId });
      assert.equal(accepted.filter((value) => value.kind === "StructuredOutputAccepted").length, 3);
    }
  } else if (mode === "cancel" || mode === "failure") {
    await assert.rejects(
      run(graph, { values }, { signal: controller.signal }),
      mode === "cancel" ? /cancel|abort/i : /item failed/,
    );
    assert.equal(active, 0);
    assert.equal(applied, 0);
    assert(entered <= 3);
  } else {
    const result = await run(
      graph,
      { values },
      {
        ledgerPath,
        observe: (event) => {
          observations.push(event);
        },
      },
    );
    assert.deepEqual(
      result.state.values,
      values.map((value) => (value === "1" ? "1!!" : value + "!")),
    );
    assert.equal(peak, Math.min(values.length, 3));
    assert.equal(applied, 1);
    if (mode === "escaped") {
      assert(savedContext);
      await assert.rejects(savedContext.run(rewrite, "late"), /ended/);
    }
    assert.equal(inspectPipeline(graph).nodes[0]?.kind, "collection");
    if (mode === "agents") {
      const accepted = await inspectAccepted({ ledgerPath, runId: result.runId });
      assert.equal(
        accepted.filter((value) => value.kind === "StructuredOutputAccepted").length,
        10,
      );
      assert(accepted.some((value) => value.stepId === "recover/rewrite"));
      const outputs = accepted.filter((value) => value.kind === "StructuredOutputAccepted");
      assert(outputs.every((value) => typeof value.visitId === "string"));
      assert.equal(new Set(outputs.map((value) => value.visitId)).size, 10);
      const starts = observations.filter((event) => event.kind === "stepStarted" && event.visitId);
      const finishes = observations.filter(
        (event) => event.kind === "stepCompleted" && event.visitId,
      );
      assert.equal(starts.length, 10);
      assert.deepEqual(
        new Set(finishes.map((event) => event.visitId)),
        new Set(starts.map((event) => event.visitId)),
      );
      assert.deepEqual(
        new Set(outputs.map((value) => value.visitId)),
        new Set(starts.map((event) => event.visitId)),
      );
    }
  }
  console.log("passed");
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
}
