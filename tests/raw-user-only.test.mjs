import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";

test("raw agents can send exactly one user message without system instructions", async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [new URL("raw-user-only-child.mjs", import.meta.url).pathname],
    { timeout: 15000 },
  );
  assert.match(stdout, /user-only raw output passed/u);
});
