import { test } from "node:test";
import { exec, execChild } from "./support/run-child.mjs";
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
    await execChild("collection-child.ts", [mode], { timeout: 20_000 });
  });
}

test("collection authoring preserves typed agent inputs and outputs", async () => {
  await exec(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "--strict",
      "--skipLibCheck",
      "--allowJs",
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
