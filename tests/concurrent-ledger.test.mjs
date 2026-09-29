import assert from "node:assert/strict";
import { test } from "node:test";
import { runChild } from "./support/run-child.mjs";

test("concurrent nested agent runs persist to one ledger without blocking JS acceptance callbacks", async () => {
  assert.deepEqual(await runChild("concurrent-ledger-child.mjs", [], { timeout: 20_000 }), {
    parents: 2,
    children: 16,
  });
});
