import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { agent, inspectAccepted, output, parallel, pipeline, route, run, stage } from "../dist/index.js";

const directory = mkdtempSync(join(tmpdir(), "tandem-concurrent-ledger-"));
const ledgerPath = join(directory, "runs.sqlite3");
const server = createServer(async (request, response) => {
  for await (const _chunk of request) {}
  response.writeHead(200, { "content-type": "text/event-stream" });
  const chunk = { id: "test", object: "chat.completion.chunk", created: 1, model: "test" };
  response.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: '{"value":1}' }, finish_reason: null }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`);
  response.end("data: [DONE]\n\n");
});
server.listen(0, "127.0.0.1");
await once(server, "listening");

try {
  const ChildState = z.object({ value: z.number() });
  const childAgent = agent({
    id: "answer", instructions: "Return a value.",
    client: { kind: "openai-compatible", version: 1, endpoint: `http://127.0.0.1:${server.address().port}/v1`, model: "test", wireApi: "completions", verifyModel: false, maxAttempts: 1 },
    message: () => "Return one.",
    output: { instructions: "Return JSON.", schema: ChildState, apply: (_state, value) => value },
  });
  const childDone = output({ id: "done", summary: () => "done" });
  const child = pipeline({ name: "concurrent-child", state: ChildState, start: childAgent, nodes: [childAgent, childDone], outputs: [childDone], routes: [route({ from: childAgent, to: childDone, outcome: "success", label: "done" })], persist: true });
  const childRunIds = [];
  const group = parallel({
    id: "children", max: 6,
    branches: Object.fromEntries(Array.from({ length: 8 }, (_, index) => [String(index), stage({
      id: `child-${index}`,
      execute: async (_state, { signal }) => {
        const result = await run(child, { value: 0 }, { signal, ledgerPath });
        assert.equal(result.succeeded, true);
        childRunIds.push(result.runId);
        return { values: [result.state.value] };
      },
    })])),
    merge: (_baseline, results) => ({ values: Object.values(results).flatMap(result => result.values) }),
  });
  const done = output({ id: "done", summary: () => "done" });
  const parent = pipeline({ name: "concurrent-parent", state: z.object({ values: z.array(z.number()) }), start: group, nodes: [group, done], outputs: [done], routes: [route({ from: group, to: done, outcome: "success", label: "done" })], persist: true });
  const results = await Promise.all([run(parent, { values: [] }, { ledgerPath }), run(parent, { values: [] }, { ledgerPath })]);
  for (const result of results) {
    assert.equal(result.succeeded, true);
    assert.deepEqual(result.state.values, Array(8).fill(1));
  }
  assert.equal(childRunIds.length, 16);
  for (const runId of [...results.map(result => result.runId), ...childRunIds]) {
    assert.ok((await inspectAccepted({ ledgerPath, runId })).length > 0);
  }
  console.log(JSON.stringify({ parents: results.length, children: childRunIds.length }));
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  rmSync(directory, { recursive: true, force: true });
}
