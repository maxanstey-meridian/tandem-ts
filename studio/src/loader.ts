import type { PipelineInspection } from "@maxanstey-meridian/tandem";
import { fork } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { studioEnv } from "./env.js";

const require = createRequire(import.meta.url);
const LoadResultSchema = z.discriminatedUnion("ok", [
  // The graph comes from our own loader child calling inspectPipeline, so only its envelope is checked.
  z.object({
    ok: z.literal(true),
    graph: z.custom<PipelineInspection>((value) => typeof value === "object" && value !== null),
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type LoadResult = z.infer<typeof LoadResultSchema>;

export async function loadPipeline(config: string): Promise<LoadResult> {
  const sourceMode = fileURLToPath(import.meta.url).endsWith(".ts");
  const child = fork(
    studioEnv.loaderChild ??
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        sourceMode ? "loader-child.ts" : "loader-child.js",
      ),
    [config],
    {
      cwd: dirname(config),
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      timeout: studioEnv.loadTimeoutMs,
      killSignal: "SIGKILL",
      ...(sourceMode ? { execArgv: ["--import", require.resolve("tsx")] } : {}),
    },
  );
  let errors = "";
  // stdio[2] is "pipe", so stderr exists.
  child.stderr!.on("data", (value) => (errors += String(value)));
  try {
    const message = await Promise.race([
      new Promise<unknown>((received) => child.once("message", received)),
      once(child, "exit").then(() => undefined),
    ]);
    if (message !== undefined) {
      const parsed = LoadResultSchema.safeParse(message);
      return parsed.success
        ? parsed.data
        : { ok: false, error: "Pipeline loader returned an invalid IPC response." };
    }
    if (child.signalCode === "SIGKILL") {
      return {
        ok: false,
        error: `Pipeline loading exceeded ${studioEnv.loadTimeoutMs}ms. Check tandem.config.ts imports and synchronous construction for blocking work.`,
      };
    }
    return { ok: false, error: errors || "Pipeline loader exited without a response." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    // The config may leave active handles, so the child is always reaped before returning.
    if (child.exitCode === null && child.signalCode === null && child.kill("SIGKILL")) {
      await once(child, "exit");
    }
  }
}
