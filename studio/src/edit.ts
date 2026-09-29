import type { PipelineInspection } from "@maxanstey-meridian/tandem";
import { execFile } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { format, type FormatConfig } from "oxfmt";
import { z } from "zod";
import { loadPipeline, type LoadResult } from "./loader.js";
import { editRevision, locateOwnership } from "./ownership.js";
import { editDirectRoute, RouteEditSchema, type RouteEdit } from "./source.js";
const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const oxfmtConfig = resolve(dirname(fileURLToPath(import.meta.url)), "../studio.oxfmtrc.json");
export const RouteEditRequestSchema = z.strictObject({
  edit: RouteEditSchema,
  editRevision: z.string(),
});

/** Checks graph semantics and maps outgoing-group order to pipeline route order. */
export function validateRouteEdit(edit: RouteEdit, graph: PipelineInspection): RouteEdit {
  if (edit.kind === "insert") {
    requireRouteSemantics(graph, edit.from, edit.to, edit.outcome, edit.label, edit.when);
    const group = outgoingRouteIndexes(graph, edit.from, edit.outcome);
    if (edit.order > group.length) {
      throw new Error("order is out of range.");
    }
    const last = group.at(-1);
    return {
      ...edit,
      order: group[edit.order] ?? (last === undefined ? graph.routes.length : last + 1),
    };
  }
  const current = graph.routes[edit.order];
  if (!current) {
    throw new Error("order is out of range.");
  }
  if (edit.kind === "delete") {
    return edit;
  }
  if (edit.kind === "move") {
    const group = outgoingRouteIndexes(graph, current.source, current.outcome);
    if (edit.toOrder >= group.length) {
      throw new Error("toOrder is out of range.");
    }
    const remaining = graph.routes.map((_, index) => index).filter((index) => index !== edit.order);
    const remainingGroup = group.filter((index) => index !== edit.order);
    const target = remainingGroup[edit.toOrder];
    const last = remainingGroup.at(-1);
    const globalBoundary =
      last === undefined
        ? Math.min(edit.order, remaining.length)
        : target !== undefined
          ? remaining.indexOf(target)
          : remaining.indexOf(last) + 1;
    if (globalBoundary < 0) {
      throw new Error("The outgoing route order could not be mapped unambiguously.");
    }
    return { kind: "move", order: edit.order, toOrder: globalBoundary };
  }
  requireRouteSemantics(
    graph,
    edit.from ?? current.source,
    edit.to ?? current.target,
    edit.outcome === null ? undefined : (edit.outcome ?? current.outcome),
    edit.label ?? current.label,
    edit.when,
  );
  return edit;
}
function requireRouteSemantics(
  graph: PipelineInspection,
  from: string,
  to: string,
  outcome: "success" | "failed" | undefined,
  label: string,
  when: string | null | undefined,
): void {
  const source = graph.nodes.find((node) => node.id === from);
  if (!source || !graph.nodes.some((node) => node.id === to)) {
    throw new Error("Route endpoints must be pipeline participants.");
  }
  if (source.kind === "completion" || source.kind === "failure") {
    throw new Error("A terminal output cannot have outgoing routes.");
  }
  const needsOutcome = source.kind === "agent" || source.kind === "parallel";
  if (needsOutcome && outcome === undefined) {
    throw new Error("Agent and parallel routes require a success or failed outcome.");
  }
  if (!needsOutcome && outcome !== undefined) {
    throw new Error("Only agent and parallel routes have standard outcomes.");
  }
  if (!label.trim()) {
    throw new Error("Route label must be non-blank.");
  }
  if (typeof when === "string" && !when.trim()) {
    throw new Error("Route predicate must be a non-blank TypeScript expression.");
  }
}
export function outgoingRouteIndexes(
  graph: PipelineInspection,
  source: string,
  outcome: "success" | "failed" | undefined,
): number[] {
  return graph.routes.flatMap((route, index) =>
    route.source === source && route.outcome === outcome ? [index] : [],
  );
}
export function resolveRouteBoundary(
  sourceIndexes: readonly (number | undefined)[],
  boundary: number,
  arrayLength: number,
  removed?: number,
): number {
  if (boundary < 0 || boundary > sourceIndexes.length) {
    throw new Error("Route placement boundary is out of range.");
  }
  const shifted = sourceIndexes.map((index) =>
    index === undefined
      ? undefined
      : index >= (removed ?? Number.POSITIVE_INFINITY)
        ? index - 1
        : index,
  );
  const length = arrayLength - (removed === undefined ? 0 : 1);
  if (sourceIndexes.length === 0) {
    if (length === 0 && boundary === 0) {
      return 0;
    }
    throw new Error("Route placement crosses a helper-generated boundary.");
  }
  if (boundary === 0) {
    if (shifted[0] === 0) {
      return 0;
    }
    throw new Error("Route placement before helper-generated routes is ambiguous.");
  }
  if (boundary === sourceIndexes.length) {
    const last = shifted.at(-1);
    if (last !== undefined && last === length - 1) {
      return length;
    }
    throw new Error("Route placement after helper-generated routes is ambiguous.");
  }
  const left = shifted[boundary - 1],
    right = shifted[boundary];
  if (left !== undefined && right !== undefined && left + 1 === right) {
    return right;
  }
  throw new Error("Route placement crosses a helper-generated or ambiguous route.");
}
export async function withExactFileRollback<T>(
  file: string,
  changed: string,
  validate: () => Promise<T>,
  expectedBefore?: Buffer,
): Promise<T> {
  const before = await readFile(file);
  if (expectedBefore && !before.equals(expectedBefore)) {
    throw new Error(`'${file}' changed externally before Studio could write the edit.`);
  }
  try {
    await writeFile(file, changed);
    return await validate();
  } catch (error) {
    const current = await readFile(file);
    if (!current.equals(Buffer.from(changed))) {
      throw new Error(
        `Edit failed, but '${file}' changed externally during validation; Studio left the newer contents intact. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await writeFile(file, before);
    throw error;
  }
}

export async function applyRouteEdit(
  config: string,
  graph: PipelineInspection,
  requested: RouteEdit,
  expectedRevision: string,
): Promise<LoadResult> {
  let edit: RouteEdit;
  try {
    edit = validateRouteEdit(requested, graph);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const ownership = locateOwnership(config, graph);
  if (editRevision(graph, ownership) !== expectedRevision) {
    return {
      ok: false,
      error:
        "The pipeline source changed after this graph was displayed. Reload and retry the edit.",
    };
  }
  const owner = edit.kind === "insert" ? undefined : ownership.routes[edit.order];
  const file = edit.kind === "insert" ? ownership.routeArray?.file : owner?.file;
  if (!file || (edit.kind !== "insert" && !owner?.editable)) {
    return {
      ok: false,
      error: owner?.reason ?? "No unambiguous direct routes array owns this edit.",
    };
  }
  const reference = (id: string) => {
    const item = ownership.participants[id];
    if (!item?.editable || !item.expression) {
      throw new Error(`Participant '${id}' has no unambiguous direct source binding.`);
    }
    return item.expression;
  };
  try {
    let resolved: RouteEdit;
    const indexes = ownership.routes.map((route) =>
      route.editable ? route.sourceIndex : undefined,
    );
    if (edit.kind === "insert") {
      const before = resolveRouteBoundary(indexes, edit.order, ownership.routeArray!.length);
      resolved = { ...edit, order: before, from: reference(edit.from), to: reference(edit.to) };
    } else if (edit.kind === "delete") {
      resolved = { ...edit, order: owner!.sourceIndex! };
    } else if (edit.kind === "move") {
      const source = owner!.sourceIndex!;
      const remaining = indexes.filter((_, index) => index !== edit.order);
      const target = resolveRouteBoundary(
        remaining,
        edit.toOrder,
        ownership.routeArray!.length,
        source,
      );
      resolved = { kind: "move", order: source, toOrder: target };
    } else {
      resolved = {
        ...edit,
        order: owner!.sourceIndex!,
        ...(edit.from ? { from: reference(edit.from) } : {}),
        ...(edit.to ? { to: reference(edit.to) } : {}),
      };
    }
    const ownedBefore = await readFile(file);
    const changed = await editDirectRoute(file, graph.name, resolved);
    const formatted = await formatSourceText(file, changed);
    try {
      return await withExactFileRollback(
        file,
        formatted,
        async () => {
          const diagnostics = await typecheckProject(dirname(config));
          if (diagnostics) {
            throw new Error(diagnostics);
          }
          const loaded = await loadPipeline(config);
          if (!loaded.ok) {
            throw new Error(loaded.error);
          }
          return loaded;
        },
        ownedBefore,
      );
    } catch (error) {
      return {
        ok: false,
        error: `Edit was not saved: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
export async function formatSourceText(file: string, source: string): Promise<string> {
  const options = JSON.parse(await readFile(oxfmtConfig, "utf8")) as FormatConfig;
  const result = await format(file, source, options);
  if (result.errors.length > 0) {
    throw new Error(result.errors.map((error) => error.message).join("\n"));
  }
  return result.code;
}

export async function typecheckProject(start: string): Promise<string> {
  let directory = start,
    config: string | undefined;
  for (;;) {
    const candidate = resolve(directory, "tsconfig.json");
    try {
      await access(candidate);
      config = candidate;
      break;
    } catch {}
    const parent = dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }
  if (!config) {
    return "No tsconfig.json was found for save validation.";
  }
  try {
    await execFileAsync(
      process.execPath,
      [require.resolve("typescript/bin/tsc"), "--noEmit", "--project", config],
      { cwd: dirname(config), maxBuffer: 16 * 1024 * 1024 },
    );
    return "";
  } catch (error) {
    const output =
      typeof error === "object" && error !== null && "stdout" in error && "stderr" in error
        ? `${String(error.stdout)}${String(error.stderr)}`
        : "";
    return output || (error instanceof Error ? error.message : String(error));
  }
}
