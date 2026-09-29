# tandem-ts slop cleanup spec

Status: ready. Decisions made 2026-09-29 (§4).
Baseline: `main` @ `707f9c7` (2026-09-29). Line numbers are from that commit; re-locate by symbol name if they have moved.
Source: independent slop hunt (2026-09-29). This repo has no prior review documents, so every item is `NEW`.

This file is self-contained. A worker (human or subagent) should be able to pick up one work package (WP) from this file alone.

---

## 1. Objective

Remove hand-rolled machinery, duplicated validation, dead code and ceremony from tandem-ts **without shims** (breaking simplifications are allowed; see Non-goals). Target: about 1,700 LOC removed, and `src/index.ts` (2,319 LOC) shrunk by roughly 40%.

Repo layout:
- `src/index.ts`: the published library, a TS facade loading the .NET Tandem bridge in-process via `node-api-dotnet` (`runtime/loader.mjs`).
- `packets/`: separate package.
- `studio/`: Nuxt 4 SPA plus `studio/src` server-side helpers and `studio/server/api`.
- `examples/*/typescript`.
- `tests/`: `node:test` plus child-process harnesses.

Non-goals:

- No change to the .NET bridge (`~/Sites/tandem`) or the vendored `runtime/` bundles (G1: deferred).

**Breaking changes are allowed and preferred over shims.** The package has no consumers other than its owner. Never add or keep a compatibility layer: no deprecated aliases, no dual code paths for old shapes, no forwarding wrappers. If simplifying changes an exported type or behaviour, change it, update `tests/types`, the examples and the README in the same WP, and note it in the ledger.
- No new dependencies beyond those named in a WP.
- No release, publish, tag or push.

Premise correction from the hunt: there is **no** JSON-RPC or line-protocol framing to replace, because the bridge is in-process. Don't introduce `vscode-jsonrpc` or similar.

## 2. Doctrine (inline summary — Meridian)

- **Libraries before machinery.** Zod is furniture at untrusted boundaries (options objects from users, HTTP bodies, `JSON.parse` output, child-process messages). Prefer `node:` built-ins (`util.parseArgs`, `util.isDeepStrictEqual`, `child_process.execFile` with `timeout`/`maxBuffer`/`killSignal`, `events.once`, `AbortSignal.timeout`, `Promise.withResolvers`) over hand-rolled equivalents.
- **Seams must be earned.** No classes that only hold constructor arguments, no forwarding wrappers, no interface + class + factory triples for plain data.
- **Strict types.** No `any` or `unknown` as a value carrier. No convenience `!`, and no `?.`/`??` hiding unclear state. Fix the type (discriminated unions) instead. No `x as T` on unvalidated input.
- **One schema, one type.** Where a Zod schema exists, derive the TS type with `z.infer`. Don't hand-write both.
- **No `process.env` directly.** Read the environment once through a validated config object.
- **Nuxt composition.** Composition happens only in `app.vue`, layouts or pages, via `provideX`. Components and composables use `injectX`. Components are dumb (props/events); don't pass callbacks through data objects. `ssr: false`.
- **No type-tag file suffixes** (`.service.ts`, `.port.ts`, …).
- **No self-narrating comments.** Comments explain *why*.
- **Let patterns prove themselves.** Only extract a shared helper at ≥3 copies or when the copies have drifted.

## 3. Ground rules for every WP

1. **Stay in your lane** (§6). Record cross-lane needs as follow-ups; don't make them.
2. **Behaviour-preserving by default.** Existing tests pass unchanged, except tests that only pin removed test hooks (delete them, and list them in the ledger). Where a WP deliberately simplifies behaviour or the API, update the tests to the new behaviour. Keep the error types (`TandemError`, `TandemCancellationError`) and their `name`s.
3. **Red first** for any bug a WP uncovers.
4. **Type-level API check.** `tests/types/positive` and `tests/types/negative` must pass (update them only for deliberate API simplifications). Also snapshot the emitted `dist/index.d.ts` before starting (`pnpm build && cp dist/index.d.ts /tmp/tandem-dts-before.d.ts`) and diff after each library WP. Any change must be explained; internal-only changes (class → record) must not leak into the `.d.ts`.
5. **Grep to prove dead**, across `src`, `packets`, `studio`, `examples` and `tests`. Record the evidence.
6. **Gate** before marking a WP done:
   - Root: `pnpm typecheck && pnpm test && pnpm build`.
   - Studio (if touched): `pnpm -C studio typecheck && pnpm -C studio test`.
   - Examples (if touched): typecheck the example package.
   - Meridian: `~/Sites/plumb/plumb . --json`. Fix errors; fix warns or record the exception.
