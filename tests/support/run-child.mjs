import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const exec = promisify(execFile);

// Children are plain scripts; the parent's node:test context must not leak into them.
const { NODE_TEST_CONTEXT: _, ...env } = process.env;

export const execChild = (file, args = [], { timeout = 15_000 } = {}) => {
  const path = new URL(`../${file}`, import.meta.url).pathname;
  const loader = file.endsWith(".ts") ? ["--import", "tsx"] : [];
  return exec(process.execPath, [...loader, path, ...args], { timeout, env });
};

export const runChild = async (file, args, options) => {
  const { stdout } = await execChild(file, args, options);
  return JSON.parse(stdout.trim());
};
