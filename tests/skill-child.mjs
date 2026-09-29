import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { agent, output, pipeline, route, run, skill } from "../dist/index.js";
import { startFakeOpenAi, writeChatCompletion, writeModels } from "./support/fake-openai.mjs";

const root = mkdtempSync(join(tmpdir(), "tandem-skill-fixture-"));
const skillDirectory = join(root, "test-skill");
mkdirSync(join(skillDirectory, "references"), { recursive: true });
mkdirSync(join(skillDirectory, "scripts"));
writeFileSync(
  join(skillDirectory, "SKILL.md"),
  "---\nname: test-skill\ndescription: Test discovery.\n---\n\nFollow the TypeScript doctrine.",
);
writeFileSync(join(skillDirectory, "references", "rules.md"), "Prefer explicit TS boundaries.");
writeFileSync(join(skillDirectory, "scripts", "unsafe.sh"), "exit 99");
const skillTools = ["load_skill", "read_skill_resource"];
let visit = 0;
const server = await startFakeOpenAi(({ url, body }, response) => {
  if (url === "/v1/models") return writeModels(response, "fixture");
  const name = skillTools[visit++];
  if (name === undefined) return writeChatCompletion(response, { content: "Reviewed with the skill." });
  const tool = body.tools.find((candidate) => candidate.function.name === name).function;
  const properties = Object.keys(tool.parameters.properties);
  writeChatCompletion(response, {
    toolCall: {
      name,
      arguments: Object.fromEntries(
        properties.map((property, index) => [property, index === 0 ? "test-skill" : "references/rules.md"]),
      ),
    },
  });
});
const State = z.object({ reviewed: z.boolean() });
const reviewer = agent({
  id: "reviewer",
  instructions: "Use the test skill, read its rules, then review.",
  client: {
    kind: "openai-compatible",
    version: 1,
    endpoint: server.url,
    model: "fixture",
    wireApi: "completions",
  },
  message: () => "Review this.",
  skills: [skill({ directory: skillDirectory })],
});
const done = output({ id: "done", summary: () => "Complete." });
const graph = pipeline({
  name: "skill-fixture",
  state: State,
  nodes: [reviewer, done],
  start: reviewer,
  routes: [route({ from: reviewer, to: done, outcome: "success", label: "done" })],
  outputs: [done],
});

try {
  const result = await run(graph, { reviewed: false });
  const modelRequests = server.requests.filter((item) => item.url === "/v1/chat/completions");
  console.log(
    JSON.stringify({
      succeeded: result.succeeded,
      tools: modelRequests[0].body.tools.map((tool) => tool.function.name),
      loadedSkill: JSON.stringify(modelRequests[1].body).includes(
        "Follow the TypeScript doctrine.",
      ),
      loadedResource: JSON.stringify(modelRequests[2].body).includes(
        "Prefer explicit TS boundaries.",
      ),
      exposedScript: JSON.stringify(modelRequests).includes("unsafe.sh"),
    }),
  );
} finally {
  await server.close();
  rmSync(root, { recursive: true, force: true });
}
