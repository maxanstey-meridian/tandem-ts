#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { discoverConfig } from "./discovery.js";
import { studioServerEnvironment } from "./env.js";

try {
  const { values } = parseArgs({ options: { config: { type: "string" } }, strict: true });
  const config = await discoverConfig(process.cwd(), values.config);
  const sourceDirectory = dirname(fileURLToPath(import.meta.url));
  const root = resolve(sourceDirectory, "..");
  const loaderChild = resolve(
    sourceDirectory,
    fileURLToPath(import.meta.url).endsWith(".ts") ? "loader-child.ts" : "loader-child.js",
  );
  const require = createRequire(import.meta.url);
  const nuxt = resolve(dirname(require.resolve("nuxt/package.json")), "bin/nuxt.mjs");
  const child = spawn(process.execPath, [nuxt, "dev", root], {
    stdio: "inherit",
    env: studioServerEnvironment({ cwd: process.cwd(), config, loaderChild }),
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => child.kill(signal));
  }
  child.on("exit", (code) => (process.exitCode = code ?? 1));
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\nUsage: tandem-studio [--config <path>]\n`,
  );
  process.exitCode = 1;
}
