import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
  agent,
  capability,
  collection,
  ContractValidationError,
  parallel,
  skill,
  stage,
  taskAgent,
  TandemError,
} from "../src/index.ts";

const client = {
  kind: "openai-compatible",
  version: 1,
  endpoint: "http://localhost/v1",
  model: "test",
  wireApi: "responses",
};
const baseAgent = { id: "worker", instructions: "Work.", client, message: () => "work" };
const checkpointCapability = capability({
  name: "checkpoint",
  instructions: "Checkpoint.",
  schema: z.object({}),
  apply: (state) => state,
  summarize: () => "Checkpointed.",
});
const checkpoint = {
  contextWindowTokens: 100,
  maxOutputTokens: 20,
  checkpointAtPercent: 80,
  capability: checkpointCapability,
  instructions: "Checkpoint.",
  message: () => "Checkpoint.",
};
const withCheckpoint = (overrides) => ({
  ...baseAgent,
  capabilities: [checkpointCapability],
  checkpoint: { ...checkpoint, ...overrides },
});
const structuredOutput = {
  instructions: "Return.",
  schema: z.object({}),
  apply: (state) => state,
};
const rawOutput = { instructions: "", raw: true, parse: (text) => text, apply: (state) => state };

const refusals = (create, cases) => {
  for (const [name, definition, expected, type = TandemError] of cases) {
    test(`refuses ${name}`, () => {
      assert.throws(
        () => create(definition),
        (error) => error instanceof type && expected.test(error.message),
      );
    });
  }
};

test("accepts valid definitions", () => {
  agent({ ...baseAgent, reasoning: { effort: "low" }, temperature: 2, maxOutputTokens: 1 });
  agent({ ...baseAgent, reasoning: { maxTokens: 1024 }, output: structuredOutput });
  agent({ ...baseAgent, output: rawOutput });
  agent(withCheckpoint({ session: "retain", disableCompaction: true }));
  const first = stage({ id: "a", execute: (state) => state });
  const second = stage({ id: "b", execute: (state) => state });
  parallel({ id: "p", max: 2_147_483_647, branches: { first, second }, merge: (state) => state });
});

