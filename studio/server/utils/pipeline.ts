import { discoverConfig } from "../../src/discovery";
import { studioEnv } from "../../src/env";
import { loadPipeline } from "../../src/loader";

export async function loadCurrentPipeline() {
  const config = await discoverConfig(studioEnv.cwd, studioEnv.config);
  return { config, loaded: await loadPipeline(config) };
}
