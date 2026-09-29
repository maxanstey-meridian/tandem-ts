import { locateOwnership } from "../../src/ownership";
import { openSourceLocation, resolveSourceTarget, SourceTargetSchema } from "../../src/source-open";
import { loadCurrentPipeline } from "../utils/pipeline";

export default defineEventHandler(async (event) => {
  const target = await readValidatedBody(event, SourceTargetSchema.parse);
  const { config, loaded } = await loadCurrentPipeline();
  if (!loaded.ok) {
    return loaded;
  }
  const location = resolveSourceTarget(locateOwnership(config, loaded.graph), target);
  if (!location) {
    return { ok: false, error: "This source location is unavailable or ambiguous." };
  }
  openSourceLocation(location);
  return { ok: true };
});