7. **No commits unless asked.** Update the ledger (§8).

---

## 4. Decisions (made 2026-09-29, all final)

| ID | Decision | Affects |
|---|---|---|
| G1 | **Defer** the bridge callback error protocol change (it needs a `~/Sites/tandem` change and rebuilt runtime bundles). Do only the TS half of L6 now. | L6 |
| G2 | **Keep** the `jsonValueProblem` walker, but run it only when the stringify/parse round-trip fails, to name the path. | L4 |
| G3 | **Do** replace studio polling with SSE (h3 `createEventStream` plus a native `EventSource`). | S5 |
| G4 | **Add** `zod` as a direct `studio` dependency. | S1 |

---

## 5. Work packages

### Lanes and order

- **Lane L — Library:** owns `src/**`, `tests/types/**`. Single worker, serial, because almost everything is in `src/index.ts`. Order: L1 → L2 → L3 → L4 → L5 → L6 → L7.
- **Lane S — Studio:** owns `studio/**`. Serial within the lane. Order: S1 → S2 → S3 → S4 → S5.
- **Lane T — Tests, examples and packets:** owns `tests/**` (except `tests/types/**`), `examples/**`, `packets/**`. Order: T1 → T2 → T3.

The three lanes are file-disjoint and can run in parallel. Merge T, then S, then L.

Each WP lists: **Est. LOC saved · Depends**, then Problem, Change, Acceptance.

---

### Lane L — Library (`src/**`)

#### L1 — Zod schemas for definition options
~180 LOC · no dependencies

**Problem.**
- `agent()` runs about 150 lines of hand-written `if` checks (`src/index.ts:1001-1172`): reasoning, the checkpoint block, the session enum, `typeof boolean` checks.
- The 32-bit integer range check is repeated about 5 times, including the collection/parallel `max` checks (`520-525`, `1225-1232`).
- `validateAgentCommands` (`874-916`, `917-922`) hand-walks `unknown`.
- Zod is already a peer dependency.

**Change.**
- One module-level Zod schema per public definition (`agent`, `taskAgent`, `collection`, `parallel`, `pipeline` options).
- A shared `const int32 = z.number().int().min(…).max(2 ** 31 - 1)`.
- `z.enum` for the enumerations, and `.refine`/`.superRefine` for exactly-one-of rules.
- Map `ZodError` to `TandemError` in one place, reusing the existing issue-path formatter (`src/index.ts:187-191`).
- Keep the error messages recognisable: the tests grep for some of them; check `tests/*` before rewording.

**Acceptance.** Every existing validation test passes. Add one table-driven test per schema covering each refusal the old code made (enumerate them from the deleted `if`s before deleting).

#### L2 — Validate workspace commands once
~60 LOC · Depends: L1

**Problem.** Workspace commands are validated at `agentWorkspace()` (`src/index.ts:859-861`), again in `commandsCallback` (`2182`), and a third time by `serializeBoundary` against an inline Zod schema that is rebuilt on every call (`2184-2196`).

**Change.** One module-level `AgentCommandSchema`, applied once at the untrusted boundary (the user-supplied definition). Downstream code receives the parsed type.

**Acceptance.** Command tests pass. `grep -n validateAgentCommands src/index.ts` shows at most one call site, or none if replaced by the schema.

#### L3 — Derive `RunObservation` and `AcceptedValue` types from Zod
~80 LOC · Depends: L1

**Problem.**
- `RunObservation` is declared twice: as a TS union (`src/index.ts:1548-1594`) and as nine `.strict()` Zod objects (`1611-1696`) that each repeat `version`, `kind`, `stepId` and `visitId`.
- `AcceptedValue` (`1705-1714`) and `acceptedValueSchema` (`1715`) are duplicated too, and `inspectAccepted` re-maps with an `as AcceptedValue` cast (`1756`).

