import { once } from "node:events";
import { createServer } from "node:http";

// msw cannot intercept the .NET HTTP client, so the fixtures are real local servers.
/** @param {(request: { url: string, body: ReturnType<typeof JSON.parse> }, response: import("node:http").ServerResponse) => unknown} respond */
export const startFakeOpenAi = async (respond) => {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
    const received = { url: request.url, body };
    requests.push(received);
    await respond(received, response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
};

let sequence = 0;
const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };

export const writeModels = (response, model) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      object: "list",
      data: [{ id: model, object: "model", created: 0, owned_by: "local" }],
    }),
  );
};

export const writeNotFound = (response) => {
  response.writeHead(404, { "content-type": "application/json" });
  response.end("{}");
};

export const writeChatCompletion = (response, reply) => {
  const id = `chat_${++sequence}`;
  const frame = (payload) =>
    response.write(
      `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model: "fixture", ...payload })}\n\n`,
    );
  const delta =
    "toolCall" in reply
      ? {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `call_${sequence}`,
              type: "function",
              function: {
                name: reply.toolCall.name,
                arguments: JSON.stringify(reply.toolCall.arguments),
              },
            },
          ],
        }
      : { role: "assistant", content: reply.content };
  response.writeHead(200, { "content-type": "text/event-stream" });
  frame({ choices: [{ index: 0, delta, finish_reason: null }] });
  frame({
    choices: [{ index: 0, delta: {}, finish_reason: "toolCall" in reply ? "tool_calls" : "stop" }],
  });
  frame({ choices: [], usage });
  response.end("data: [DONE]\n\n");
};

export const writeResponse = (response, text) => {
  sequence += 1;
  const item = {
    id: `msg_${sequence}`,
    type: "message",
    status: "completed",
    role: "assistant",
    content: [{ type: "output_text", text, annotations: [] }],
  };
  const part = item.content[0];
  const completed = {
    id: `resp_${sequence}`,
    object: "response",
    created_at: sequence,
    status: "completed",
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    model: "gpt-5.6-sol",
    output: [item],
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: { effort: "low", summary: null },
    store: false,
    temperature: 1,
    text: { format: { type: "text" } },
    tool_choice: "auto",
    tools: [],
    top_p: 1,
    truncation: "disabled",
    usage: {
      input_tokens: 1,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 1,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 2,
    },
    user: null,
    metadata: {},
  };
  const textEvent = { item_id: item.id, output_index: 0, content_index: 0 };
  const event = (type, data) =>
    response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  response.writeHead(200, { "content-type": "text/event-stream" });
  event("response.created", { response: { ...completed, status: "in_progress", output: [] } });
  event("response.output_item.added", {
    output_index: 0,
    item: { ...item, status: "in_progress", content: [] },
  });
  event("response.content_part.added", { ...textEvent, part: { ...part, text: "" } });
  event("response.output_text.delta", { ...textEvent, delta: text });
  event("response.output_text.done", { ...textEvent, text });
  event("response.content_part.done", { ...textEvent, part });
  event("response.output_item.done", { output_index: 0, item });
  event("response.completed", { response: completed });
  response.end();
};
