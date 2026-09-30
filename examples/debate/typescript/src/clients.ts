import type { ChatClient } from "@maxanstey-meridian/tandem";
import { z } from "zod";

// A blank variable counts as unset, so `VAR= pnpm start` behaves like leaving it out.
const unsetIfBlank = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(unsetIfBlank, schema.optional());

const env = z
  .object({
    OPENROUTER_API_KEY: optional(z.string().trim()),
    TANDEM_EXAMPLE_LOCAL_MODEL: optional(z.string().trim()),
  })
  .parse(process.env);

// The bridge only lets a client without an API key call a loopback host.
const isLoopback = (url: string) => {
  const hostname = URL.parse(url)?.hostname;
  return hostname === "localhost" || hostname === "[::1]" || /^127(\.\d+){3}$/.test(hostname ?? "");
};

// Parsed apart from the rest so a bad value becomes a one-line message from
// localServerProblem rather than a throw while tandem.config.ts is loading.
const localBaseUrl = optional(z.url({ protocol: /^https?$/ }).refine(isLoopback)).safeParse(
  process.env.TANDEM_EXAMPLE_LOCAL_BASE_URL,
);
const localEndpoint = localBaseUrl.success ? localBaseUrl.data : undefined;

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
  localEndpoint === undefined
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
        endpoint: localEndpoint,
        model: env.TANDEM_EXAMPLE_LOCAL_MODEL ?? "gpt-5.6-sol",
        wireApi: "responses",
        verifyModel: true,
      };

// The bridge reports an unreachable endpoint as a full .NET stack trace; check it first so a
// stopped local server produces one actionable line instead.
export const localServerProblem = async (): Promise<string | null> => {
  if (!localBaseUrl.success) {
    return "TANDEM_EXAMPLE_LOCAL_BASE_URL must be an http(s) URL on this machine, such as http://127.0.0.1:10531/v1.";
  }
  const baseUrl = localBaseUrl.data;
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
