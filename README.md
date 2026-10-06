<p align="center">
  <h1 align="center">tandem-ts</h1>
  <p align="center">
    <a href="https://www.npmjs.com/package/@maxanstey-meridian/tandem"><img src="https://img.shields.io/npm/v/@maxanstey-meridian/tandem?label=%40maxanstey-meridian%2Ftandem" alt="npm" /></a>
    <img src="https://img.shields.io/badge/license-MIT-blue" alt="License" />
  </p>
</p>

**Typed agentic pipelines, authored in TypeScript.** This is the TypeScript SDK for
[Tandem](https://github.com/maxanstey-meridian/tandem). You write state as Zod schemas and agents,
stages and routes as plain objects. Under the hood, the same .NET engine that runs C# Tandem
applications runs yours, with Microsoft Agent Framework handling model loops, sessions and tool
dispatch.

You don't build or load any .NET code yourself. The package bundles a compiled bridge for each
supported platform, so `npm install` is the whole setup.

## Requirements

- macOS on Apple silicon, or Linux x64
- Node.js 22 or newer
- .NET 10 runtime

## Install

```sh
npm install @maxanstey-meridian/tandem zod
```

The package ships compiled JavaScript, type declarations and the bridge runtimes. Installing it
doesn't compile the SDK or download anything else.

## Quick start

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
  execute: (state) => ({ ...state, normalized: state.input.trim().toLowerCase() }),
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

Save it as `index.mts` and run `node index.mts`. It prints `hello`.

The package is ESM-only, and a project created by `npm init` is CommonJS, hence `.mts`. To use
`index.ts`, mark the project as ESM with `npm pkg set type=module`. Node.js 22.18 or newer runs
TypeScript directly; on older Node.js 22 releases, use `npx tsx index.mts`.

State holds the facts, participants do the work, and routes decide what runs next. Everything
else builds on that.

## Add a model

```ts
import { agent, type ChatClient } from "@maxanstey-meridian/tandem";
import { z } from "zod";

const ReviewDecision = z.object({
  decision: z.enum(["Accept", "RequestChanges"]),
  findings: z.array(z.string()),
});
type ReviewDecision = z.infer<typeof ReviewDecision>;

const State = z.object({ draft: z.string(), review: ReviewDecision.nullable() });
type State = z.infer<typeof State>;

const client = {
  kind: "openai-compatible",
  version: 1,
  endpoint: "https://openrouter.ai/api/v1",
  model: "deepseek/deepseek-v4-flash-0731",
  wireApi: "completions",
  apiKeyEnvironmentVariable: "OPENROUTER_API_KEY",
} as const satisfies ChatClient;

const reviewer = agent<State, ReviewDecision>({
  id: "reviewer",
  instructions: "Review the draft and accept it or request changes.",
  client,
  message: (state) => state.draft,
  output: {
    instructions: "Return Accept or RequestChanges with concrete findings.",
    schema: ReviewDecision,
    apply: (state, review) => ({ ...state, review }),
  },
});
```

The reviewer's answer is validated against `ReviewDecision` before it reaches state, so a route
can branch on `state.review.decision` like any other fact.

## Also in the box

- [Capabilities](https://maxanstey-meridian.github.io/tandem/guides/capabilities),
  [interactions](https://maxanstey-meridian.github.io/tandem/guides/interactions),
  [parallel groups](https://maxanstey-meridian.github.io/tandem/guides/parallel) and
  [collections](https://maxanstey-meridian.github.io/tandem/guides/collections)
- [Persistence](https://maxanstey-meridian.github.io/tandem/guides/persistence) to a SQLite
  ledger, read back with `inspectAccepted`
- [Workspace tools](https://maxanstey-meridian.github.io/tandem/guides/workspace-tools) for agents
  that work in a repository
- A live terminal view, with `presentation: "terminal"`
- [`@maxanstey-meridian/tandem-packets`](packets): Markdown and YAML frontmatter input
- [Tandem Studio](https://maxanstey-meridian.github.io/tandem/guides/studio): a local viewer for
  your pipeline

## Examples

The [examples](examples) run from a clone of this repository. The getting-started examples need
no model or API key. The songwriter, debate and code-writer examples need an OpenRouter API key.
See [examples/README.md](examples/README.md).

## Documentation

The full documentation, covering both C# and TypeScript, lives at
**[maxanstey-meridian.github.io/tandem](https://maxanstey-meridian.github.io/tandem/)**.

[Getting Started](https://maxanstey-meridian.github.io/tandem/getting-started) ·
[The Mental Model](https://maxanstey-meridian.github.io/tandem/guides/mental-model) ·
[Agents](https://maxanstey-meridian.github.io/tandem/guides/agents) ·
[Chat Clients](https://maxanstey-meridian.github.io/tandem/reference/chat-clients)

Working on the SDK itself? See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](./LICENSE)
