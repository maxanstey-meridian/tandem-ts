declare const runRegisteredGraphAsync: (
  definition: string,
  syncCallback: (id: string, state: string, input: string) => string,
  asyncCallback: (id: string, state: string, input: string, signal: AbortSignal) => Promise<string>,
  signal?: AbortSignal,
) => Promise<string>;

declare const inspectAcceptedAsync: (ledgerPath: string, runId: string) => Promise<string>;

export { inspectAcceptedAsync, runRegisteredGraphAsync };
export declare const runCollectionAgentAsync: (
  scopeId: string,
  agentId: string,
  state: string,
) => Promise<string>;
