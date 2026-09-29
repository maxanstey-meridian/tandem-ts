import { z } from "zod";
import { agent, capability, output, pipeline, route, run } from "../dist/index.js";
import { startFakeOpenAi, writeChatCompletion, writeModels } from "./support/fake-openai.mjs";

const terminalPresentation = process.argv[2] === "terminal";
const server = await startFakeOpenAi(({ url }, response) =>
  url === "/v1/models"
    ? writeModels(response, "fixture")
    : writeChatCompletion(response, { toolCall: { name: "accept", arguments: { accepted: true } } }),
);

const State = z.object({ prompt: z.string(), accepted: z.boolean() });
let contextualValidations = 0;
let applications = 0;
const accept = capability({
  name: "accept",
  instructions: "Accept the request.",
  schema: z.object({ accepted: z.boolean() }),
  validateFor: () => {
    contextualValidations += 1;
    return contextualValidations === 1
      ? [{ path: "$.accepted", message: "Confirm acceptance once." }]
      : [];
  },
  apply: (state, request) => {
    applications += 1;
    return { ...state, accepted: request.accepted };
  },
  summarize: () => "accepted",
});
const reject = capability({
  name: "reject",
  instructions: "Reject the request with a reason.",
  schema: z.object({ reason: z.string() }),
  apply: (state) => ({ ...state, accepted: false }),
  summarize: (request) => request.reason,
});
const executor = agent({
  id: "executor",
  instructions: "Use a declared capability or return structured output.",
  client: {
    kind: "openai-compatible",
    version: 1,
    endpoint: server.url,
    model: "fixture",
    wireApi: "completions",
  },
  reasoning: { effort: "none" },
  message: (state) => `CAPABILITY STATE MESSAGE: ${state.prompt}`,
  temperature: 0,
  maxOutputTokens: 1024,
  capabilities: [accept, reject],
  output: {
    instructions: "Return whether the request was accepted.",
    schema: z.object({ accepted: z.boolean() }),
    apply: (state, value) => ({ ...state, accepted: value.accepted }),
  },
  continueSession: true,
  timeoutMs: 5000,
});
const done = output({ id: "done", summary: () => "done" });
const graph = pipeline({
  name: "capability-message",
  state: State,
  nodes: [executor, done],
  start: executor,
  routes: [route({ from: executor, to: done, outcome: "success", label: "accepted" })],
  outputs: [done],
});

try {
  let accepted = null;
  let error = null;
  try {
    accepted = (
      await run(
        graph,
        { prompt: "from-typescript-capability-state", accepted: false },
        {
          presentation: terminalPresentation ? "terminal" : undefined,
          terminal: terminalPresentation ? { truncatedToolNames: ["accept"] } : undefined,
        },
      )
    ).state.accepted;
  } catch (caught) {
    error = String(caught);
  }
  const bodies = server.requests
    .filter((item) => item.url === "/v1/chat/completions")
    .map((item) => item.body);
  console.log(
    JSON.stringify({ accepted, error, body: bodies[0], contextualValidations, applications, bodies }),
  );
} finally {
  await server.close();
}
