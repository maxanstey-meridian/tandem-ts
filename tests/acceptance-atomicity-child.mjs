import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { agent, capability, output, pipeline, route, run } from "../dist/index.js";
import {
  startFakeOpenAi,
  writeChatCompletion,
  writeModels,
  writeResponse,
} from "./support/fake-openai.mjs";

const mode = process.argv[2];
const capabilityMode = mode.startsWith("capability");
const jsonLossMode = mode.endsWith("json");
const directory = mkdtempSync(join(tmpdir(), "tandem-atomicity-"));
const ledgerPath = join(directory, "ledger.sqlite3");
const server = await startFakeOpenAi(({ url }, response) => {
  if (url === "/v1/models") return writeModels(response, "gpt-5.6-sol");
  if (!capabilityMode) return writeResponse(response, JSON.stringify({ answer: 42 }));
  writeChatCompletion(response, {
    toolCall: {
      name: "submit_implementation",
      arguments: { implementation: "(input) => input", rationale: "Identity." },
    },
  });
});

const State = z.object({ value: z.number() });
let applyCalled = false;
const submit = capability({
  name: "submit_implementation",
  instructions: "Submit the implementation.",
  schema: z.object({ implementation: z.string(), rationale: z.string() }),
  apply: () => {
    applyCalled = true;
    if (jsonLossMode) {
      return { value: Number.NaN };
    }
    throw new Error("apply failed after durable acceptance");
  },
  summarize: ({ rationale }) => rationale,
});
const worker = agent({
  id: "worker",
  instructions: "Return a value.",
  client: {
    kind: "openai-compatible",
    version: 1,
    endpoint: server.url,
    model: capabilityMode ? "fixture-ds4" : "gpt-5.6-sol",
    wireApi: capabilityMode ? "completions" : "responses",
  },
  message: () => "work",
  capabilities: capabilityMode ? [submit] : [],
  output: !capabilityMode
    ? {
        instructions: "Return the answer.",
        schema: z.object({ answer: z.number() }),
        apply: () => {
          applyCalled = true;
          if (jsonLossMode) {
            return { value: Number.NaN };
          }
          throw new Error("apply failed after durable acceptance");
        },
      }
    : undefined,
  persist: true,
});
const done = output({ id: "done", summary: () => "done" });
const failed = output({ id: "failed", failed: true, summary: () => "failed" });
const graph = pipeline({
  name: `atomic-${mode}`,
  state: State,
  nodes: [worker, done, failed],
  start: worker,
  routes: [
    route({ from: worker, to: done, outcome: "success", label: "done" }),
    route({ from: worker, to: failed, outcome: "failed", label: "failed" }),
  ],
  outputs: [done, failed],
  persist: true,
});

try {
  let error = null;
  let succeeded = null;
  try {
    succeeded = (await run(graph, { value: 0 }, { ledgerPath })).succeeded;
  } catch (caught) {
    error = String(caught);
  }
  const db = new DatabaseSync(ledgerPath, { readOnly: true });
  const entries = db.prepare("select payload from run_entries order by sequence").all();
  db.close();
  const records = entries.map(({ payload }) => JSON.parse(Buffer.from(payload).toString("utf8")));
  console.log(
    JSON.stringify({
      error,
      succeeded,
      applyCalled,
      persistedAcceptance: records.some(({ kind }) => kind === (capabilityMode ? 13 : 12)),
    }),
  );
} finally {
  await server.close();
  if (server.requests.length === 0) {
    process.exitCode = 1;
  }
  rmSync(directory, { recursive: true, force: true });
}
