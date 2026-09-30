import { draftingClient, reviewingClient } from "./src/clients.js";
import { createPipeline } from "./src/pipeline.js";

export const tandem = {
  createPipeline: () =>
    createPipeline({ proposer: draftingClient, critic: reviewingClient, judge: reviewingClient }),
};