**Change.**
- `const base = z.object({ version, stepId, visitId })`, with `base.extend({ kind: z.literal(...) , ... }).strict()` per variant, combined with `z.discriminatedUnion("kind", [...])`.
- `export type RunObservation = z.infer<typeof runObservationSchema>`, and the same for `AcceptedValue`.
- Remove the cast.

**Acceptance.** The `.d.ts` diff shows structurally identical exported types. If a type becomes an alias of an inferred type, check that `tests/types` still pass and that the hover shape is acceptable.

#### L4 — One JSON-boundary check (G2)
~60–90 LOC · Depends: L3

**Problem.** `src/index.ts:216-349` checks the JSON boundary three times:
- `parse()` requires the Zod output to `isDeepStrictEqual` the input.
- `serializeBoundary` runs `jsonValueProblem`, a hand-written walker.
- Then it does a `JSON.stringify` → `JSON.parse` → `isDeepStrictEqual` round-trip.

The round-trip alone catches undefined, NaN, bigint, functions, class instances, sparse arrays, cycles (as a throw) and symbol keys. Only accessor and non-enumerable properties slip past it.

**Change.** Run the round-trip first. Call the walker only when it fails, to produce a path-precise message.

**Acceptance.** The JSON-boundary tests (`tests/json-boundaries-child.mjs` and the callers in `runtime.test.mjs`) pass, with the same error type and the same or a better path.

#### L5 — Node definitions as tagged records, not implementation classes
~200 LOC · Depends: L4

**Problem.**
- Every node kind is an interface + brand symbol + `*Implementation` class + factory with a positional constructor (`src/index.ts:6-11,370-418,529-563,614-687,962-1000,1155-1171,1186-1278`).
- `AgentImplementation` takes 15 positional parameters.
- `CollectionImplementation` stores `definition` directly while the others unpack it, so the style is inconsistent.
- `TaskAgentImplementation` receives `id`/`input`/`result` both positionally and inside `definition` (`490-495`).
- `compileNode` and `inspectPipeline` downcast with `as XImplementation`/`instanceof` (`1457,1471,1483,1503,1518,1936,2150`).

**Change.**
- Factories return `Object.freeze({ [brand]: true, kind: "agent", ...parsedDefinition })`.
- Consumers `switch (node.kind)` with an exhaustive `never` default.
- The public types stay the opaque branded interfaces they are today, so the `.d.ts` must not expose the new internal shape. Keep the brand symbol unexported.

**Acceptance.**
- `.d.ts` diff: exported node types unchanged.
- `grep -n "Implementation\b" src/index.ts` returns nothing.
- `grep -n " as [A-Z][A-Za-z]*Implementation" src/index.ts` returns nothing.
- All tests pass.

#### L6 — Callback error channel (TS half only; G1)
~70 LOC · Depends: L5

**Problem.**
- `CallbackRegistry` (`src/index.ts:59-142`) catches a JS error, serialises it to a JSON `CallbackResult`, and the bridge embeds that in an exception message. `callbackContractFailure` (`158-185`) scrapes `"TANDEM_CALLBACK_CONTRACT:"` back out of `error.message`.
- `isCancellationError` (`172`) regex-matches "operation was cancel(l)ed".
- `invokeSync` and `invokeAsync` are copy-pasted, over two separate maps.

**Change.**
- **Now (TS only):**
  - Collapse the two maps into one `Map<string, AsyncCallback>`, wrapping sync callbacks.
  - One `invoke` path.
  - Put the marker string and the cancellation regex in one named constant each, with a *why* comment ("the bridge surfaces JS errors only as message text").
  - Where the abort signal is available, prefer `signal.aborted` over the regex.
- **Later, with the next bridge rebuild (G1, out of scope for this spec):**
  - The bridge returns a structured error object (`{ kind, message, path }`) or propagates the JS error via node-api-dotnet.
  - Delete the marker scraping and the regex.
  - Rebuild and vendor both runtime bundles.

**Acceptance.** Cancellation, callback-contract and lifecycle tests (`tests/lifecycle-child.mjs`, `tests/function-protocol-server.mjs` users) pass.

