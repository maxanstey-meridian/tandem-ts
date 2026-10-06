# Contributing to tandem-ts

tandem-ts is the TypeScript authoring surface for
[Tandem](https://github.com/maxanstey-meridian/tandem). The C# authoring API defines Tandem's
semantics: this SDK adapts syntax, validation and transport across the bridge, but never owns
pipeline or agent behaviour a C# application couldn't express. Read Tandem's
[CONTRIBUTING.md](https://github.com/maxanstey-meridian/tandem/blob/main/CONTRIBUTING.md) for
the invariants both repositories share.

## Development

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

## Repository layout

- `src`: the published SDK. `runtime/loader.mjs` picks the bridge bundle for the current platform.
- `runtime/darwin-arm64`, `runtime/linux-x64`: the vendored .NET bridge bundles, copied into
  `dist/runtime` by `pnpm build`.
- `packets`: `@maxanstey-meridian/tandem-packets`, which reads Markdown packet files with YAML
  frontmatter into a Zod schema. `pnpm test` builds it.
- `studio`: Tandem Studio, a local Nuxt viewer and route editor for the pipeline exported by a
  `tandem.config.ts`. Run `pnpm -C studio build`, then `node ../../../studio/dist/cli.js` from
  `examples/debate/typescript`. It has its own `typecheck` and `test` scripts.
- `examples`: see [examples/README.md](examples/README.md).

## Updating the runtime bundles

The bundles are built from the [Tandem](https://github.com/maxanstey-meridian/tandem) .NET
repository; only bundles from a tested Tandem build should be released. Each Tandem release attaches
`tandem-bridge-<version>-darwin-arm64.tar.gz` and `tandem-bridge-<version>-linux-x64.tar.gz`;
replace each platform's directory with its archive's contents:

```sh
rm -rf runtime/darwin-arm64 && mkdir runtime/darwin-arm64
tar -xzf tandem-bridge-<version>-darwin-arm64.tar.gz -C runtime/darwin-arm64
```

To build a bundle from a Tandem checkout instead, run this there for each RID (`osx-arm64` for
`darwin-arm64`, `linux-x64` for `linux-x64`), then replace the matching `runtime/<platform>`
directory with `bridge-runtime/` (delete it first, so files the new build dropped do not linger):

```sh
dotnet publish bridge/Tandem.Bridge.csproj -c Release -p:Version=<version> -r osx-arm64 --self-contained false --output .runtime-publish
node scripts/stage-runtime.mjs osx-arm64
```

Then run `pnpm test`, which exercises the bundle for the current platform. The Linux package
workflow tests the linux-x64 bundle.
