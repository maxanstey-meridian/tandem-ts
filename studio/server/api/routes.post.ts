import { applyRouteEdit, RouteEditRequestSchema } from "../../src/edit";
import { loadCurrentPipeline } from "../utils/pipeline";

export default defineEventHandler(async (event) => {
  const request = await readValidatedBody(event, RouteEditRequestSchema.parse);
  const { config, loaded } = await loadCurrentPipeline();
  if (!loaded.ok) {
    return loaded;
  }
  return applyRouteEdit(config, loaded.graph, request.edit, request.editRevision);
});
