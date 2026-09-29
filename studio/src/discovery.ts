import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { ts } from "ts-morph";

export async function discoverConfig(start: string, explicit?: string): Promise<string> {
  if (explicit) {
    const candidate = resolve(start, explicit);
    try {
      await access(candidate);
    } catch {
      throw new Error(`Tandem config '${candidate}' does not exist.`);
    }
    return candidate;
  }
  const found = ts.findConfigFile(resolve(start), ts.sys.fileExists, "tandem.config.ts");
  if (!found) {
    throw new Error(`No tandem.config.ts found from '${start}'.`);
  }
  return resolve(found);
}
