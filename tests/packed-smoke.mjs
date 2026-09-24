import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { output, pipeline, route, run, stage } from "@maxanstey-meridian/tandem";
import { z } from "zod";

const directory = mkdtempSync(join(tmpdir(), "tandem-packed-"));
const ledgerPath = join(directory, "ledger.sqlite3");
try {
  const State = z.object({ value: z.number() });
  const work = stage({ id: "work", execute: (state) => ({ value: state.value + 1 }) });
  const done = output({ id: "done", summary: (state) => String(state.value) });
  const graph = pipeline({
    name: "packed-smoke",
    state: State,
    nodes: [work, done],
    start: work,
    routes: [route({ from: work, to: done, label: "finished" })],
    outputs: [done],
    persist: true,
  });
  const result = await run(graph, { value: 0 }, { ledgerPath });
  assert.equal(result.succeeded, true);
  assert.equal(result.state.value, 1);
  assert.equal(existsSync(ledgerPath), true);
  const database = new DatabaseSync(ledgerPath, { readOnly: true });
  try {
    assert.deepEqual(database.prepare("select status from runs").all().map((row) => row.status), [
      "Ready",
    ]);
  } finally {
    database.close();
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
