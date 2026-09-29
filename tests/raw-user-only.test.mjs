import assert from "node:assert/strict";
import { test } from "node:test";
import { execChild } from "./support/run-child.mjs";

test("raw agents can send exactly one user message without system instructions", async () => {
  const { stdout } = await execChild("raw-user-only-child.mjs");
  assert.match(stdout, /user-only raw output passed/u);
});
