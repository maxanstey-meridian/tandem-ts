import { runCli } from "@maxanstey-meridian/tandem/cli";
import { draftingClient, localServerProblem, openRouterKeyMissing, reviewingClient } from "./clients.js";
import { createPipeline } from "./pipeline.js";
import type { State } from "./state.js";

const args = process.argv.slice(2);
const initialState: State = {
  brief:
    (args[0] === "--" ? args.slice(1) : args).join(" ") ||
    "Write a hopeful song about finding your way home.",
  lyrics: null,
  lintFeedback: null,
  proofreaderFeedback: null,
  revision: 0,
  proofreaderAccepted: null,
};

const problem = openRouterKeyMissing
  ? "OPENROUTER_API_KEY is required to run the Songwriter example. See examples/README.md."
  : await localServerProblem();
if (problem !== null) {
  process.stderr.write(`${problem}\n`);
  process.exitCode = 2;
} else {
  await runCli(
    createPipeline({ songwriter: draftingClient, proofreader: reviewingClient }),
    initialState,
    {
      signal: AbortSignal.timeout(600_000),
      formatResult: (result) => `Lyrics:\n${result.state.lyrics ?? ""}`,
    },
  );
}
