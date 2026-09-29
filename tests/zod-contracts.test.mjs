import assert from "node:assert/strict";
import { test } from "node:test";
import { runChild } from "./support/run-child.mjs";

test("Zod contracts reject unsupported behavior and schemas with contract errors", async () => {
  const errors = await runChild("zod-contracts-child.mjs");
  assert.equal(errors.length, 13);
  assert.match(errors[0], /changed the boundary value/);
  assert.match(errors[1], /changed the boundary value/);
  assert.match(errors[2], /Async Zod refinements/);
  const callbackContract = JSON.parse(errors[3]);
  assert.equal(callbackContract.name, "ContractValidationError");
  assert.equal(callbackContract.contract, true);
  assert.equal(callbackContract.problems[0].path, "$");
  assert.match(callbackContract.problems[0].message, /changed the boundary value/);
  assert.match(errors[4], /duplicate capability/);
  assert.match(errors[6], /Transforms cannot be represented/);
  for (const encoded of [errors[5], errors[7]]) {
    const error = JSON.parse(encoded);
    assert.equal(error.name, "ContractValidationError");
    assert.equal(error.contract, true);
    assert.equal(error.problems[0].path, "$");
    assert.match(error.problems[0].message, /representable|Custom/i);
  }
  for (const error of errors.slice(8)) {
    const problem = error.startsWith("{") ? JSON.parse(error) : null;
    if (problem) {
      assert.equal(problem.name, "ContractValidationError");
      assert.equal(problem.contract, true);
      assert.match(problem.problems[0].message, /Instructions must be a non-blank string/);
    } else {
      assert.match(error, /Instructions must be a non-blank string/);
    }
  }
});
