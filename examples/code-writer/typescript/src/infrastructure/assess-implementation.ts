import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { VerificationResult } from "../state.js";

const cases = [
  { input: "  Hello, World!  ", expected: "hello-world" },
  { input: "Crème brûlée", expected: "creme-brulee" },
  { input: "already---slugged", expected: "already-slugged" },
  { input: "___Edge___", expected: "edge" },
  { input: "!!!", expected: "" },
  { input: "mañana café 123", expected: "manana-cafe-123" },
] as const;

const outputLimit = 64 * 1024;
const timeoutMs = 2_000;
const workerPath = new URL("assess-implementation-worker.mjs", import.meta.url).pathname;
const execFileAsync = promisify(execFile);

const ExecFailure = z.object({
  message: z.string(),
  code: z.union([z.string(), z.number()]).nullish(),
  killed: z.boolean().optional(),
  signal: z.string().nullish(),
  stderr: z.string().default(""),
});

const failed = (error: string): VerificationResult => ({ passed: false, cases: [], error });
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const describeFailure = (error: unknown): string => {
  const failure = ExecFailure.safeParse(error);
  if (!failure.success) {
    return `Assessment failed: ${String(error)}`;
  }
  const { message, code, killed, signal, stderr } = failure.data;
  if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return `Assessment output exceeded ${outputLimit} bytes.`;
  }
  if (killed) {
    return `Assessment timed out after ${timeoutMs}ms.`;
  }
  if (typeof code === "number" || signal) {
    const errorOutput = stderr.trim();
    return `Assessment exited with ${signal ?? code}${errorOutput ? `: ${errorOutput}` : ""}`;
  }
  return `Assessment failed: ${message}`;
};

export const assessImplementation = async (source: string): Promise<VerificationResult> => {
  const directory = await mkdtemp(join(tmpdir(), "tandem-function-assessment-"));
  try {
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(
        process.execPath,
        [workerPath, JSON.stringify({ source, cases })],
        { cwd: directory, env: {}, timeout: timeoutMs, maxBuffer: outputLimit, killSignal: "SIGKILL" },
      ));
    } catch (error) {
      return failed(describeFailure(error));
    }
    try {
      return VerificationResult.parse(JSON.parse(stdout));
    } catch (error) {
      return failed(`Assessment returned invalid output: ${messageOf(error)}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};
