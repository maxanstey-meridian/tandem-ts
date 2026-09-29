import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  agent,
  output,
  pipeline,
  route,
  run,
  inspectAccepted,
} from "../dist/index.js";
import { startFakeOpenAi, writeChatCompletion } from "./support/fake-openai.mjs";

const directory = await mkdtemp(join(tmpdir(), "tandem-ledger-tools-"));
const server = await startFakeOpenAi((_request, response) =>
  writeChatCompletion(response, { content: "Done." }),
);
try {
  const probe = agent({
    id: "probe",
    instructions: "Respond briefly.",
    message: () => "Hello",
    client: {
      kind: "openai-compatible",
      version: 1,
      endpoint: server.url,
      model: "fixture",
      wireApi: "completions",
      verifyModel: false,
    },
  });
  const done = output({ id: "done", summary: () => "Done" });
  const graph = pipeline({
    name: "ledger-tools",
    state: z.object({}),
    nodes: [probe, done],
    start: probe,
    routes: [route({ from: probe, to: done, outcome: "success", label: "done" })],
    outputs: [done],
    persist: true,
  });
  const options = { ledgerPath: join(directory, "ledger.sqlite3") };
  if (process.argv[2] === "enabled") {
    options.enableLedgerTools = true;
  }
  const result = await run(graph, {}, options);
  const accepted = await inspectAccepted({ ledgerPath: options.ledgerPath, runId: result.runId });
  console.log(
    JSON.stringify({
      succeeded: result.succeeded,
      tools: server.requests.flatMap(({ body }) => (body.tools ?? []).map((tool) => tool.function.name)),
      persisted: accepted.length > 0,
    }),
  );
} finally {
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
