import assert from "node:assert/strict";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { get } from "node:https";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

const TANDEM_VERSION = "0.1.0";
const RUNTIME_DIR = "runtime";

const ASSET_ALLOWLIST = [
  "Tandem.NodeApiSpike.Bridge.mjs",
  "Tandem.NodeApiSpike.Bridge.dll",
  "Tandem.NodeApiSpike.Bridge.runtimeconfig.json",
  "Tandem.dll",
  "Tandem.Ledger.dll",
  "Tandem.Terminal.dll",
  "Spectre.Console.dll",
  "Spectre.Console.Ansi.dll",
  "Microsoft.Agents.AI.dll",
  "Microsoft.Extensions.AI.dll",
  "OpenAI.dll",
];

function download(url, destination) {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        download(new URL(response.headers.location, url).href, destination).then(resolve, reject);
        response.resume();
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`GET ${url} failed with status ${response.statusCode}.`));
        response.resume();
        return;
      }
      pipeline(response, createWriteStream(destination)).then(resolve, reject);
    }).on("error", reject);
  });
}

async function bridgeIsComplete() {
  for (const asset of ASSET_ALLOWLIST) {
    if (!existsSync(join(RUNTIME_DIR, asset))) {
      return false;
    }
  }
  return true;
}

async function main() {
  await mkdir(RUNTIME_DIR, { recursive: true });
  if (await bridgeIsComplete()) {
    console.log(`Tandem bridge ${TANDEM_VERSION} already present.`);
    return;
  }
  const version = TANDEM_VERSION;
  const url = `https://github.com/maxanstey-meridian/tandem/releases/download/${version}/tandem-bridge-${version}-darwin-arm64.tar.gz`;
  const tarball = join("node_modules", `.tandem-bridge-${version}.tar.gz`);
  await mkdir("node_modules", { recursive: true });
  console.log(`Fetching Tandem bridge ${version} from ${url}`);
  await download(url, tarball);
  execFileSync("tar", ["-xzf", tarball, "-C", RUNTIME_DIR], { stdio: "inherit" });
  await rm(tarball, { force: true });
  const staged = await readdir(RUNTIME_DIR);
  assert.ok(staged.includes("Tandem.NodeApiSpike.Bridge.mjs"), "bridge archive did not contain the Node bridge entrypoint");
  console.log(`Tandem bridge ${version} staged (${staged.length} assets).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});