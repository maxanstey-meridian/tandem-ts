import { studioEnv } from "../../src/env";
import { configWorkspace, watchProjectTypescript } from "../../src/watch";

export default defineEventHandler(() => {
  const generation = watchProjectTypescript(
    studioEnv.config ? configWorkspace(studioEnv.config) : studioEnv.cwd,
  );
  return { generation: generation() };
});
