import { z } from "zod";

export interface Position {
  readonly x: number;
  readonly y: number;
}
const SavedPositionsSchema = z.record(z.string(), z.object({ x: z.number(), y: z.number() }));

/** Positions saved by an earlier session; anything unreadable is ignored rather than trusted. */
export function parseSavedPositions(saved: string | null): Readonly<Record<string, Position>> {
  try {
    return SavedPositionsSchema.parse(JSON.parse(saved ?? "{}"));
  } catch {
    return {};
  }
}

export function mergeStablePositions(
  nodeIds: readonly string[],
  current: Readonly<Record<string, Position>>,
  saved: Readonly<Record<string, Position>>,
  automatic: Readonly<Record<string, Position>>,
): Readonly<Record<string, Position>> {
  return Object.fromEntries(
    nodeIds.map((id) => [id, current[id] ?? saved[id] ?? automatic[id] ?? { x: 0, y: 0 }]),
  );
}
