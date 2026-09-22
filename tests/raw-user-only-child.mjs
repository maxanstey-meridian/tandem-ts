import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { z } from "zod";
import { agent, output, pipeline, route, run } from "../dist/index.js";

let captured;
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  captured = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  response.writeHead(200, { "content-type": "text/event-stream" });
  const chunk = { id: "test", object: "chat.completion.chunk", created: 1, model: "test" };
  response.write(
    `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: "accepted" }, finish_reason: null }] })}\n\n`,
  );
  response.write(
    `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
  );
  response.end("data: [DONE]\n\n");
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
try {
  const raw = agent({
    id: "raw",
    instructions: "",
    client: {
      kind: "openai-compatible",
      version: 1,
      endpoint: `http://127.0.0.1:${server.address().port}/v1`,
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
  assert.deepEqual(captured.messages, [{ role: "user", content: text }]);
  assert.equal(captured.response_format, undefined);
  console.log("user-only raw output passed");
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
