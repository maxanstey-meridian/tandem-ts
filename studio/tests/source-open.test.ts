import assert from "node:assert/strict";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import test from "node:test";
import type { SourceOwnership } from "../src/ownership.js";

// The environment is parsed once at import, so the editor must be configured first.
process.env.TANDEM_STUDIO_EDITOR = "editor";
const { openSourceLocation, resolveSourceTarget, SourceTargetSchema } =
  await import("../src/source-open.js");

const ownership: SourceOwnership = {
  routeArray: { file: "/project/pipeline.ts", line: 8, length: 1 },
  state: { file: "/project/state.ts", line: 4 },
  participants: {
    review: {
      editable: true,
      expression: "review",
      file: "/project/pipeline.ts",
      line: 10,
      callbacks: { execute: { file: "/project/pipeline.ts", line: 12 } },
    },
  },
  routes: [{ editable: false, file: "/project/pipeline.ts", line: 20, reason: "ambiguous" }],
};

test("source targets resolve only through validated ownership metadata", () => {
  assert.deepEqual(
    resolveSourceTarget(ownership, SourceTargetSchema.parse({ kind: "state" })),
    ownership.state,
  );
  assert.deepEqual(
    resolveSourceTarget(ownership, SourceTargetSchema.parse({ kind: "participant", id: "review" })),
    { file: "/project/pipeline.ts", line: 10 },
  );
  assert.deepEqual(
    resolveSourceTarget(
      ownership,
      SourceTargetSchema.parse({ kind: "callback", id: "review", name: "execute" }),
    ),
    { file: "/project/pipeline.ts", line: 12 },
  );
  assert.deepEqual(
    resolveSourceTarget(ownership, SourceTargetSchema.parse({ kind: "route", order: 0 })),
    {
      file: "/project/pipeline.ts",
      line: 20,
    },
  );
  assert.equal(
    resolveSourceTarget(ownership, { kind: "participant", id: "/etc/passwd" }),
    undefined,
  );
  assert.throws(
    () => SourceTargetSchema.parse({ kind: "route", order: 0, file: "/etc/passwd" }),
    /Unrecognized key/,
  );
});

test("source opening launches only the resolved file and line", () => {
  let invocation: { command: string; args: readonly string[]; options: SpawnOptions } | undefined;
  const child = { unref() {} } as ChildProcess;
  openSourceLocation({ file: "/project/pipeline.ts", line: 12 }, ((
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => {
    invocation = { command, args, options };
    return child;
  }) as typeof import("node:child_process").spawn);
  assert.deepEqual(invocation, {
    command: "editor",
    args: ["/project/pipeline.ts:12"],
    options: { detached: true, stdio: "ignore" },
  });
});
