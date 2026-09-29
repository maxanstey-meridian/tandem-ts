import { spawn } from "node:child_process";
import { z } from "zod";
import { studioEnv } from "./env.js";
import type { SourceOwnership } from "./ownership.js";

export const SourceTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("state") }),
  z.strictObject({ kind: z.literal("participant"), id: z.string() }),
  z.strictObject({ kind: z.literal("callback"), id: z.string(), name: z.string() }),
  z.strictObject({ kind: z.literal("route"), order: z.number().int().nonnegative() }),
]);
export type SourceTarget = z.infer<typeof SourceTargetSchema>;
export interface SourceLocation {
  readonly file: string;
  readonly line: number;
}

export function resolveSourceTarget(
  ownership: SourceOwnership,
  target: SourceTarget,
): SourceLocation | undefined {
  if (target.kind === "state") {
    return ownership.state?.file && ownership.state.line
      ? { file: ownership.state.file, line: ownership.state.line }
      : undefined;
  }
  if (target.kind === "participant") {
    const participant = ownership.participants[target.id];
    return participant?.file && participant.line
      ? { file: participant.file, line: participant.line }
      : undefined;
  }
  if (target.kind === "callback") {
    return ownership.participants[target.id]?.callbacks?.[target.name];
  }
  const route = ownership.routes[target.order];
  return route?.file && route.line ? { file: route.file, line: route.line } : undefined;
}

export function openSourceLocation(location: SourceLocation): void {
  if (studioEnv.editor) {
    spawn(studioEnv.editor, [`${location.file}:${location.line}`], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", location.file] : [location.file];
  spawn(command, args, { detached: true, stdio: "ignore" }).unref();
}
