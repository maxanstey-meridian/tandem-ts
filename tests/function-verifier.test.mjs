import assert from "node:assert/strict";
import { test } from "node:test";
import { runChild } from "./support/run-child.mjs";

const valid = `(input) => input.trim().toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")`;
const sources = [
  valid,
  "(input) => {",
  "42",
  "(input) => { while (true) {} }",
  "(input) => process.exit(0)",
];

test("function verifier accepts valid source and rejects invalid source", async () => {
  const [result, syntaxError, nonFunction, nonTerminating, exiting] = await runChild(
    "function-verifier-child.ts",
    sources,
    { timeout: 30_000 },
  );

  assert.equal(result.passed, true);
  assert.equal(result.error, null);
  assert.equal(
    result.cases.every(({ passed }) => passed),
    true,
  );
  assert.equal(syntaxError.passed, false);
  assert.match(JSON.stringify(syntaxError), /Invalid JavaScript/);
  assert.equal(nonFunction.passed, false);
  assert.match(JSON.stringify(nonFunction), /must evaluate to a function/);
  assert.equal(nonTerminating.passed, false);
  assert.match(nonTerminating.error, /timed out/);
  assert.equal(exiting.passed, false);
  assert.match(JSON.stringify(exiting), /process is not defined/);
});
