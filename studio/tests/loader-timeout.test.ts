import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// The environment is parsed once at import, so the bound must be configured first.
process.env.TANDEM_STUDIO_LOAD_TIMEOUT_MS = "150";
const { loadPipeline } = await import("../src/loader.js");

test("terminates and diagnoses a config import that exceeds the loading bound", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-loader-timeout-"));
  const config = join(root, "tandem.config.ts");
  await writeFile(config, "while (true) {} export const tandem = { createPipeline: () => ({}) };");
  const started = Date.now();

  const result = await loadPipeline(config);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /exceeded 150ms.*blocking work/);
  }
  assert.ok(Date.now() - started < 2_000);
});
