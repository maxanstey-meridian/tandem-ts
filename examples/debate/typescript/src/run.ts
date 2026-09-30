import { runCli } from "@maxanstey-meridian/tandem/cli";
import { draftingClient, localServerProblem, openRouterKeyMissing, reviewingClient } from "./clients.js";
import { createPipeline } from "./pipeline.js";
import type { State } from "./state.js";

const args = process.argv.slice(2);
const question =
  (args[0] === "--" ? args.slice(1) : args).join(" ") ||
  "Should cities replace most downtown parking with public space?";

const initialState: State = {
  question,
  arguments: [],
  round: 0,
  verdict: null,
  critiqueAccepted: null,
};

const problem = openRouterKeyMissing
  ? "OPENROUTER_API_KEY is required to run the Debate example. See examples/README.md."
  : await localServerProblem();
if (problem !== null) {
  process.stderr.write(`${problem}\n`);
  process.exitCode = 2;
} else {
  await runCli(
    createPipeline({ proposer: draftingClient, critic: reviewingClient, judge: reviewingClient }),
    initialState,
    {
      signal: AbortSignal.timeout(600_000),
      formatResult: (result) => `Verdict: ${JSON.stringify(result.state.verdict)}`,
    },
  );
}
