import type { PipelineInspection } from "@maxanstey-meridian/tandem";
import { hash } from "ohash";
import { discoverConfig } from "../../src/discovery";
import { studioEnv } from "../../src/env";
import { loadPipeline } from "../../src/loader";
import { locateOwnership, type SourceOwnership } from "../../src/ownership";
import { configWorkspace, watchProjectTypescript } from "../../src/watch";

export async function loadCurrentPipeline() {
  const config = await discoverConfig(studioEnv.cwd, studioEnv.config);
  return { config, loaded: await loadPipeline(config) };
}

let cachedOwnership: { readonly key: string; readonly ownership: SourceOwnership } | undefined;

/**
 * Parsing the whole project is the slow part of every read, so it is reused until the
 * workspace watcher reports a TypeScript change. Edits still call locateOwnership directly:
 * the watcher is debounced, and a write must never act on stale ownership.
 */
export async function currentOwnership(
  config: string,
  graph: PipelineInspection,
): Promise<SourceOwnership> {
  const generation = watchProjectTypescript(configWorkspace(config));
  await generation.ready;
  const key = hash([config, generation(), graph]);
  if (cachedOwnership?.key !== key) {
    cachedOwnership = { key, ownership: locateOwnership(config, graph) };
  }
  return cachedOwnership.ownership;
}
