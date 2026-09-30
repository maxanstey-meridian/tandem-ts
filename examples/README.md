# Examples

Each example is a workspace package that uses the SDK from this checkout, so build the repository
root first:

```sh
pnpm install
pnpm build
```

Every example needs the [requirements](../README.md#requirements) of the SDK itself, including the
.NET 10 runtime.

## Getting started

`getting-started/typescript` runs locally with no model, API key or network access.

```sh
cd examples/getting-started/typescript
pnpm example:01   # one stage and one output
pnpm example:02   # conditional routes to two outputs (pass a value as an argument)
pnpm example:03   # two stages in sequence
pnpm example:04   # persistence to getting-started.sqlite3
```

## Model-backed examples

| Example | Command (from `examples/<name>/typescript`) | What it does |
| --- | --- | --- |
| `songwriter` | `pnpm start "Write a song about…"` | Writes lyrics, lints them and revises until a proofreader accepts them. |
| `debate` | `pnpm start "Should…?"` | A proposer argues, a critic challenges and a judge returns a verdict. |
| `code-writer` | `pnpm start` | Implements `slugify`, verifies it against test cases and loops until a reviewer accepts it. Writes `code-writer.sqlite3` (override with `TANDEM_LEDGER_PATH`). The generated JavaScript runs locally in a child Node process inside a `node:vm` context. |

Each run calls two models and needs network access and an [OpenRouter](https://openrouter.ai) API
key:

```sh
export OPENROUTER_API_KEY=sk-or-...
```

Without it, the example prints `OPENROUTER_API_KEY is required to run the … example.` and exits
with code 2. Model calls are billed to that OpenRouter account.

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | yes | Authenticates both models on OpenRouter. |
| `TANDEM_EXAMPLE_LOCAL_BASE_URL` | no | Sends the second model to an OpenAI-compatible server at this base URL (for example `http://127.0.0.1:10531/v1`) using the Responses API. Tandem checks that the server lists the model before the run starts. |
| `TANDEM_EXAMPLE_LOCAL_MODEL` | no | Overrides the second model's ID. Defaults to `openai/gpt-5.6-sol` on OpenRouter, or `gpt-5.6-sol` on the local server. |

The first model (the songwriter, proposer or implementer) is always
`deepseek/deepseek-v4-flash-0731` on OpenRouter. The second model (the proofreader, critic and
judge, or reviewer) uses OpenRouter unless `TANDEM_EXAMPLE_LOCAL_BASE_URL` is set. If that URL
cannot be reached, the example names the variable and exits with code 2.

The debate example also has a `tandem.config.ts` so [Tandem Studio](../studio) can show its
pipeline. Loading it does not call a model.
