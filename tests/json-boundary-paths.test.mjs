import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { ContractValidationError, output, pipeline, route, run, stage } from "../src/index.ts";

const done = output({ id: "done", summary: () => "done" });
const pass = stage({ id: "pass", execute: (state) => state });
const graph = pipeline({
  name: "json-boundary-paths",
  state: z.object({ value: z.any() }),
  nodes: [pass, done],
  start: pass,
  routes: [route({ from: pass, to: done, label: "done" })],
  outputs: [done],
});

const accessor = {};
Object.defineProperty(accessor, "computed", { get: () => 1, enumerable: true });
const hidden = { visible: true };
Object.defineProperty(hidden, "hidden", { value: true, enumerable: false });
const cyclic = { nested: {} };
cyclic.nested.self = cyclic;

for (const [name, value, path] of [
  ["negative zero", -0, "$.value"],
  ["NaN", Number.NaN, "$.value"],
  ["an accessor property", accessor, "$.value.computed"],
  ["a non-enumerable property", hidden, "$.value.hidden"],
  ["a nested undefined", { list: [1, undefined] }, "$.value.list[1]"],
  ["a class instance", { at: new Date(0) }, "$.value.at"],
  ["a cycle", cyclic, "$.value.nested.self"],
]) {
  test(`initial state refuses ${name} at ${path}`, async () => {
    await assert.rejects(
      run(graph, { value }),
      (error) =>
        error instanceof ContractValidationError &&
        error.boundary === "initial state" &&
        error.problems[0].path === path,
    );
  });
}