#### L7 — Library small items
~40 LOC · Depends: L6

- **Non-null assertions** at `src/index.ts:461,637,1392,1781,1828,2087,2227,2249,2280,2286,2297,2312`. Most come from `compileAgentOutput` taking a loose `{ schema?, raw?, parse? }` bag (`2261-2268`) instead of the discriminated union that `AgentDefinition.output` already has. Pass the union and remove the `!`s.
- **Unvalidated bridge input:** `JSON.parse(input) as AgentToolInvocation` (`2245`) and `JSON.parse(input) as TOutput` (`2286,2297`). Parse with the relevant Zod schema, since every other boundary does.
- **Error type:** `pipeline()` throws a plain `Error` (`1324-1408`), while everything else throws `TandemError`. Switch to `TandemError`. Check first whether any test asserts `instanceof Error` only (which is fine; `TandemError` extends it).
- **Loader import:** `await import("./runtime/loader.mjs")` is repeated at `1742,1832,1969`. Use one memoised `loadRuntime()`.
- **Group key:** the `\u0000` group-key string is built in 3 places (`src/index.ts:1372`, `studio/server/api/graph.get.ts:54`, `studio/app/pages/index.vue:190`). Export one internal `groupKey()` from the library only if studio already imports from it; otherwise keep studio's copies local and fix only the library's. Record this as a Lane S follow-up.

**Acceptance.** `grep -cE "[A-Za-z0-9_)\]]!\." src/index.ts` is reduced to the ones justified by a comment. All gates pass.

---

### Lane S — Studio (`studio/**`)

#### S1 — Validated environment and request bodies (G4)
~110 LOC · no dependencies

**Problem.**
- `process.env` is read directly in 4 handlers: `server/api/graph.get.ts:7-11`, `open.post.ts:7-12`, `routes.post.ts:10-14`, `changes.get.ts:4-6`. It is also read in `src/loader.ts:23` and `src/source-open.ts:70`.
- The `discoverConfig(process.env.TANDEM_STUDIO_CWD ?? process.cwd(), process.env.TANDEM_STUDIO_CONFIG)` + `loadPipeline` preamble is copied into 3 handlers.
- Untrusted HTTP bodies are validated by hand: `validateRouteEdit` in `src/edit.ts:13-128` has an allowed-keys table and `typeof` checks, and `parseSourceTarget` in `src/source-open.ts:14-44` counts `Object.keys`. `routes.post.ts:15-19` uses `readBody<RouteEditRequest>` with no validation.
- `RouteEdit` is hand-typed separately in `src/source.ts:11-31`.

**Change.**
- `src/env.ts`: a Zod-parsed `studioEnv` (or Nuxt `runtimeConfig`), read once.
- `server/utils/pipeline.ts`: `loadCurrentPipeline()`.
- `RouteEditSchema = z.discriminatedUnion("kind", [...variants.map(v => v.strict())])`, with `type RouteEdit = z.infer<typeof RouteEditSchema>`. Keep the graph-aware checks (endpoint existence, outcome rules) as a small `.superRefine` or a separate post-parse step.
- Handlers use `readValidatedBody(event, RouteEditSchema.parse)`, and the same for the source-open target.

**Acceptance.** `grep -rn "process.env" studio/server studio/src` shows only `src/env.ts`. Studio tests pass. Add tests for an unknown key and for a wrong-type field being rejected with 400.

#### S2 — Child-process lifecycle via built-ins
~70 LOC · Depends: S1

**Problem.**
- `src/loader.ts:14-95` hand-rolls a `settled` flag, `setTimeout`, `terminate`, and an `isLoadResult` type guard.
- `src/edit.ts:337-349` (`typecheckProject`) spawns and collects output by hand.

**Change.**
- `loader.ts`: `fork(childPath, { timeout, killSignal: "SIGKILL" })` (or `{ signal: AbortSignal.timeout(ms) }`) with `await once(child, "message")`, and parse the message with a Zod `LoadResultSchema`.
- `typecheckProject`: `promisify(execFile)` with `{ maxBuffer }`. Alternatively, since ts-morph is already loaded, `project.getPreEmitDiagnostics()` in-process; pick that one only if it matches `tsc` output for the existing tests.
- Remove the test hook `LoadOptions.timeoutMs` (only used by `tests/loader.test.ts:82`) by making the timeout a module constant that the test overrides through the validated env from S1, or by testing the timeout path with a child that never replies. Record which.

