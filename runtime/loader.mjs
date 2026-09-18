import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const platforms = {
  "darwin-arm64": "./Tandem.NodeApiSpike.Bridge.mjs",
};

const platform = `${process.platform}-${process.arch}`;
const entry = platforms[platform];
if (!entry) {
  throw new Error(
    `Tandem does not ship a runtime for ${platform}. Supported platforms: ${Object.keys(platforms).join(", ")}.`,
  );
}

const bridgeUrl = new URL(entry, import.meta.url);
const bridgePath = fileURLToPath(bridgeUrl);
if (!existsSync(bridgePath)) {
  throw new Error(
    `Tandem bridge assets are missing at ${bridgePath}. Run \`npm install\` in the tandem-ts package so the prepare script can fetch them, or run \`node scripts/prepare.mjs\` directly.`,
  );
}

let runtime;
try {
  runtime = await import(bridgeUrl.href);
} catch (error) {
  throw new Error(
    `Tandem could not load the ${platform} bridge from ${bridgeUrl.pathname}.`,
    { cause: error },
  );
}

export const runRegisteredGraphAsync = runtime.NodePipelineBridge.runRegisteredGraphAsync;
export const inspectAcceptedAsync = runtime.NodePipelineBridge.inspectAcceptedAsync;