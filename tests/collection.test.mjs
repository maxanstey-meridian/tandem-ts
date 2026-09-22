import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
for (const mode of [
  "empty",
  "single",
  "many",
  "agents",
  "failure",
  "cancel",
  "invalid-result",
  "invalid-merge",
  "invalid-agent-result",
  "undeclared",
  "concurrent",
  "escaped",
]) {
  test("native collections: " + mode, async () => {
    await exec(
      process.execPath,
      ["--import", "tsx", new URL("collection-child.ts", import.meta.url).pathname, mode],
      { timeout: 20000 },
    );
  });
}

test("collection authoring preserves typed agent inputs and outputs", async () => {
  await exec(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "--strict",
      "--skipLibCheck",
      "--target",
      "ES2023",
      "--module",
      "NodeNext",
      "--noEmit",
      "tests/collection-child.ts",
    ],
    { cwd: new URL("../", import.meta.url), timeout: 20000 },
  );
});