**Acceptance.** `tests/loader.test.ts` passes, including the timeout case.

#### S3 — Split and type `app/pages/index.vue`
~390 LOC out of the page · Depends: S2

**Problem.**
- 1,190 LOC.
- `any` appears 37 times: `type Graph = any` and `type Ownership = any` (27-28), `ref<any>`, and untyped `$fetch` results, although Nitro infers typed `$fetch` responses from `server/api`.
- All state, layout, editing and polling live in the page, with no `provideX`/`injectX`.
- Node data carries callbacks (`selectRoute`, `hoverRoute`, `restoreEmphasis`, 127-129) into `SemanticNode.vue`.
- WET:
  - `submit` (448-487) and `submitRaw` (500-517) are the same `$fetch`/saving/reload block.
  - `setMode` (518-560) hand-snapshots and restores 11 refs.
  - `revealCompactedRoute` (253-284) duplicates the edge construction in `publish` (132-152).
  - `kindLabel` (600-611) is copy-pasted as `SemanticNode.vue:14-25 cue`.
  - `JSON.stringify` equality is used for change detection (156, 177-179).
- `as any` at 87 gets past `elk.layout`.

**Change.**
- Composables `useStudioGraph` and `useRouteEditor` in `app/composables/`, exposed through `export const [injectStudioGraph, provideStudioGraph] = useProvideInject<StudioGraph>("StudioGraph")` (and the same for the editor) in `app/ports/`. `provide*` is called only in the page; components `inject*`.
- Delete the `any` annotations and let `$fetch` infer. Type the ELK call with elkjs's own `ElkNode`/`ElkExtendedEdge` (see S4).
- `SemanticNode` emits events instead of calling callbacks from its data.
- One `postEdit(body)`, one `toFlowEdge(...)`, and one shared `kindLabels` const.
- Group the 11 mode refs into one `reactive` mode-state object snapshotted with `structuredClone(toRaw(...))`.
- Replace the stringify equality with a typed comparison of the fields that matter, or with `ohash`'s `isEqual` added as an explicit dependency. Don't import a transitive dependency.

**Acceptance.** `grep -c "\bany\b" studio/app/pages/index.vue` returns 0. `studio/tests-ui/page.test.ts` passes (update selectors only if the DOM structure legitimately moved). `pnpm -C studio typecheck` is clean.

#### S4 — Studio small items
~110 LOC · Depends: S3

- **Config walk-up:** written twice (`src/discovery.ts:10-22`, `src/edit.ts:321-333`). Use `ts.findConfigFile(start, ts.sys.fileExists, name)`; TypeScript is already a dependency. In `discovery.ts:6`, `isAbsolute ? x : resolve(start, x)` is just `resolve(start, x)`.
- **Argument parsing:** `src/cli-args.ts` (12 LOC) → `node:util` `parseArgs({ options: { config: { type: "string" } }, strict: true })`, inlined into `cli.ts`. Delete the file.
- **ts-morph lookup:** "find `pipeline({name})` → `routes` array" is written twice (`src/source.ts:38-58`, `src/ownership.ts:50-80`) → one `findPipelineRoutesArray(sourceFile, name)`. `locateOwnership` parses the whole project on every `graph.get`, `open.post` and `applyRouteEdit`; cache it by watcher generation.
- **ELK types:** `src/elk-geometry.ts:1-13` declares its own ELK types → use elkjs's `ElkNode`, `ElkExtendedEdge`, `ElkEdgeSection` and `ElkPoint`. Point extraction is written twice (`18-20`, `55-60`) → one `sectionPoints()`.
- **`src/presentation.ts` dead code and test hooks (grep-verified):**
  - `retainLastValid` (53-60) is only used by `tests/presentation.test.ts`.
  - `positionStorageKey` (14) is only the default of a parameter that the sole caller (`index.vue:109`) always overrides.
  - `positionsForIncomingIdentity` is a 5-argument wrapper around a ternary.
  - `ReloadGeneration` is a class wrapping one counter.
  - `openSourceLocation`'s `launch = spawn` parameter (`src/source-open.ts:69`) is a test hook, used only by `tests/source-open.test.ts:57`. Test it by pointing the validated editor command at a stub executable instead.