refusals(agent, [
  [
    "blank agent instructions",
    { ...baseAgent, instructions: " " },
    /Instructions must be a non-blank/,
    ContractValidationError,
  ],
  [
    "non-string raw agent instructions",
    { ...baseAgent, instructions: 1, output: rawOutput },
    /Instructions/,
    ContractValidationError,
  ],
  [
    "blank output instructions",
    { ...baseAgent, output: { ...structuredOutput, instructions: " " } },
    /output instructions/,
    ContractValidationError,
  ],
  [
    "blank checkpoint instructions",
    withCheckpoint({ instructions: " " }),
    /checkpoint instructions/,
    ContractValidationError,
  ],
  [
    "reasoning with neither option",
    { ...baseAgent, reasoning: {} },
    /reasoning must specify exactly one of effort or maxTokens/,
  ],
  [
    "reasoning with both options",
    { ...baseAgent, reasoning: { effort: "low", maxTokens: 2048 } },
    /exactly one of effort or maxTokens/,
  ],
  [
    "an invalid reasoning effort",
    { ...baseAgent, reasoning: { effort: "minimal" } },
    /reasoning effort must be/,
  ],
  [
    "reasoning maxTokens below 1024",
    { ...baseAgent, reasoning: { maxTokens: 1023 } },
    /reasoning maxTokens must be a 32-bit integer of at least 1024/,
  ],
  [
    "fractional reasoning maxTokens",
    { ...baseAgent, reasoning: { maxTokens: 1024.5 } },
    /reasoning maxTokens/,
  ],
  [
    "reasoning maxTokens above int32",
    { ...baseAgent, reasoning: { maxTokens: 2 ** 31 } },
    /reasoning maxTokens/,
  ],
  [
    "raw output that is not true",
    { ...baseAgent, output: { ...rawOutput, instructions: "Return.", raw: false } },
    /output raw must be true/,
  ],
  [
    "raw output with a schema",
    { ...baseAgent, output: { ...rawOutput, schema: z.object({}) } },
    /output schema is forbidden for raw output/,
  ],
  [
    "raw output without parse",
    { ...baseAgent, output: { ...rawOutput, parse: undefined } },
    /output parse must be a function for raw output/,
  ],
  [
    "parse without raw output",
    { ...baseAgent, output: { ...structuredOutput, parse: () => 1 } },
    /output parse requires raw output mode/,
  ],
  [
    "duplicate capabilities",
    { ...baseAgent, capabilities: [checkpointCapability, checkpointCapability] },
    /duplicate capability/,
  ],
  [
    "a skill with an invalid directory",
    { ...baseAgent, skills: [{ directory: " " }] },
    /skills\[0\] directory must be a non-blank string/,
  ],
  [
    "a repeated skill directory",
    { ...baseAgent, skills: [{ directory: "a" }, { directory: "a" }] },
    /skills must not repeat a skill directory/,
  ],
  [
    "negative temperature",
    { ...baseAgent, temperature: -0.1 },
    /temperature must be between 0 and 2/,
  ],
  ["temperature above 2", { ...baseAgent, temperature: 2.1 }, /temperature/],
  ["NaN temperature", { ...baseAgent, temperature: Number.NaN }, /temperature/],
  [
    "zero maxOutputTokens",
    { ...baseAgent, maxOutputTokens: 0 },
    /maxOutputTokens must be a positive 32-bit integer/,
  ],
  ["fractional maxOutputTokens", { ...baseAgent, maxOutputTokens: 1.5 }, /maxOutputTokens/],
  [
    "unsafe maxOutputTokens",
    { ...baseAgent, maxOutputTokens: Number.MAX_SAFE_INTEGER + 1 },
    /maxOutputTokens/,
  ],
  [
    "checkpoint contextWindowTokens above int32",
    withCheckpoint({ contextWindowTokens: 2 ** 31 }),
    /checkpoint contextWindowTokens must be a positive 32-bit integer/,
  ],
  [
    "checkpoint maxOutputTokens of zero",
    withCheckpoint({ maxOutputTokens: 0 }),
    /checkpoint maxOutputTokens must be a positive 32-bit integer/,
  ],
  [
    "checkpoint maxOutputTokens not below the window",
    withCheckpoint({ maxOutputTokens: 100 }),
    /checkpoint maxOutputTokens must be smaller than contextWindowTokens/,
  ],
  [
    "checkpointAtPercent of 0",
    withCheckpoint({ checkpointAtPercent: 0 }),
    /checkpointAtPercent must be between 1 and 99/,
  ],
  [
    "checkpointAtPercent of 100",
    withCheckpoint({ checkpointAtPercent: 100 }),
    /checkpointAtPercent/,
  ],
  [
    "fractional checkpointAtPercent",
    withCheckpoint({ checkpointAtPercent: 50.5 }),
    /checkpointAtPercent/,
  ],
  [
    "a detached checkpoint capability",
    { ...withCheckpoint({}), capabilities: [] },
    /checkpoint capability must be attached to the agent/,
  ],
  [
    "an invalid checkpoint session",
    withCheckpoint({ session: "rest" }),
    /checkpoint session must be 'retain' or 'reset'/,
  ],
  [
    "a non-boolean disableCompaction",
    withCheckpoint({ disableCompaction: "yes" }),
    /checkpoint disableCompaction must be a boolean/,
  ],
]);

refusals(taskAgent, [
  [
    "an invalid task agent",
    {
      ...baseAgent,
      input: z.string(),
      result: z.string(),
      output: structuredOutput,
      temperature: 3,
    },
    /Agent 'worker' temperature/,
  ],
]);

const collectionBase = {
  id: "items",
  item: z.string(),
  result: z.string(),
  items: () => [],
  agents: [],
  execute: (item) => item,
  apply: (state) => state,
  max: 1,
};
const taskReference = { id: "task" };
refusals(collection, [
  [
    "a zero collection max",
    { ...collectionBase, max: 0 },
    /Collection 'items' max must be a positive 32-bit integer/,
  ],
  ["a collection max above int32", { ...collectionBase, max: 2 ** 31 }, /max/],
  [
    "duplicate collection agent IDs",
    { ...collectionBase, agents: [taskReference, { ...taskReference }] },
    /agents must have unique IDs/,
  ],
]);

const first = stage({ id: "first", execute: (state) => state });
const second = stage({ id: "second", execute: (state) => state });
const parallelBase = { id: "group", branches: { first, second }, merge: (state) => state };
refusals(parallel, [
  [
    "a fractional parallel max",
    { ...parallelBase, max: 1.5 },
    /Parallel group 'group' max must be a positive 32-bit integer/,
  ],
  [
    "a single parallel branch",
    { ...parallelBase, branches: { first } },
    /requires at least two branches/,
  ],
  [
    "a participant shared across branches",
    { ...parallelBase, branches: { first, again: first } },
    /must own a distinct participant per branch/,
  ],
  [
    "a blank branch ID",
    { ...parallelBase, branches: { first, " ": second } },
    /must not have a blank branch ID/,
  ],
]);

refusals(skill, [
  ["a blank skill directory", { directory: " " }, /Skill directory must be a non-blank string/],
  ["a non-string skill directory", { directory: 1 }, /Skill directory/],
]);
