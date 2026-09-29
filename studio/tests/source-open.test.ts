import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SourceOwnership } from "../src/ownership.js";

// The environment is parsed once at import, so the stub editor must be configured first.
const directory = await mkdtemp(join(tmpdir(), "studio-editor-"));
const editor = join(directory, "editor");
const invocations = join(directory, "invocations");
await writeFile(editor, `#!/bin/sh\nprintf '%s\\n' "$@" > '${invocations}'\n`);
await chmod(editor, 0o755);
process.env.TANDEM_STUDIO_EDITOR = editor;
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

test("source opening launches only the resolved file and line", async () => {
  openSourceLocation({ file: "/project/pipeline.ts", line: 12 });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assert.equal(await readFile(invocations, "utf8"), "/project/pipeline.ts:12\n");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  assert.fail("the configured editor was not launched");
});
