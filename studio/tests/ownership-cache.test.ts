import type { PipelineInspection } from "@maxanstey-meridian/tandem";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { currentOwnership } from "../server/utils/pipeline.js";
import { closeProjectWatchers } from "../src/watch.js";

const graph: PipelineInspection = {
  name: "owned",
  stateSchema: {},
  start: "first",
  persist: false,
  nodes: [
    { id: "first", kind: "stage" },
    { id: "done", kind: "completion" },
  ],
  routes: [
    { id: "route:0", source: "first", target: "done", label: "go", order: 0, conditional: true },
  ],
  outputs: ["done"],
};
const source = (predicate: string) =>
  `const first = stage({ id: "first" }); const done = output({ id: "done" }); pipeline({ name: "owned", state: schema, nodes: [first, done], start: first, routes: [route({ from: first, to: done, label: "go", when: ${predicate} })], outputs: [done] });\n`;
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test.after(closeProjectWatchers);
test("read-side ownership is reused until the workspace watcher reports a change", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-ownership-cache-"));
  const config = join(root, "tandem.config.ts");
  await writeFile(config, source("(state) => state.first"));

  const first = await currentOwnership(config, graph);
  assert.equal(await currentOwnership(config, graph), first);
  assert.equal(first.routes[0]?.predicate, "(state) => state.first");

  await writeFile(config, source("(state) => state.second"));
  await wait(400);
  const second = await currentOwnership(config, graph);
  assert.notEqual(second, first);
  assert.equal(second.routes[0]?.predicate, "(state) => state.second");
});
