import type { ChatClient } from "@maxanstey-meridian/tandem";
import { z } from "zod";

// An empty variable counts as unset, so `VAR= pnpm start` behaves like leaving it out.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const env = z
  .object({
    OPENROUTER_API_KEY: optional(z.string()),
    TANDEM_EXAMPLE_LOCAL_BASE_URL: optional(z.url()),
    TANDEM_EXAMPLE_LOCAL_MODEL: optional(z.string()),
  })
  .parse(process.env);

const openRouterEndpoint = "https://openrouter.ai/api/v1";

export const openRouterKeyMissing = env.OPENROUTER_API_KEY === undefined;

export const draftingClient = {
  kind: "openai-compatible",
  version: 1,
  endpoint: openRouterEndpoint,
  model: "deepseek/deepseek-v4-flash-0731",
  wireApi: "completions",
  apiKeyEnvironmentVariable: "OPENROUTER_API_KEY",
} as const satisfies ChatClient;

export const reviewingClient: ChatClient =
  env.TANDEM_EXAMPLE_LOCAL_BASE_URL === undefined
    ? {
        kind: "openai-compatible",
        version: 1,
        endpoint: openRouterEndpoint,
        model: env.TANDEM_EXAMPLE_LOCAL_MODEL ?? "openai/gpt-5.6-sol",
        wireApi: "completions",
        apiKeyEnvironmentVariable: "OPENROUTER_API_KEY",
      }
    : {
        kind: "openai-compatible",
        version: 1,
        endpoint: env.TANDEM_EXAMPLE_LOCAL_BASE_URL,
        model: env.TANDEM_EXAMPLE_LOCAL_MODEL ?? "gpt-5.6-sol",
        wireApi: "responses",
        verifyModel: true,
      };

// The bridge reports an unreachable endpoint as a full .NET stack trace; check it first so a
// stopped local server produces one actionable line instead.
export const localServerProblem = async (): Promise<string | null> => {
  const baseUrl = env.TANDEM_EXAMPLE_LOCAL_BASE_URL;
  if (baseUrl === undefined) {
    return null;
  }
  try {
    await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, { signal: AbortSignal.timeout(5_000) });
    return null;
  } catch {
    return `Cannot reach TANDEM_EXAMPLE_LOCAL_BASE_URL (${baseUrl}). Start that server, or unset TANDEM_EXAMPLE_LOCAL_BASE_URL to use OpenRouter for the second model.`;
  }
};
