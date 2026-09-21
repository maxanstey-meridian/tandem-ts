import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";

test("concurrent nested agent runs persist to one ledger without blocking JS acceptance callbacks", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [
    new URL("concurrent-ledger-child.mjs", import.meta.url).pathname,
  ], { timeout: 20_000 });
  assert.deepEqual(JSON.parse(stdout.trim()), { parents: 2, children: 16 });
});
