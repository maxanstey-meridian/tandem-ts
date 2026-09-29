import assert from "node:assert/strict";
import test from "node:test";
import { RouteEditRequestSchema } from "../src/edit.js";
import { SourceTargetSchema } from "../src/source-open.js";

test("route edit requests reject unknown keys and wrong-typed fields", () => {
  const valid = { edit: { kind: "delete", order: 0 }, editRevision: "revision" };
  assert.deepEqual(RouteEditRequestSchema.parse(valid), valid);
  for (const invalid of [
    { ...valid, extra: true },
    { ...valid, edit: { kind: "delete", order: 0, file: "/etc/passwd" } },
    { ...valid, edit: { kind: "move", order: 0, toOrder: "1" } },
    { ...valid, edit: { kind: "insert", order: 0, from: "a", to: 1, label: "go" } },
    { ...valid, edit: { kind: "update", order: 0, outcome: "maybe" } },
    { ...valid, edit: { kind: "rename", order: 0 } },
    { ...valid, edit: { kind: "delete", order: -1 } },
    { ...valid, editRevision: 1 },
  ]) {
    assert.equal(RouteEditRequestSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
  }
});

test("source targets reject unknown keys and wrong-typed fields", () => {
  assert.equal(SourceTargetSchema.safeParse({ kind: "state", file: "/etc/passwd" }).success, false);
  assert.equal(SourceTargetSchema.safeParse({ kind: "participant", id: 1 }).success, false);
  assert.equal(SourceTargetSchema.safeParse({ kind: "route", order: 0.5 }).success, false);
});
