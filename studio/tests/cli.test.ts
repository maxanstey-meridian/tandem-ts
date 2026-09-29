import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const tsx = createRequire(import.meta.url).resolve("tsx");

test("Studio CLI rejects anything but an optional config path", async () => {
  for (const args of [["--config"], ["--config", "--other"], ["--unknown"], ["extra"]]) {
    await assert.rejects(
      promisify(execFile)(process.execPath, ["--import", tsx, cli, ...args]),
      (error: { code?: number; stderr?: string }) =>
        error.code === 1 && /Usage: tandem-studio/.test(String(error.stderr)),
      args.join(" "),
    );
  }
});
