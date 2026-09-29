import { configWorkspace, watchProjectTypescript } from "../../src/watch";
import { currentConfig } from "../utils/pipeline";

export default defineEventHandler(async (event) => {
  const generation = watchProjectTypescript(configWorkspace(await currentConfig()));
  const stream = createEventStream(event);
  const unsubscribe = generation.subscribe(
    (value) => void stream.push({ event: "change", data: String(value) }),
  );
  stream.onClosed(async () => {
    unsubscribe();
    await stream.close();
  });
  return stream.send();
});
