import assert from "node:assert/strict";
import test from "node:test";
import { runChild } from "./support/run-child.mjs";
for (const enabled of [false, true]) {
  test(`ledger logging retains accepted values with model tools ${enabled ? "enabled" : "disabled by default"}`, async () => {
    const result = await runChild("ledger-tools-child.mjs", [enabled ? "enabled" : "default"], {
      timeout: 20_000,
    });
    assert.equal(result.succeeded, true);
    assert.equal(result.persisted, true);
    assert.deepEqual(
      result.tools.sort(),
      enabled ? ["read_ledger", "read_ledger_entry", "search_ledger"] : [],
    );
  });
}