**Acceptance.** Studio gates pass. Each deletion's grep evidence is in the ledger.

#### S5 — Push instead of polling (G3)
~30 LOC · Depends: S4

**Problem.** `index.vue:630-649` polls every 500ms with a re-entrancy flag (`checkingChanges`) against a chokidar generation counter (`server/api/changes.get.ts`).

**Change.** `server/api/changes.get.ts` → an h3 `createEventStream` fed by the existing chokidar watcher (`src/watch.ts`). The client uses a native `EventSource` inside `useStudioGraph`, closing it on unmount.

**Acceptance.** Editing a watched file updates the graph in the UI test (or in a manual check, recorded in the ledger). There is no `setInterval` in `app/`.

---

### Lane T — Tests, examples and packets

#### T1 — Shared test harness
~220 LOC · no dependencies

**Problem.**
- Seven hand-written fake OpenAI SSE servers, each re-typing the `chat.completion.chunk` / `data:` framing: `tests/concurrent-ledger-child.mjs:12-20`, `ledger-tools-child.mjs:17-28`, `raw-user-only-child.mjs:8-22`, `collection-child.ts:29-46`, `skill-server-child.mjs`, `openai-server-child.mjs`, `function-protocol-server.mjs`.
- Child-runner boilerplate is copied 18 times in `tests/runtime.test.mjs`: `exec(process.execPath, [new URL("x-child.mjs", import.meta.url).pathname, mode], { timeout: 15_000 })` + `JSON.parse(stdout.trim())`. There are 23 `JSON.parse(stdout…)` sites and 10 `const exec = promisify(execFile)` declarations. `runtime.test.mjs` already has `child()`/`observationChild()` helpers, and `parallel.test.mjs:7` has a `runChild`.
- Manual deferreds (`let release; new Promise(r => { release = r })`) in `tests/parallel-child.mjs:6-9`, `lifecycle-child.mjs` and `parallel-outcomes-child.mjs`.

**Change.**
- `tests/support/fake-openai.mjs` exporting `startFakeOpenAi(respond) → { url, close }` over `node:http`. msw can't intercept the .NET HTTP client, so a real local server is the right tool.
- `tests/support/run-child.mjs` exporting `runChild(file, ...args)` returning parsed JSON.
- `Promise.withResolvers()` (Node ≥22 is the declared engine).

**Acceptance.** `pnpm test` passes with the same test count. `grep -c "promisify(execFile)" tests/*.mjs` totals 1.

#### T2 — Example child process
~70 LOC · Depends: T1

**Problem.** `examples/code-writer/typescript/src/infrastructure/assess-implementation.ts:19-91` hand-rolls byte limits, a timer and a `settled` flag, then casts with `as VerificationResult` (line 75).

**Change.** `promisify(execFile)(cmd, args, { timeout, maxBuffer, killSignal: "SIGKILL" })`, and parse the result with a Zod `VerificationResultSchema`. Handle the error's `killed`/`signal`/`code` fields explicitly, since `execFile` rejects on non-zero exit.

**Acceptance.** The example typechecks. If the example has tests or a smoke run, it passes.

#### T3 — Packets small items
~15 LOC · Depends: T1

- In `packets/src/index.ts:246-259` (`zodPath`), the `value === ""` branch can never be true (the accumulator starts at `"$"`), and the `length === 0` early return is redundant. Simplify.
- Don't share it with `src/index.ts`: they are separate packages, and two small copies are cheaper than a cross-package dependency.
- The packet size limit is checked twice (`packets/src/index.ts:54` byteLength and `:139` stat). Keep the check at the boundary that sees untrusted input and delete the other, recording which and why.

**Acceptance.** `tests/packets.test.mjs` passes.

---

## 6. Explicitly not doing

