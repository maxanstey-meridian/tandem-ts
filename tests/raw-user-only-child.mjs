import assert from "node:assert/strict";
import { z } from "zod";
import { agent, output, pipeline, route, run } from "../dist/index.js";
import { startFakeOpenAi, writeChatCompletion } from "./support/fake-openai.mjs";

const server = await startFakeOpenAi((_request, response) =>
  writeChatCompletion(response, { content: "accepted" }),
);
try {
  const raw = agent({
    id: "raw",
    instructions: "",
    client: {
      kind: "openai-compatible",
      version: 1,
      endpoint: server.url,
      model: "test",
      wireApi: "completions",
      verifyModel: false,
      maxAttempts: 1,
    },
    message: (state) => state.text,
    output: { raw: true, instructions: "", parse: (text) => text, apply: (_, text) => ({ text }) },
  });
  const done = output({ id: "done", summary: (state) => state.text });
  const graph = pipeline({
    name: "user-only",
    state: z.object({ text: z.string() }),
    start: raw,
    nodes: [raw, done],
    outputs: [done],
    routes: [route({ from: raw, to: done, outcome: "success", label: "accepted" })],
  });
  const text = "Mr. Burns won by 0.2 seconds.";
  const result = await run(graph, { text });
  assert.equal(result.succeeded, true);
  assert.equal(result.state.text, "accepted");
  const [{ body }] = server.requests;
  assert.deepEqual(body.messages, [{ role: "user", content: text }]);
  assert.equal(body.response_format, undefined);
  console.log("user-only raw output passed");
} finally {
  await server.close();
}
