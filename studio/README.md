# `@maxanstey-meridian/tandem-studio`

A local viewer and route editor for a Tandem pipeline. It reads the pipeline exported by a `tandem.config.ts` and serves a Nuxt app on your machine.

```sh
npm install -D @maxanstey-meridian/tandem-studio @maxanstey-meridian/tandem
npx tandem-studio            # finds tandem.config.ts in the current directory
npx tandem-studio --config path/to/tandem.config.ts
```

Requires Node 22+ and the .NET 10 runtime (for Tandem itself). See [tandem-ts](https://github.com/maxanstey-meridian/tandem-ts) for how to write a `tandem.config.ts`; `examples/debate/typescript` has one.
