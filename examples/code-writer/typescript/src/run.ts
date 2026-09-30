import { inspectAccepted } from "@maxanstey-meridian/tandem";
import { runCli } from "@maxanstey-meridian/tandem/cli";
import { resolve } from "node:path";
import { draftingClient, localServerProblem, openRouterKeyMissing, reviewingClient } from "./clients.js";
import { createPipeline } from "./pipeline.js";
import type { State } from "./state.js";

const initialState: State = {
  requirements: [
    "Implement synchronous pure JavaScript slugify(input).",
    "Trim whitespace and lowercase the input.",
    "Remove Unicode diacritics.",
    "Replace runs of non-alphanumeric characters with one hyphen.",
    "Trim edge hyphens and never return repeated hyphens.",
    "Return an empty string when no alphanumeric characters remain.",
  ],
  implementation: null,
  verification: null,
  review: null,
};

const problem = openRouterKeyMissing
  ? "OPENROUTER_API_KEY is required to run the Code Writer example. See examples/README.md."
  : await localServerProblem();
if (problem !== null) {
  process.stderr.write(`${problem}\n`);
  process.exitCode = 2;
} else {
  const ledgerPath = resolve(process.env.TANDEM_LEDGER_PATH ?? "code-writer.sqlite3");
  await runCli(
    createPipeline({ implementer: draftingClient, reviewer: reviewingClient }),
    initialState,
    {
      ledgerPath,
      signal: AbortSignal.timeout(600_000),
      formatResult: async (result) => {
        const accepted = await inspectAccepted({ ledgerPath, runId: result.runId });
        return [
          `Implementation:\n${result.state.implementation?.source ?? ""}`,
          `Ledger: ${ledgerPath}`,
          `Run: ${result.runId}`,
          `Accepted: ${accepted.length}`,
        ].join("\n");
      },
    },
  );
}
