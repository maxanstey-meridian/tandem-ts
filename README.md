# @maxanstey-meridian/tandem

The TypeScript authoring API for [Tandem](https://github.com/maxanstey-meridian/tandem), a typed
agentic pipeline SDK running on .NET and Microsoft Agent Framework.

## Requirements

- macOS on Apple silicon or Linux x64
- Node.js 22 or newer
- .NET 10 runtime

## Install

```sh
npm install @maxanstey-meridian/tandem zod
```

The package includes compiled JavaScript, TypeScript declarations, and bridge runtimes for
macOS Apple silicon and Linux x64. Installation does not compile the SDK or download a bridge.

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

The package is ESM-only, and a project created by `npm init` is CommonJS, so save the code as
`index.mts`:

```sh
node index.mts
```

To use `index.ts` instead, first mark the project as ESM with `npm pkg set type=module`, then run
`node index.ts`. Node.js 22.18 or newer runs TypeScript directly by stripping types; on older
Node.js 22 releases, use `npx tsx index.mts`. The program prints `hello`.

State holds application facts, participants perform work, and routes decide what runs next. See the
[examples](#examples) for routing, persistence and complete model-backed pipelines.

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
import { collection, taskAgent, type ChatClient } from "@maxanstey-meridian/tandem";
import { z } from "zod";

const client = {
  kind: "openai-compatible",
  version: 1,
  endpoint: "https://openrouter.ai/api/v1",
  model: "deepseek/deepseek-v4-flash-0731",
  wireApi: "completions",
  apiKeyEnvironmentVariable: "OPENROUTER_API_KEY",
} as const satisfies ChatClient;

const Proposition = z.string();
const Claim = z.object({ subject: z.string(), statement: z.string() });
const SourceState = z.object({ propositions: z.array(Proposition), claims: z.array(Claim) });
type SourceState = z.infer<typeof SourceState>;

const canonicaliser = taskAgent({
  id: "canonicaliser",
  instructions: "Restate the proposition as one canonical claim.",
  client,
  input: Proposition,
  result: Claim,
  message: (proposition) => proposition,
  output: { instructions: "Return the claim's subject and statement.", schema: Claim },
});

const canonicalise = collection({
  id: "canonicalise",
  item: Proposition,
  result: Claim,
  agents: [canonicaliser],
  max: 6,
  items: (state: SourceState) => state.propositions,
  execute: (proposition, context) => context.run(canonicaliser, proposition),
  apply: (state, claims) => ({ ...state, claims: [...claims] }),
});
```

Add `canonicalise` to a pipeline's `nodes` and `routes` like any other participant.

The executable [collection test](tests/collection-child.ts) includes
conditional recovery, persistence, cancellation and concurrent source runs.
Agent visits remain in the source run's native observations and ledger.

Agent definitions may be reused across collections. Native Tandem binds each under
its collection name. Scoped observations and accepted ledger values carry a
`visitId` so concurrent calls can be correlated without changing their semantic
`stepId`.

## Raw-output agents

For a specialised model that requires a plain user message, a raw-output agent
can set both `instructions` and `output.instructions` to `""`. Tandem then sends
the authored message without system instructions or a response-format constraint.
Other agent/output modes still require nonblank instructions.

## Examples

The [examples](https://github.com/maxanstey-meridian/tandem-ts/tree/main/examples) run from a
clone of this repository. The getting-started examples need no model or API key; the songwriter,
debate and code-writer examples need an OpenRouter API key. See
[examples/README.md](https://github.com/maxanstey-meridian/tandem-ts/blob/main/examples/README.md)
for the commands and environment variables.

## Development and publishing

This repository is a [pnpm](https://pnpm.io) workspace. `package.json` pins pnpm 11.22.0 in
`packageManager`; a newer pnpm switches to that version on its own, or run
`corepack enable pnpm`. Tests also need the .NET 10 runtime.

```sh
pnpm install
pnpm build
pnpm test
npm pack
```

`npm pack` and `npm publish` build fresh output before packaging. The npm package contains
`dist`, including the vendored platform bridge bundles in `dist/runtime`.

### Repository layout

- `src`: the published SDK. `runtime/loader.mjs` picks the bridge bundle for the current platform.
- `runtime/darwin-arm64`, `runtime/linux-x64`: the vendored .NET bridge bundles, copied into
  `dist/runtime` by `pnpm build`.
- `packets`: `@maxanstey-meridian/tandem-packets`, which reads Markdown packet files with YAML
  frontmatter into a Zod schema. `pnpm test` builds it.
- `studio`: Tandem Studio, a local Nuxt viewer and route editor for the pipeline exported by a
  `tandem.config.ts`. Run `pnpm -C studio build`, then `node ../../../studio/dist/cli.js` from
  `examples/debate/typescript`. It has its own `typecheck` and `test` scripts.
- `examples`: see [examples/README.md](examples/README.md).

### Updating the runtime bundles

The bundles are built from the [Tandem](https://github.com/maxanstey-meridian/tandem) .NET
repository; only bundles from a tested Tandem build should be released. Each Tandem release attaches
`tandem-bridge-<version>-darwin-arm64.tar.gz` and `tandem-bridge-<version>-linux-x64.tar.gz`;
replace each platform's directory with its archive's contents:

```sh
rm -rf runtime/darwin-arm64 && mkdir runtime/darwin-arm64
tar -xzf tandem-bridge-<version>-darwin-arm64.tar.gz -C runtime/darwin-arm64
```

To build a bundle from a Tandem checkout instead, run this there for each RID (`osx-arm64` for
`darwin-arm64`, `linux-x64` for `linux-x64`), then copy `bridge-runtime/` over the matching
`runtime/<platform>` directory:

```sh
dotnet publish bridge/Tandem.Bridge.csproj -c Release -p:Version=<version> -r osx-arm64 --self-contained false --output .runtime-publish
node scripts/stage-runtime.mjs osx-arm64
```

Then run `pnpm test`, which exercises the bundle for the current platform. The Linux package
workflow tests the linux-x64 bundle.

## License

Licensed under the [MIT License](./LICENSE).
