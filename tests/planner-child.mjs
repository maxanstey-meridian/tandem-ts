import { z } from "zod";
import { agent, output, pipeline, route, run } from "../dist/index.js";
import {
  startFakeOpenAi,
  writeModels,
  writeNotFound,
  writeResponse,
} from "./support/fake-openai.mjs";

const server = await startFakeOpenAi(({ url }, response) => {
  if (url === "/v1/models") return writeModels(response, "gpt-5.6-sol");
  if (url === "/v1/responses") return writeResponse(response, JSON.stringify({ answer: 42 }));
  writeNotFound(response);
});

const State = z.object({ prompt: z.string(), answer: z.number().nullable() });
let contextualValidations = 0;
let applications = 0;
const planner = agent({
  id: "planner",
  instructions: "Return a structured answer.",
  client: {
    kind: "openai-compatible",
    version: 1,
    endpoint: server.url,
    model: "gpt-5.6-sol",
    wireApi: "responses",
    verifyModel: true,
  },
  reasoning: { effort: "none" },
  message: (state) => `STATE MESSAGE: ${state.prompt}`,
  temperature: 0,
  maxOutputTokens: 4096,
  output: {
    instructions: "Return the numeric answer.",
    schema: z.object({ answer: z.number() }),
    validateFor: (_state, value) => {
      contextualValidations += 1;
      return contextualValidations === 1
        ? [{ path: "$.answer", message: `${value.answer} needs confirmation` }]
        : [];
    },
    apply: (state, value) => {
      applications += 1;
      return { ...state, answer: value.answer };
    },
  },
});
const done = output({ id: "done", summary: (state) => String(state.answer) });
const graph = pipeline({
  name: "planner-fixture",
  state: State,
  nodes: [planner, done],
  start: planner,
  routes: [route({ from: planner, to: done, outcome: "success", label: "accepted" })],
  outputs: [done],
});

try {
  let answer = null;
  let error = null;
  const observations = [];
  try {
    answer = (
      await run(
        graph,
        { prompt: "from-typescript-state", answer: null },
        {
          observe: (event) => {
            observations.push(event);
          },
        },
      )
    ).state.answer;
  } catch (caught) {
    error = String(caught);
  }
  const modelRequests = server.requests.filter((item) => item.url === "/v1/responses");
  console.log(
    JSON.stringify({
      answer,
      error,
      urls: server.requests.map((item) => item.url),
      modelBody: modelRequests[0]?.body,
      modelBodies: modelRequests.map((item) => item.body),
      contextualValidations,
      applications,
      observations,
    }),
  );
} finally {
  await server.close();
}
