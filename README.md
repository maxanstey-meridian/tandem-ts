# @maxanstey-meridian/tandem

The TypeScript authoring API for [Tandem](https://github.com/maxanstey-meridian/tandem), a typed
agentic pipeline SDK running on .NET and Microsoft Agent Framework.

## Requirements

- macOS on Apple silicon
- Node.js 22 or newer
- .NET 10 runtime

## Install

```sh
npm install @maxanstey-meridian/tandem zod
```

The package includes compiled JavaScript, TypeScript declarations, and the macOS Apple silicon
bridge runtime. Installation does not compile the SDK or download a bridge.

## Quick Start

```ts
import { output, pipeline, route, run, stage } from "@maxanstey-meridian/tandem";
import { z } from "zod";

const State = z.object({
  input: z.string(),
  normalized: z.string().nullable(),
});
type State = z.infer<typeof State>;

const normalize = stage<State>({
  id: "normalize",
  execute: (state) => ({
    ...state,
    normalized: state.input.trim().toLowerCase(),
  }),
});

const done = output<State>({
  id: "done",
  summary: (state) => state.normalized!,
});

const normalizeInput = pipeline({
  name: "normalize-input",
  state: State,
  nodes: [normalize, done],
  start: normalize,
  routes: [route({ from: normalize, to: done, label: "normalized" })],
  outputs: [done],
});

const result = await run(normalizeInput, { input: "  Hello  ", normalized: null });
console.log(result.state.normalized);
```

State holds application facts, participants perform work, and routes decide what runs next. See the
[examples](https://github.com/maxanstey-meridian/tandem-ts/tree/main/examples) for agents,
capabilities, interactions, persistence, and complete examples.

Licensed under the [MIT License](./LICENSE).

For a specialised model that requires a plain user message, a raw-output agent
can set both `instructions` and `output.instructions` to `""`. Tandem then sends
the authored message without system instructions or a response-format constraint.
Other agent/output modes still require nonblank instructions.

## Development and publishing

```sh
pnpm install
pnpm build
pnpm test
npm pack
```

`npm pack` and `npm publish` build fresh output before packaging. The npm package contains
`dist`, including one copy of the vendored bridge in `dist/runtime`. Update `runtime` from
a tested Tandem bridge build before releasing runtime changes.

## Runtime-sized collections

Use `collection` for a list whose size is known at execution time. Declare its
item/result schemas and agents, select items from state, and apply the ordered
results. Native Tandem owns scheduling through `max`; zero and one item need no
special graph.

`taskAgent<Input, Output>` defines a model participant with validated input and
output. Inside a collection, `context.run(agent, input)` invokes only agents
declared on that collection. Await each call before the next. Scope use after
completion and sibling parallel agent calls are rejected. Operational failure
fails the collection, drains active work, and skips application of results.

```ts
const canonicalise = collection({
  id: "canonicalise",
  item: Proposition,
  result: Claim,
  agents: [canonicaliser],
  max: 6,
  items: (state: SourceState) => state.propositions,
  execute: (proposition, context) => context.run(canonicaliser, proposition),
  apply: (state, claims) => ({ ...state, claims }),
});
```

The executable [collection example](tests/collection-child.ts) includes
conditional recovery, persistence, cancellation and concurrent source runs.
Agent visits remain in the source run's native observations and ledger.

Agent definitions may be reused across collections. Native Tandem binds each under
its collection name. Scoped observations and accepted ledger values carry a
`visitId` so concurrent calls can be correlated without changing their semantic
`stepId`.
