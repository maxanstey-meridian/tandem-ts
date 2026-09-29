import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  agent,
  agentTools,
  agentWorkspace,
  output,
  parallel,
  pipeline,
  route,
  run,
  stage,
} from "../dist/index.js";
import { startFakeOpenAi, writeModels, writeResponse } from "./support/fake-openai.mjs";

const directory = mkdtempSync(join(tmpdir(), "tandem-parallel-agent-"));
const server = await startFakeOpenAi(({ url }, response) =>
  url === "/v1/models"
    ? writeModels(response, "gpt-5.6-sol")
    : writeResponse(response, JSON.stringify({ answer: 42 })),
);

const State = z.object({
  values: z.array(z.string()),
  workspacePath: z.string(),
  mutationAuthorized: z.boolean(),
});
const workspace = agentWorkspace({
  path: (state) => state.workspacePath,
  commands: [{ name: "run_tests", description: "Run tests.", command: "printf tested" }],
});
const worker = agent({
  id: "worker",
  instructions: "Return the numeric answer.",
  client: {
    kind: "openai-compatible",
    version: 1,
    endpoint: server.url,
    model: "gpt-5.6-sol",
    wireApi: "responses",
  },
  reasoning: { effort: "none" },
  message: () => "Return the answer.",
  temperature: 0,
  maxOutputTokens: 2048,
  workspace: workspace.withTools([
    agentTools.always("read_file", "git:ro", workspace.commands),
    agentTools.when((state) => state.mutationAuthorized, "write_file"),
  ]),
  output: {
    instructions: "Return the numeric answer.",
    schema: z.object({ answer: z.number() }),
    apply: (state, value) => ({ ...state, values: [...state.values, `agent:${value.answer}`] }),
  },
});
const local = stage({
  id: "local",
  execute: (state) => ({ ...state, values: [...state.values, "stage"] }),
});
const concurrent = parallel({
  id: "concurrent",
  branches: { worker, local },
  merge: (baseline, results) => ({
    ...baseline,
    values: [...baseline.values, ...results.worker.values, ...results.local.values],
  }),
});
const done = output({ id: "done", summary: (state) => state.values.join(",") });
const graph = pipeline({
  name: "parallel-agent",
  state: State,
  nodes: [concurrent, done],
  start: concurrent,
  routes: [route({ from: concurrent, outcome: "success", to: done, label: "done" })],
  outputs: [done],
});

try {
  const result = await run(graph, {
    values: [],
    workspacePath: directory,
    mutationAuthorized: false,
  });
  const modelRequest = server.requests.find((request) => request.url === "/v1/responses");
  console.log(
    JSON.stringify({
      values: result.state.values,
      modelBody: modelRequest.body,
      tools: modelRequest.body.tools.map((tool) => tool.name ?? tool.function?.name),
    }),
  );
} finally {
  await server.close();
  rmSync(directory, { recursive: true, force: true });
}