- Deleting exported types with no internal references (`AgentToolEffect`, `TerminalPresentationOptions`, `TaskAgentReference`, `OrdinaryRoute`, …): they are public API for consumers.
- Removing the curried `parallel<T>()` overload: it exists for type inference and is covered by `tests/types`.
- Removing `TandemCancellationError`: it is reached through `name === "AbortError"`.
- Splitting `src/index.ts` into modules. That would be a reasonable follow-up once L1–L7 have shrunk it, but it isn't part of this spec.

## 7. Subagent brief template

> You are implementing work package **<WP-ID>** from `/Users/max/Sites/tandem-ts/docs/plans/slop-cleanup.md`. Read §2 (doctrine), §3 (ground rules), §4 (gates) and your WP in full first.
>
> - Only edit the files your lane owns (§5). Record anything outside that as a follow-up; don't do it.
> - Behaviour-preserving. Write red tests first for any bug you uncover.
> - Library WPs: diff `dist/index.d.ts` against `/tmp/tandem-dts-before.d.ts` and explain any change.
> - Run the §3 gate and Plumb before finishing.
> - Don't commit.
> - Report: files changed, LOC delta (`git diff --stat`), tests added or removed (with reasons), grep evidence for deletions, `.d.ts` diff, and follow-ups. Append a row to the §8 ledger.

Run one agent per lane in parallel, each in its own git worktree (`isolation: "worktree"`). Lane L is serial within itself. Merge the lanes in the order T, S, L.

## 8. Ledger

| WP | Status | LOC Δ | Tests (+/−) | `.d.ts` diff | Notes / follow-ups |
|---|---|---|---|---|---|
| Baseline (Lane L) | done | 0 | 89 pass | captured `/tmp/lane-l-dts-before.d.ts` (431 lines) | `tests/types` were never runnable: unquoted `../packets/dist/index.js` import (syntax error) and `negative/tsconfig.json` failed on `rootDir`. Fixed import paths; replaced it with one `tests/types/tsconfig.json` covering positive + negative (`npx tsc -p tests/types/tsconfig.json`, needs `pnpm build` + packets built). Follow-up (root config, not Lane L): wire it into `pnpm typecheck`/CI. Plumb baseline: 4 repo-tooling warns, none in `src`. |
| L1 | done | `src/index.ts` −45 net (+125/−170; 2,319 → 2,274) | +43 (`tests/definition-validation.test.mjs`, new file: one table per `agent`/`taskAgent`/`collection`/`parallel`/`skill`, one row per refusal the deleted `if`s made, plus one acceptance case) | none (0 lines) | Module-level `agentOptionsSchema`, `collectionOptionsSchema`, `parallelOptionsSchema`, `skillSchema`; shared `positiveInt32 = z.int32().min(1)`, `nonBlankString`, `hasUnique`. One `parseDefinition(schema, value, subject)` maps a `ZodError` to `TandemError` as `"<subject> <field path> <problem>"` (existing test regexes such as `/checkpoint session/` and `/positive 32-bit integer/` still match). It does not reuse `path()`, because `$.checkpoint.session` would break those regexes and the error name must stay `TandemError`. Instructions checks stay `ContractValidationError` via `requireInstructions` (tests assert that name). `taskAgent` is validated through `agent()`. `pipeline()` stays procedural: its checks are graph identity/reachability, not shape. The blank-branch-ID check moved from `pipeline()` into the parallel schema (it now fails at `parallel()`). Messages reworded: see the new test for the exact texts. |
| L2 | done | `src/index.ts` −43 net (+34/−77; → 2,231) | +11 rows in `tests/definition-validation.test.mjs` (one per refusal the deleted `validateAgentCommands` made, plus an unknown key) | none | One module-level strict `agentCommandsSchema`. Static catalogues are parsed once in `agentWorkspace()`; the parsed copy is the snapshot, so `copyAgentCommand` is deleted. A function catalogue is parsed once per call inside `commandsCallback` (its output is the untrusted boundary), then `JSON.stringify`d. The inline per-call `serializeBoundary` schema is gone. `grep -n validateAgentCommands src/index.ts` returns nothing. Behaviour change: an unknown key in a *function* catalogue is now a `TandemError` from the command schema rather than a `ContractValidationError` from the inline strict schema. |
