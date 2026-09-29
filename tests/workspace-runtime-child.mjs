import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { agent, agentTools, agentWorkspace, output, pipeline, route, run } from "../dist/index.js";
import { startFakeOpenAi, writeChatCompletion, writeModels } from "./support/fake-openai.mjs";

const directory = mkdtempSync(join(tmpdir(), "tandem-workspace-runtime-"));
const mode = process.argv[2] ?? "execute";
const hostileArgument = "spaces ' \" $() `touch marker` ; New-Item marker ; && || | > <\n* $HOME";
const server = await startFakeOpenAi(({ url, body }, response) => {
  if (url === "/v1/models") return writeModels(response, "gpt-5.6-sol");
  if (body.messages.some((message) => message.role === "tool")) {
    return writeChatCompletion(response, { content: "Complete." });
  }
  writeChatCompletion(response, {
    toolCall: {
      name: "run_tests",
      arguments: mode === "parameterized" ? { arguments: [hostileArgument] } : {},
    },
  });
});
const State = z.object({ workspacePath: z.string() });
if (mode === "parameterized") {
  writeFileSync(
    join(directory, "capture.mjs"),
    "import { writeFileSync } from 'node:fs'; writeFileSync('received.txt', process.argv.slice(2).join(' '));\n",
  );
}
const commands = [
  mode === "parameterized"
    ? {
        name: "run_tests",
        description: "Capture one validated argument.",
        command: "node capture.mjs",
        arguments: ["--value"],
      }
    : {
        name: "run_tests",
        description: "Write proof that the fixed command ran.",
        command: `${JSON.stringify(process.execPath)} -e "require('fs').writeFileSync('command-ran.txt','ok')"`,
      },
];
const workspace = agentWorkspace({
  path: (state) => state.workspacePath,
  ...(mode === "missing-catalogue" ? {} : { commands }),
});
if (mode === "mutated-catalogue") {
  commands[0].command = `${JSON.stringify(process.execPath)} -e "require('fs').writeFileSync('mutated-command-ran.txt','unsafe')"`;
}

try {
  const worker = agent({
    id: "worker",
    instructions: "Run the fixed command, then finish.",
    client: {
      kind: "openai-compatible",
      version: 1,
      endpoint: server.url,
      model: "gpt-5.6-sol",
      wireApi: "completions",
    },
    message: () => "Run the fixed command.",
    workspace: workspace.withTools([
      mode === "invalid-predicate"
        ? agentTools.when(() => "true", workspace.commands)
        : agentTools.always(workspace.commands),
    ]),
  });
  const done = output({ id: "done", summary: () => "done" });
  const graph = pipeline({
    name: "workspace-runtime",
    state: State,
    nodes: [worker, done],
    start: worker,
    routes: [route({ from: worker, outcome: "success", to: done, label: "done" })],
    outputs: [done],
  });
  await run(graph, { workspacePath: directory });
  console.log(
    JSON.stringify({
      commandRan: existsSync(join(directory, "command-ran.txt")),
      received: existsSync(join(directory, "received.txt"))
        ? readFileSync(join(directory, "received.txt"), "utf8")
        : null,
      marker: existsSync(join(directory, "marker")),
      mutatedCommandRan: existsSync(join(directory, "mutated-command-ran.txt")),
    }),
  );
} catch (error) {
  console.log(JSON.stringify({ error: error.message }));
} finally {
  await server.close();
  rmSync(directory, { recursive: true, force: true });
}
