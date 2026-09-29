import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

type SyncCallback = (state: string, input: string) => string;
type AsyncCallback = (state: string, input: string, signal: AbortSignal) => Promise<string>;
type Callback = (state: string, input: string, signal: AbortSignal) => string | Promise<string>;
const participantBrand: unique symbol = Symbol("participant");
const compileCapabilityBrand: unique symbol = Symbol("compileCapability");
const interactionHandlersBrand: unique symbol = Symbol("interactionHandlers");
const workspaceBrand: unique symbol = Symbol("workspace");
const toolGroupBrand: unique symbol = Symbol("toolGroup");
const commandSelectionBrand: unique symbol = Symbol("commandSelection");

export class TandemError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TandemError";
  }
}
export class TandemRuntimeError extends TandemError {
  constructor(
    readonly operation: "run" | "inspect",
    cause: unknown,
  ) {
    super(`Tandem ${operation} failed: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
    this.name = "TandemRuntimeError";
  }
}
export class TandemCancellationError extends TandemRuntimeError {
  constructor(cause: unknown) {
    super("run", cause);
    this.name = "AbortError";
  }
}
export class ContractValidationError extends TandemError {
  readonly problems: readonly ValidationProblem[];
  constructor(
    readonly boundary: string,
    problems: readonly ValidationProblem[],
  ) {
    super(
      `${boundary} validation failed: ${problems.map((p) => `${p.path}: ${p.message}`).join("; ")}`,
    );
    this.name = "ContractValidationError";
    this.problems = problems;
  }
}

export type ValidationProblem = {
  readonly path: string;
  readonly message: string;
};

type CallbackResult =
  | { readonly succeeded: true; readonly value: string }
  | {
      readonly succeeded: false;
      readonly error: {
        readonly name: string;
        readonly message: string;
        readonly boundary?: string;
        readonly problems?: readonly ValidationProblem[];
      };
    };

const callbackSucceeded = (value: string): string =>
  JSON.stringify({ succeeded: true, value } satisfies CallbackResult);
const callbackFailed = (error: unknown): string =>
  JSON.stringify({
    succeeded: false,
    error:
      error instanceof ContractValidationError
        ? {
            name: error.name,
            message: error.message,
            boundary: error.boundary,
            problems: error.problems,
          }
        : {
            name: error instanceof Error ? error.name : "Error",
            message: error instanceof Error ? error.message : String(error),
          },
  } satisfies CallbackResult);

/** Synchronous callbacks cannot observe cancellation; they receive a signal that never aborts. */
const neverAborted = new AbortController().signal;

class CallbackRegistry {
  readonly #callbacks = new Map<string, Callback>();
  #next = 0;
  #disposed = false;

  registerSync(callback: SyncCallback): string {
    return this.#register(callback);
  }

  registerAsync(callback: AsyncCallback): string {
    return this.#register(callback);
  }

  /** Never throws: failures travel back to the bridge as an encoded `CallbackResult`. */
  invoke(id: string, state: string, input: string, signal: AbortSignal): string | Promise<string> {
    try {
      const callback = this.#callbacks.get(id);
      if (!callback) {
        throw new Error(`Unknown internal callback '${id}'.`);
      }
      const value = callback(state, input, signal);
      return typeof value === "string"
        ? callbackSucceeded(value)
        : value.then(callbackSucceeded, callbackFailed);
    } catch (error) {
      return callbackFailed(error);
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#callbacks.clear();
  }

  #register(callback: Callback): string {
    if (this.#disposed) {
      throw new Error("Callback registry has been disposed.");
    }
    const id = `c${this.#next++}`;
    this.#callbacks.set(id, callback);
    return id;
  }
}

// The bridge surfaces JS callback errors and .NET cancellations only as exception message text,
// so these markers are how a failure's origin is recovered (until the bridge returns structured
// errors).
const CALLBACK_CONTRACT_MARKER = "TANDEM_CALLBACK_CONTRACT:";
const CALLBACK_FAILURE_MARKER = "JavaScript callback failed:";
const BRIDGE_CANCELLATION_MESSAGE = /\boperation was (?:cancell?ed|aborted)\b/i;

const callbackFailureSchema = z.object({
  boundary: z.string(),
  problems: z.array(z.object({ path: z.string(), message: z.string() })),
});
function callbackContractFailure(error: unknown): z.infer<typeof callbackFailureSchema> | null {
  const message = error instanceof Error ? error.message : String(error);
  const start = message.indexOf(CALLBACK_CONTRACT_MARKER);
  if (start < 0) {
    return null;
  }
  try {
    const failure = callbackFailureSchema.safeParse(
      JSON.parse(message.slice(start + CALLBACK_CONTRACT_MARKER.length)),
    );
    return failure.success ? failure.data : null;
  } catch {
    return null;
  }
}

function isCancellation(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) {
    return true;
  }
  return (
    error instanceof Error &&
    !error.message.includes(CALLBACK_FAILURE_MARKER) &&
    (error.name === "AbortError" || BRIDGE_CANCELLATION_MESSAGE.test(error.message))
  );
}

function path(parts: PropertyKey[]): string {
  return parts.length === 0
    ? "$"
    : `$${parts.map((part) => (typeof part === "number" ? `[${part}]` : `.${String(part)}`)).join("")}`;
}
function parseValidated<T>(schema: z.ZodType<T>, value: unknown, boundary: string): T {
  let result: z.ZodSafeParseResult<T>;
  try {
    result = schema.safeParse(value);
  } catch (error) {
    if (error instanceof Error && /async/i.test(error.message)) {
      throw new ContractValidationError(boundary, [
        {
          path: "$",
          message:
            "Async Zod refinements are unsupported; Tandem contracts must validate synchronously.",
        },
      ]);
    }
    throw error;
  }
  if (!result.success) {
    throw new ContractValidationError(
      boundary,
      result.error.issues.map((issue) => ({ path: path(issue.path), message: issue.message })),
    );
  }
  return result.data;
}
function parse<T>(schema: z.ZodType<T>, value: unknown, boundary: string): T {
  const result = parseValidated(schema, value, boundary);
  if (!isDeepStrictEqual(result, value)) {
    throw new ContractValidationError(boundary, [
      {
        path: "$",
        message:
          "Zod contract changed the boundary value. Coercion, defaults, transforms, and stripping are unsupported.",
      },
    ]);
  }
  return result;
}
/**
 * The walker is the whole losslessness check: a stringify/parse round-trip compares only enumerable
 * data, so it misses accessors and non-enumerable properties, and it cannot name the failing path.
 */
function serializeBoundary<T>(schema: z.ZodType<T>, value: unknown, boundary: string): string {
  const parsed = parse(schema, value, boundary);
  const problem = jsonValueProblem(parsed, "$", new WeakSet<object>());
  if (problem) {
    throw new ContractValidationError(boundary, [problem]);
  }
  return JSON.stringify(parsed);
}

function jsonValueProblem(
  value: unknown,
  valuePath: string,
  seen: WeakSet<object>,
): ValidationProblem | null {
  if (value === undefined) {
    return { path: valuePath, message: "undefined is not JSON-serializable." };
  }
  if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) {
    return { path: valuePath, message: "Non-finite numbers and -0 are not JSON-serializable." };
  }
  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
    return { path: valuePath, message: `${typeof value} values are not JSON-serializable.` };
  }
  if (value === null || typeof value !== "object") {
    return null;
  }
  if (seen.has(value)) {
    return { path: valuePath, message: "Cyclic values are not JSON-serializable." };
  }
  seen.add(value);
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return { path: valuePath, message: "Symbol properties are not JSON-serializable." };
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (!descriptor) {
        return {
          path: `${valuePath}[${index}]`,
          message: "Sparse arrays are not JSON-serializable.",
        };
      }
      if (!("value" in descriptor)) {
        return {
          path: `${valuePath}[${index}]`,
          message: "Accessor properties are not supported at JSON boundaries.",
        };
      }
      const problem = jsonValueProblem(descriptor.value, `${valuePath}[${index}]`, seen);
      if (problem) {
        return problem;
      }
    }
    const additionalProperty = Object.getOwnPropertyNames(value).find((name) => {
      if (name === "length") {
        return false;
      }
      const index = Number(name);
      return (
        !Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== name
      );
    });
    if (additionalProperty) {
      return {
        path: `${valuePath}.${additionalProperty}`,
        message: "Additional array properties are not JSON-serializable.",
      };
    }
    seen.delete(value);
    return null;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return {
      path: valuePath,
      message: "Only plain objects are JSON-serializable boundary values.",
    };
  }
  for (const name of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor?.enumerable) {
      return {
        path: `${valuePath}.${name}`,
        message: "Non-enumerable properties are not JSON-serializable.",
      };
    }
    if (!("value" in descriptor)) {
      return {
        path: `${valuePath}.${name}`,
        message: "Accessor properties are not supported at JSON boundaries.",
      };
    }
    const problem = jsonValueProblem(descriptor.value, `${valuePath}.${name}`, seen);
    if (problem) {
      return problem;
    }
  }
  seen.delete(value);
  return null;
}
function parseJson<T>(schema: z.ZodType<T>, json: string, boundary: string): T {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new ContractValidationError(boundary, [{ path: "$", message: "Invalid JSON" }]);
  }
  return parse(schema, value, boundary);
}
function inputJsonSchema<T>(schema: z.ZodType<T>, boundary: string): string {
  try {
    z.toJSONSchema(schema, { io: "output" });
    return JSON.stringify(z.toJSONSchema(schema, { io: "input" }));
  } catch (error) {
    throw new ContractValidationError(boundary, [
      { path: "$", message: error instanceof Error ? error.message : String(error) },
    ]);
  }
}

const positiveInt32 = z.int32({ error: "must be a positive 32-bit integer" }).min(1);
const nonBlankString = z
  .string({ error: "must be a non-blank string" })
  .refine((value) => value.trim().length > 0, { error: "must be a non-blank string" });
const hasUnique = <T>(items: readonly T[], key: (item: T) => unknown): boolean =>
  new Set(items.map(key)).size === items.length;

interface Participant<TState> {
  readonly id: string;
  readonly [participantBrand]: (state: TState) => TState;
}
export interface Stage<TState> extends Participant<TState> {
  readonly kind: "stage";
}
export interface Interaction<TState, TRequest, TResponse> extends Participant<TState> {
  readonly kind: "interaction";
  readonly requestType?: TRequest;
  readonly responseType?: TResponse;
}
export interface Agent<TState> extends Participant<TState> {
  readonly kind: "agent";
}
export interface Parallel<TState> extends Participant<TState> {
  readonly kind: "parallel";
}
export interface Terminal<TState> extends Participant<TState> {
  readonly kind: "terminal";
}
type Node<TState> =
  | Collection<TState>
  | Stage<TState>
  | Interaction<TState, unknown, unknown>
  | Agent<TState>
  | Parallel<TState>
  | Terminal<TState>;

type StageDefinition<TState> = {
  id: string;
  execute: (state: TState, context: { readonly signal: AbortSignal }) => TState | Promise<TState>;
  persist?: boolean;
};
type StageRecord<TState> = Stage<TState> & StageDefinition<TState>;
/** The participant brand only pins `TState` for the type checker; `kind` identifies records at runtime. */
const keepState = <TState>(state: TState): TState => state;
export function stage<TState>(definition: StageDefinition<TState>): Stage<TState> {
  const record: StageRecord<TState> = {
    ...definition,
    [participantBrand]: keepState,
    kind: "stage",
  };
  return Object.freeze(record);
}

const taskAgentBrand: unique symbol = Symbol("taskAgent");
export interface TaskAgentReference {
  readonly id: string;
  readonly [taskAgentBrand]: true;
}
export interface TaskAgent<TInput, TOutput> extends TaskAgentReference {
  readonly input: z.ZodType<TInput>;
  readonly result: z.ZodType<TOutput>;
}
export interface CollectionContext {
  readonly signal: AbortSignal;
  run<TInput, TOutput>(agent: TaskAgent<TInput, TOutput>, input: NoInfer<TInput>): Promise<TOutput>;
}
export interface Collection<TState> extends Participant<TState> {
  readonly kind: "collection";
}
type TaskState<TInput, TOutput> = { input: TInput; output: { value: TOutput } | null };
type TaskAgentRecord<TInput, TOutput> = TaskAgent<TInput, TOutput> & {
  readonly state: z.ZodType<TaskState<TInput, TOutput>>;
  readonly participant: Agent<TaskState<TInput, TOutput>>;
};
export interface TaskAgentDefinition<TInput, TOutput> extends Omit<
  AgentDefinition<TInput, TOutput>,
  "output" | "capabilities" | "workspace" | "checkpoint"
> {
  input: z.ZodType<TInput>;
  result: z.ZodType<TOutput>;
  output:
    | Omit<
        Extract<NonNullable<AgentDefinition<TInput, TOutput>["output"]>, { schema: unknown }>,
        "apply"
      >
    | Omit<
        Extract<NonNullable<AgentDefinition<TInput, TOutput>["output"]>, { raw: true }>,
        "apply"
      >;
}
export function taskAgent<TInput, TOutput>(
  definition: TaskAgentDefinition<TInput, TOutput>,
): TaskAgent<TInput, TOutput> {
  const { validateFor } = definition.output;
  const record: TaskAgentRecord<TInput, TOutput> = {
    [taskAgentBrand]: true,
    id: definition.id,
    input: definition.input,
    result: definition.result,
    state: z.object({
      input: definition.input,
      output: z.object({ value: definition.result }).nullable(),
    }),
    participant: agent<TaskState<TInput, TOutput>, TOutput>({
      ...definition,
      message: (state) => definition.message(state.input),
      output: {
        ...definition.output,
        validateFor: validateFor ? (state, value) => validateFor(state.input, value) : undefined,
        apply: (state, value) => ({ ...state, output: { value } }),
      },
    }),
  };
  return Object.freeze(record);
}
/** Task agents are only created by `taskAgent()`, whose record is the returned object. */
function taskAgentRecord<TInput, TOutput>(
  reference: TaskAgentReference | TaskAgent<TInput, TOutput>,
): TaskAgentRecord<TInput, TOutput> {
  if (!("participant" in reference)) {
    throw new TandemError("Use taskAgent to declare collection agents.");
  }
  return reference as TaskAgentRecord<TInput, TOutput>;
}
interface CollectionDefinition<TState, TItem, TResult> {
  id: string;
  item: z.ZodType<TItem>;
  result: z.ZodType<TResult>;
  items: (state: TState) => readonly TItem[];
  agents: readonly TaskAgentReference[];
  execute: (item: TItem, context: CollectionContext) => Promise<TResult> | TResult;
  apply: (state: TState, results: readonly TResult[]) => TState;
  max: number;
  persist?: boolean;
}
type CollectionRecord<TState, TItem, TResult> = Collection<TState> &
  CollectionDefinition<TState, TItem, TResult>;
const collectionOptionsSchema = z.object({
  max: positiveInt32,
  agents: z
    .array(z.object({ id: z.string() }))
    .refine((agents) => hasUnique(agents, (agent) => agent.id), { error: "must have unique IDs" }),
});
export function collection<TState, TItem, TResult>(
  definition: CollectionDefinition<TState, TItem, TResult>,
): Collection<TState> {
  parseDefinition(collectionOptionsSchema, definition, `Collection '${definition.id}'`);
  const record: CollectionRecord<TState, TItem, TResult> = {
    ...definition,
    [participantBrand]: keepState,
    kind: "collection",
  };
  return Object.freeze(record);
}

type InteractionRecord<TState, TRequest, TResponse> = Interaction<TState, TRequest, TResponse> & {
  readonly requestSchema: z.ZodType<TRequest>;
  readonly responseSchema: z.ZodType<TResponse>;
  readonly request: (state: TState) => TRequest;
  readonly apply: (state: TState, response: TResponse) => TState;
  readonly persist?: boolean;
};
export function interaction<TState, TRequest, TResponse>(definition: {
  id: string;
  requestSchema: z.ZodType<TRequest>;
  responseSchema: z.ZodType<TResponse>;
  request: (state: TState) => TRequest;
  apply: (state: TState, response: TResponse) => TState;
  persist?: boolean;
}): Interaction<TState, TRequest, TResponse> {
  const record: InteractionRecord<TState, TRequest, TResponse> = {
    ...definition,
    [participantBrand]: keepState,
    kind: "interaction",
  };
  return Object.freeze(record);
}

type InteractionHandler<TRequest, TResponse> = (
  request: TRequest,
  context: { readonly signal: AbortSignal },
) => TResponse | Promise<TResponse>;
type RegisteredInteractionHandler = {
  readonly interaction: InteractionRecord<unknown, unknown, unknown>;
  readonly handle: InteractionHandler<unknown, unknown>;
};
export interface InteractionHandlers {
  handle<TState, TRequest, TResponse>(
    interaction: Interaction<TState, TRequest, TResponse>,
    handler: InteractionHandler<TRequest, TResponse>,
  ): InteractionHandlers;
  readonly [interactionHandlersBrand]: true;
}
const registeredHandlers = new WeakMap<InteractionHandlers, RegisteredInteractionHandler[]>();
export function interactions(): InteractionHandlers {
  const entries: RegisteredInteractionHandler[] = [];
  const handlers: InteractionHandlers = {
    [interactionHandlersBrand]: true,
    handle(interaction, handler) {
      if (entries.some((entry) => entry.interaction === interaction)) {
        throw new TandemError(`Interaction '${interaction.id}' already has a handler.`);
      }
      entries.push({
        // An interaction is the record `interaction()` built; its types are erased for storage.
        interaction: interaction as InteractionRecord<unknown, unknown, unknown>,
        handle: handler as InteractionHandler<unknown, unknown>,
      });
      return handlers;
    },
  };
  registeredHandlers.set(handlers, entries);
  return Object.freeze(handlers);
}

interface CapabilityCompileContext<TState> {
  readonly id: string;
  readonly stateSchema: z.ZodType<TState>;
  readonly callbacks: CallbackRegistry;
}
export interface Capability<TState> {
  readonly name: string;
  readonly [compileCapabilityBrand]: (context: CapabilityCompileContext<TState>) => object;
}
/** Capabilities are only created by `capability()`, which also records the request JSON schema. */
type CapabilityRecord<TState> = Capability<TState> & { readonly requestJsonSchema: string };
export function capability<TState, TRequest>(definition: {
  readonly name: string;
  readonly instructions: string;
  readonly schema: z.ZodType<TRequest>;
  readonly validateFor?: (state: TState, request: TRequest) => readonly ValidationProblem[];
  readonly apply: (state: TState, request: TRequest) => TState;
  readonly summarize: (request: TRequest) => string;
}): Capability<TState> {
  const { name, instructions, schema, validateFor, apply, summarize } = definition;
  requireInstructions(instructions, `Capability '${name}' instructions`);
  const requestJsonSchema = inputJsonSchema(schema, `capability '${name}' schema`);
  const compile = ({ id, stateSchema, callbacks }: CapabilityCompileContext<TState>): object => {
    const parseState = (state: string) => parseJson(stateSchema, state, `${id} state`);
    const parseRequest = (input: string) =>
      parseJson(schema, input, `${id} capability '${name}' request`);
    return {
      name,
      instructions,
      jsonSchema: requestJsonSchema,
      validateCallback: callbacks.registerSync((_, input) => issues(schema, input)),
      validateForCallback: validateFor
        ? callbacks.registerSync((state, input) =>
            validationProblems(
              validateFor(parseState(state), parseRequest(input)),
              `${id} capability '${name}' contextual validation`,
            ),
          )
        : undefined,
      applyCallback: callbacks.registerSync((state, input) =>
        serializeBoundary(
          stateSchema,
          apply(parseState(state), parseRequest(input)),
          `${id} applied state`,
        ),
      ),
      summaryCallback: callbacks.registerSync((_, input) => summarize(parseRequest(input))),
      valueType: `${id}.capability.${name}`,
    };
  };
  const record: CapabilityRecord<TState> = {
    name,
    requestJsonSchema,
    [compileCapabilityBrand]: compile,
  };
  return Object.freeze(record);
}

export interface OpenAiCompatibleChatClient {
  readonly kind: "openai-compatible";
  readonly version: 1;
  readonly endpoint: string;
  readonly model: string;
  readonly wireApi: "completions" | "responses";
  readonly apiKeyEnvironmentVariable?: string;
  readonly verifyModel?: boolean;
  /** Per-attempt transport limits; omitted preserves provider defaults. */
  readonly requestTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly maxAttempts?: number;
}
export type ChatClient = OpenAiCompatibleChatClient;
export type AgentReasoning =
  | {
      readonly effort: "none" | "low" | "medium" | "high";
      readonly maxTokens?: never;
    }
  | { readonly maxTokens: number; readonly effort?: never };
export interface AgentSkill {
  readonly directory: string;
}

export type AgentToolName =
  | "read_file"
  | "ls"
  | "grep"
  | "write_file"
  | "delete_file"
  | "replace"
  | "replace_lines"
  | "git:ro"
  | "shell"
  | "web_search"
  | "web_fetch";
export interface AgentCommand {
  readonly name: string;
  readonly description: string;
  readonly command: string;
  readonly arguments?: readonly string[];
}
interface AgentCommandSelection {
  readonly [commandSelectionBrand]: object;
}
type AgentToolSelection = AgentToolName | AgentCommandSelection;
export interface AgentToolGroup<TState> {
  readonly [toolGroupBrand]: (state: TState) => boolean;
}
export type AgentToolEffect =
  | "read"
  | "workspaceMutation"
  | "processExecution"
  | "lifecycleTransition"
  | "unclassified";
export interface AgentToolInvocation {
  readonly name: string;
  readonly effect: AgentToolEffect;
  readonly arguments: unknown;
}
export type AgentToolInterceptor<TState> = (
  state: TState,
  invocation: AgentToolInvocation,
  context: { readonly signal: AbortSignal },
) => string | null | Promise<string | null>;
type ToolGroupRecord<TState> = AgentToolGroup<TState> & {
  readonly predicate: ((state: TState) => boolean) | undefined;
  readonly tools: readonly AgentToolSelection[];
};
function createToolGroup<TState>(
  predicate: ((state: TState) => boolean) | undefined,
  tools: readonly AgentToolSelection[],
): AgentToolGroup<TState> {
  if (tools.length === 0) {
    throw new TandemError("An agent tool group cannot be empty.");
  }
  const seen = new Set<AgentToolSelection>();
  for (const tool of tools) {
    if (typeof tool !== "string" && !(commandSelectionBrand in tool)) {
      throw new TandemError("Agent tools must be built-in names or workspace.commands.");
    }
    if (seen.has(tool)) {
      throw new TandemError("An agent tool group cannot select a tool twice.");
    }
    seen.add(tool);
  }
  const record: ToolGroupRecord<TState> = {
    [toolGroupBrand]: predicate ?? (() => true),
    predicate,
    tools,
  };
  return Object.freeze(record);
}
export const agentTools = {
  always: (...tools: readonly AgentToolSelection[]): AgentToolGroup<never> =>
    createToolGroup(undefined, tools),
  when: <TState>(
    predicate: (state: TState) => boolean,
    ...tools: readonly AgentToolSelection[]
  ): AgentToolGroup<TState> => createToolGroup(predicate, tools),
};
export interface AgentWorkspaceConfiguration<TState> {
  readonly [workspaceBrand]: (state: TState) => TState;
}
export interface AgentWorkspace<TState> {
  readonly commands: AgentCommandSelection;
  withTools(
    groups: readonly (AgentToolGroup<TState> | AgentToolGroup<never>)[],
    options?: { readonly interceptTool?: AgentToolInterceptor<TState> },
  ): AgentWorkspaceConfiguration<TState>;
}
type WorkspaceSource<TState> = {
  readonly path: (state: TState) => string;
  readonly commandSource:
    | readonly AgentCommand[]
    | ((state: TState) => readonly AgentCommand[])
    | undefined;
};
type WorkspaceConfigurationRecord<TState> = AgentWorkspaceConfiguration<TState> & {
  readonly workspace: WorkspaceSource<TState>;
  readonly groups: readonly ToolGroupRecord<TState>[];
  readonly interceptTool: AgentToolInterceptor<TState> | undefined;
};
export function agentWorkspace<TState>(definition: {
  readonly path: (state: TState) => string;
  readonly commands?: readonly AgentCommand[] | ((state: TState) => readonly AgentCommand[]);
}): AgentWorkspace<TState> {
  if (typeof definition.path !== "function") {
    throw new TandemError("Workspace path is required.");
  }
  const workspace: WorkspaceSource<TState> = Object.freeze({
    path: definition.path,
    // Parsing copies a static catalogue, so later mutation by the caller cannot change it.
    commandSource:
      typeof definition.commands === "function" || definition.commands === undefined
        ? definition.commands
        : parseDefinition(agentCommandsSchema, definition.commands, "Workspace commands"),
  });
  return Object.freeze({
    commands: Object.freeze({ [commandSelectionBrand]: workspace }),
    withTools(
      groups: readonly (AgentToolGroup<TState> | AgentToolGroup<never>)[],
      options?: { readonly interceptTool?: AgentToolInterceptor<TState> },
    ): AgentWorkspaceConfiguration<TState> {
      if (groups.length === 0) {
        throw new TandemError("An agent workspace requires tool groups.");
      }
      const records = groups.map((group) => {
        if (!("tools" in group)) {
          throw new TandemError("Agent tool groups must be created by agentTools.");
        }
        // A tool group record is the object `agentTools` returned.
        return group as ToolGroupRecord<TState>;
      });
      if (options?.interceptTool !== undefined && typeof options.interceptTool !== "function") {
        throw new TandemError("Workspace tool interceptor must be a function.");
      }
      const configuration: WorkspaceConfigurationRecord<TState> = {
        [workspaceBrand]: keepState,
        workspace,
        groups: records,
        interceptTool: options?.interceptTool,
      };
      return Object.freeze(configuration);
    },
  });
}

const agentCommandsSchema = z.array(
  z.strictObject({
    name: z
      .string({ error: "must be a valid tool name" })
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, { error: "must be a valid tool name" }),
    description: nonBlankString,
    command: nonBlankString,
    arguments: z
      .array(
        z
          .string({ error: "must be a string" })
          .refine((value) => value.trim().length > 0, { error: "must not be blank" })
          .max(200, { error: "must be at most 200 characters" }),
        { error: "must be an array of strings" },
      )
      .max(16, { error: "accepts at most 16 arguments" })
      .optional(),
  }),
  { error: "must be an array" },
);
const skillSchema = z.object({ directory: nonBlankString });
export function skill(definition: { readonly directory: string }): AgentSkill {
  return parseDefinition(skillSchema, definition, "Skill");
}
export interface AgentDefinition<TState, TOutput = never> {
  readonly id: string;
  readonly instructions: string;
  readonly client: ChatClient;
  readonly message: (state: TState) => string;
  readonly output?:
    | {
        readonly instructions: string;
        readonly schema: z.ZodType<TOutput>;
        readonly validateFor?: (state: TState, output: TOutput) => readonly ValidationProblem[];
        readonly apply: (state: TState, output: TOutput) => TState;
      }
    | {
        readonly instructions: string;
        readonly raw: true;
        readonly parse: (response: string) => TOutput;
        readonly validateFor?: (state: TState, output: TOutput) => readonly ValidationProblem[];
        readonly apply: (state: TState, output: TOutput) => TState;
      };
  readonly capabilities?: readonly Capability<TState>[];
  readonly skills?: readonly AgentSkill[];
  readonly workspace?: AgentWorkspaceConfiguration<TState>;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly reasoning?: AgentReasoning;
  readonly continueSession?: boolean;
  readonly checkpoint?: {
    readonly contextWindowTokens: number;
    readonly maxOutputTokens: number;
    readonly checkpointAtPercent: number;
    readonly capability: Capability<TState>;
    readonly instructions: string;
    readonly message: (state: TState, currentContextTokens: number) => string;
    readonly session?: "retain" | "reset";
    readonly disableCompaction?: boolean;
  };
  readonly timeoutMs?: number;
  readonly persist?: boolean;
}
type AgentRecord<TState, TOutput> = Agent<TState> & AgentDefinition<TState, TOutput>;
const capabilityReference = z.custom<{ readonly name: string }>();
const agentOutputSchema = z.discriminatedUnion(
  "raw",
  [
    z.object({
      raw: z.literal(true),
      schema: z.undefined({ error: "is forbidden for raw output" }).optional(),
      parse: z.custom((value) => typeof value === "function", {
        error: "must be a function for raw output",
      }),
    }),
    z.object({
      raw: z.undefined().optional(),
      parse: z.undefined({ error: "requires raw output mode" }).optional(),
    }),
  ],
  { error: "must be true" },
);
const agentOptionsSchema = z
  .object({
    output: agentOutputSchema.optional(),
    reasoning: z
      .object({
        effort: z
          .enum(["none", "low", "medium", "high"], {
            error: "must be 'none', 'low', 'medium' or 'high'",
          })
          .optional(),
        maxTokens: z
          .int32({ error: "must be a 32-bit integer of at least 1024" })
          .min(1024)
          .optional(),
      })
      .refine((value) => (value.effort === undefined) !== (value.maxTokens === undefined), {
        error: "must specify exactly one of effort or maxTokens",
      })
      .optional(),
    capabilities: z
      .array(capabilityReference)
      .refine((items) => hasUnique(items, (item) => item.name), {
        error: "must not contain a duplicate capability",
      })
      .optional(),
    skills: z
      .array(skillSchema)
      .refine((items) => hasUnique(items, (item) => item.directory), {
        error: "must not repeat a skill directory",
      })
      .optional(),
    temperature: z.number({ error: "must be between 0 and 2" }).min(0).max(2).optional(),
    maxOutputTokens: positiveInt32.optional(),
    checkpoint: z
      .object({
        contextWindowTokens: positiveInt32,
        maxOutputTokens: positiveInt32,
        checkpointAtPercent: z.int({ error: "must be between 1 and 99" }).min(1).max(99),
        capability: capabilityReference,
        session: z.enum(["retain", "reset"], { error: "must be 'retain' or 'reset'" }).optional(),
        disableCompaction: z.boolean({ error: "must be a boolean" }).optional(),
      })
      .refine((value) => value.maxOutputTokens < value.contextWindowTokens, {
        path: ["maxOutputTokens"],
        error: "must be smaller than contextWindowTokens",
      })
      .optional(),
  })
  .refine(
    (value) =>
      value.checkpoint === undefined ||
      (value.capabilities ?? []).includes(value.checkpoint.capability),
    { path: ["checkpoint", "capability"], error: "must be attached to the agent" },
  );
export function agent<TState, TOutput = never>(
  definition: AgentDefinition<TState, TOutput>,
): Agent<TState> {
  const rawOutput =
    definition.output && "raw" in definition.output && definition.output.raw === true;
  if (!rawOutput || typeof definition.instructions !== "string") {
    requireInstructions(definition.instructions, `Agent '${definition.id}' instructions`);
  }
  if (definition.output && (!rawOutput || typeof definition.output.instructions !== "string")) {
    requireInstructions(
      definition.output.instructions,
      `Agent '${definition.id}' output instructions`,
    );
  }
  if (definition.checkpoint) {
    requireInstructions(
      definition.checkpoint.instructions,
      `Agent '${definition.id}' checkpoint instructions`,
    );
  }
  parseDefinition(agentOptionsSchema, definition, `Agent '${definition.id}'`);
  const record: AgentRecord<TState, TOutput> = {
    ...definition,
    [participantBrand]: keepState,
    kind: "agent",
  };
  return Object.freeze(record);
}

type ParallelBranches<TState> = Readonly<Record<string, Stage<TState> | Agent<TState>>>;
type ParallelDefinition<TState, TBranches extends ParallelBranches<TState>> = {
  readonly id: string;
  readonly branches: TBranches;
  readonly merge: (
    baseline: TState,
    results: { readonly [K in keyof TBranches]: TState },
  ) => TState;
  /** Maximum active branches per invocation; omitted means all branches. */
  readonly max?: number;
  readonly persist?: boolean;
};
type ParallelRecord<TState, TBranches extends ParallelBranches<TState>> = Parallel<TState> &
  ParallelDefinition<TState, TBranches>;
export function parallel<TState>(): <const TBranches extends ParallelBranches<TState>>(
  definition: ParallelDefinition<TState, TBranches>,
) => Parallel<TState>;
export function parallel<TState, const TBranches extends ParallelBranches<TState>>(
  definition: ParallelDefinition<TState, TBranches>,
): Parallel<TState>;
export function parallel<TState>(
  definition?: ParallelDefinition<TState, ParallelBranches<TState>>,
):
  | Parallel<TState>
  | (<const TBranches extends ParallelBranches<TState>>(
      value: ParallelDefinition<TState, TBranches>,
    ) => Parallel<TState>) {
  if (!definition) {
    return (value) => createParallel(value);
  }
  return createParallel(definition);
}
const parallelOptionsSchema = z.object({
  max: positiveInt32.optional(),
  branches: z
    .record(z.string(), z.custom())
    .refine((branches) => Object.keys(branches).every((id) => id.trim().length > 0), {
      error: "must not have a blank branch ID",
    })
    .refine((branches) => Object.keys(branches).length >= 2, {
      error: "requires at least two branches",
    })
    .refine((branches) => hasUnique(Object.values(branches), (participant) => participant), {
      error: "must own a distinct participant per branch",
    }),
});
function createParallel<TState, TBranches extends ParallelBranches<TState>>(
  definition: ParallelDefinition<TState, TBranches>,
): Parallel<TState> {
  parseDefinition(parallelOptionsSchema, definition, `Parallel group '${definition.id}'`);
  const record: ParallelRecord<TState, TBranches> = {
    ...definition,
    [participantBrand]: keepState,
    kind: "parallel",
  };
  return Object.freeze(record);
}

type TerminalDefinition<TState> = {
  id: string;
  summary: (state: TState) => string;
  failed?: boolean;
  persist?: boolean;
};
type TerminalRecord<TState> = Terminal<TState> & TerminalDefinition<TState>;
export function output<TState>(definition: TerminalDefinition<TState>): Terminal<TState> {
  const record: TerminalRecord<TState> = {
    ...definition,
    [participantBrand]: keepState,
    kind: "terminal",
  };
  return Object.freeze(record);
}

type NodeRecord<TState> =
  | StageRecord<TState>
  | InteractionRecord<TState, unknown, unknown>
  | AgentRecord<TState, unknown>
  | ParallelRecord<TState, ParallelBranches<TState>>
  | CollectionRecord<TState, unknown, unknown>
  | TerminalRecord<TState>;
/**
 * Every node is the frozen record its factory built; the exported node interfaces are opaque views
 * of those records, with the request/output/item types erased here.
 */
function nodeRecord<TState>(node: Node<TState>): NodeRecord<TState> {
  return node as NodeRecord<TState>;
}

export interface OrdinaryRoute<TState> {
  readonly from: Stage<TState> | Collection<TState> | Interaction<TState, unknown, unknown>;
  readonly to: Node<TState>;
  readonly label: string;
  readonly outcome?: never;
  readonly when?: (state: TState) => boolean;
}
export interface StandardOutcomeRoute<TState> {
  readonly from: Agent<TState> | Parallel<TState>;
  readonly to: Node<TState>;
  readonly label: string;
  readonly outcome: "success" | "failed";
  readonly when?: (state: TState) => boolean;
}
export type Route<TState> = OrdinaryRoute<TState> | StandardOutcomeRoute<TState>;
export function route<TState>(definition: OrdinaryRoute<TState>): OrdinaryRoute<TState>;
export function route<TState>(
  definition: StandardOutcomeRoute<TState>,
): StandardOutcomeRoute<TState>;
export function route<TState>(definition: Route<TState>): Route<TState> {
  return definition;
}

export interface Pipeline<TState> {
  readonly name: string;
  readonly state: z.ZodType<TState>;
  readonly nodes: readonly Node<TState>[];
  readonly start: Exclude<Node<TState>, Terminal<TState>>;
  readonly routes: readonly Route<TState>[];
  readonly outputs: readonly Terminal<TState>[];
  readonly persist: boolean;
}
export function pipeline<TState>(definition: {
  name: string;
  state: z.ZodType<TState>;
  nodes: readonly Node<NoInfer<TState>>[];
  start: Exclude<Node<NoInfer<TState>>, Terminal<NoInfer<TState>>>;
  routes: readonly Route<NoInfer<TState>>[];
  outputs: readonly Terminal<NoInfer<TState>>[];
  persist?: boolean;
}): Pipeline<TState> {
  const start = definition.start as Node<TState>;
  const members = new Set<Node<TState>>(definition.nodes);
  if (members.size !== definition.nodes.length) {
    throw new Error("Pipeline nodes must contain each participant object exactly once.");
  }
  const ids = new Set(definition.nodes.map((node) => node.id));
  if (ids.size !== definition.nodes.length) {
    throw new Error("Pipeline node IDs must be unique.");
  }
  const ownedParticipants = new Set<Stage<TState> | Agent<TState>>();
  for (const node of definition.nodes.map(nodeRecord)) {
    if (node.kind !== "parallel") {
      continue;
    }
    for (const participant of Object.values(node.branches)) {
      if (members.has(participant)) {
        throw new Error(
          `Parallel branch participant '${participant.id}' cannot also be a parent pipeline node.`,
        );
      }
      if (!ownedParticipants.add(participant)) {
        throw new Error(`Parallel branch participant '${participant.id}' is owned more than once.`);
      }
      if (ids.has(participant.id)) {
        throw new Error(`Pipeline participant ID '${participant.id}' must be globally unique.`);
      }
      ids.add(participant.id);
    }
  }
  if (!members.has(definition.start)) {
    throw new Error(
      `Pipeline start '${definition.start.id}' must be the registered participant object.`,
    );
  }
  if (start.kind === "terminal") {
    throw new Error(`Pipeline start '${start.id}' cannot be a terminal.`);
  }
  for (const item of definition.routes) {
    if (!members.has(item.from) || !members.has(item.to)) {
      throw new Error(`Route '${item.label}' endpoints must be registered participant objects.`);
    }
  }
  const unconditionalRoutes = new Map<string, Route<TState>>();
  for (const item of definition.routes) {
    if (item.when) {
      continue;
    }
    const key = `${item.from.id}\u0000${item.outcome ?? "default"}`;
    const existing = unconditionalRoutes.get(key);
    if (existing) {
      throw new Error(
        `Routes '${existing.label}' and '${item.label}' are both unconditional from '${item.from.id}'.`,
      );
    }
    unconditionalRoutes.set(key, item);
  }
  if (new Set(definition.outputs).size !== definition.outputs.length) {
    throw new Error("Pipeline outputs must contain each terminal exactly once.");
  }
  for (const item of definition.outputs) {
    if (!members.has(item)) {
      throw new Error(`Output '${item.id}' must be the registered participant object.`);
    }
  }
  const reachable = new Set<Node<TState>>([start]);
  const pending: Node<TState>[] = [start];
  while (pending.length > 0) {
    const source = pending.pop()!;
    for (const item of definition.routes) {
      if (item.from === source && !reachable.has(item.to)) {
        reachable.add(item.to);
        pending.push(item.to);
      }
    }
  }
  const outputs = new Set<Node<TState>>(definition.outputs);
  for (const node of reachable) {
    if (node.kind === "terminal" && !outputs.has(node)) {
      throw new Error(`Reachable terminal '${node.id}' must be listed in outputs.`);
    }
  }
  for (const item of definition.outputs) {
    if (!reachable.has(item)) {
      throw new Error(`Output '${item.id}' must be reachable from start '${start.id}'.`);
    }
  }
  return { ...definition, persist: definition.persist ?? false };
}

export interface PipelineInspection {
  readonly name: string;
  readonly stateSchema: unknown;
  readonly start: string;
  readonly persist: boolean;
  readonly nodes: readonly InspectedNode[];
  readonly routes: readonly InspectedRoute[];
  readonly outputs: readonly string[];
}
export interface InspectedRoute {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label: string;
  readonly order: number;
  readonly outcome?: "success" | "failed";
  readonly conditional: boolean;
}
export interface InspectedNode {
  readonly id: string;
  readonly kind:
    | "stage"
    | "interaction"
    | "agent"
    | "parallel"
    | "collection"
    | "completion"
    | "failure";
  readonly agents?: readonly string[];
  readonly persist?: boolean;
  readonly interaction?: { readonly requestSchema: unknown; readonly responseSchema: unknown };
  readonly agent?: {
    readonly capabilities: readonly { readonly name: string; readonly requestSchema: unknown }[];
    readonly outputSchema?: unknown;
    readonly workspace: boolean;
  };
  readonly max?: number;
  readonly branches?: readonly { readonly id: string; readonly participant: InspectedNode }[];
}

/** Projects an instantiated pipeline without compiling, registering, or invoking callbacks. */
export function inspectPipeline<TState>(graph: Pipeline<TState>): PipelineInspection {
  const inspectNode = (node: Node<TState>): InspectedNode => {
    const record = nodeRecord(node);
    const { id, persist } = record;
    switch (record.kind) {
      case "stage":
        return { id, kind: "stage", persist };
      case "terminal":
        return { id, kind: record.failed ? "failure" : "completion", persist };
      case "collection":
        return {
          id,
          kind: "collection",
          persist,
          max: record.max,
          agents: record.agents.map((agent) => `${id}/${agent.id}`),
        };
      case "interaction":
        return {
          id,
          kind: "interaction",
          persist,
          interaction: {
            requestSchema: z.toJSONSchema(record.requestSchema, { io: "input" }),
            responseSchema: z.toJSONSchema(record.responseSchema, { io: "input" }),
          },
        };
      case "agent":
        return {
          id,
          kind: "agent",
          persist,
          agent: {
            capabilities: (record.capabilities ?? []).map((item) => ({
              name: item.name,
              requestSchema: JSON.parse(
                (item as CapabilityRecord<TState>).requestJsonSchema,
              ) as unknown,
            })),
            ...(!record.output || "raw" in record.output
              ? {}
              : { outputSchema: z.toJSONSchema(record.output.schema, { io: "input" }) }),
            workspace: record.workspace !== undefined,
          },
        };
      case "parallel":
        return {
          id,
          kind: "parallel",
          persist,
          ...(record.max !== undefined ? { max: record.max } : {}),
          branches: Object.entries(record.branches).map(([branchId, participant]) => ({
            id: branchId,
            participant: inspectNode(participant),
          })),
        };
      default:
        return record satisfies never;
    }
  };
  return {
    name: graph.name,
    stateSchema: z.toJSONSchema(graph.state, { io: "input" }),
    start: graph.start.id,
    persist: graph.persist,
    nodes: graph.nodes.map(inspectNode),
    routes: graph.routes.map((item, order) => ({
      id: `route:${order}`,
      source: item.from.id,
      target: item.to.id,
      label: item.label,
      order,
      ...(item.outcome === undefined ? {} : { outcome: item.outcome }),
      conditional: item.when !== undefined,
    })),
    outputs: graph.outputs.map((item) => item.id),
  };
}

export interface RunResult<TState> {
  readonly runId: string;
  readonly succeeded: boolean;
  readonly state: TState;
  readonly summary: string | null;
}
export interface TerminalPresentationOptions {
  readonly truncatedToolNames?: readonly string[];
}
export interface RunOptions {
  readonly ledgerPath?: string;
  /** Expose ledger read/search tools to agents. Disabled by default; does not affect logging. */
  readonly enableLedgerTools?: boolean;
  readonly signal?: AbortSignal;
  readonly interactions?: InteractionHandlers;
  readonly presentation?: "terminal";
  readonly terminal?: TerminalPresentationOptions;
  readonly observe?: (
    event: RunObservation,
    context: { readonly signal: AbortSignal },
  ) => void | Promise<void>;
}
const observationBase = z.object({
  version: z.literal(1),
  stepId: z.string().min(1),
  visitId: z.string().nullable().optional(),
});
const observation = <TKind extends string, TShape extends z.ZodRawShape>(
  kind: TKind,
  shape: TShape,
) => observationBase.extend({ kind: z.literal(kind), ...shape }).strict();
const tokenCount = z.number().int().nonnegative();
const runObservationSchema = z
  .discriminatedUnion("kind", [
    observation("stepStarted", {}),
    observation("stepCompleted", {}),
    observation("stepCancelled", {}),
    observation("stepFaulted", { error: z.string() }),
    observation("agentText", { text: z.string() }),
    observation("agentReasoning", { text: z.string() }),
    observation("agentModelSelected", { modelId: z.string().min(1) }),
    observation("agentUsage", {
      inputTokens: tokenCount,
      outputTokens: tokenCount,
      reasoningTokens: tokenCount,
      currentContextTokens: tokenCount,
      contextWindowTokens: tokenCount.nullable(),
    }),
    observation("structuredOutputRejected", {
      attempt: z.number().int().positive(),
      problems: z
        .array(
          z
            .object({ field: z.string(), message: z.string().min(1) })
            .strict()
            .readonly(),
        )
        .readonly(),
      rawResponse: z.string(),
    }),
  ])
  .readonly();
export type RunObservation = z.infer<typeof runObservationSchema>;
const acceptedValueFields = z
  .object({
    kind: z.enum([
      "StructuredOutputAccepted",
      "CapabilityAccepted",
      "InteractionRequested",
      "InteractionAnswered",
      "StepCompleted",
    ]),
    stepId: z.string().min(1),
    visitId: z.string().nullable().optional(),
    valueType: z.string().min(1).nullable(),
    payload: z.unknown(),
  })
  .strict();
export type AcceptedValue = Readonly<{ version: 1 } & z.infer<typeof acceptedValueFields>>;
const acceptedValuesSchema = z.array(
  acceptedValueFields.refine((value) => value.valueType !== null || value.payload !== null, {
    message: "valueType and payload cannot both be null",
  }),
);
const runResultSchema = z
  .object({
    runId: z.uuid(),
    succeeded: z.boolean(),
    state: z.unknown(),
    summary: z.string().nullable(),
  })
  .strict();

export async function inspectAccepted(options: {
  ledgerPath: string;
  runId: string;
}): Promise<readonly AcceptedValue[]> {
  try {
    const { inspectAcceptedAsync } = await import("./runtime/loader.mjs");
    return parseJson(
      acceptedValuesSchema,
      await inspectAcceptedAsync(options.ledgerPath, options.runId),
      "accepted values",
    ).map((value): AcceptedValue => ({
      version: 1,
      kind: value.kind,
      stepId: value.stepId,
      ...(value.visitId == null ? {} : { visitId: value.visitId }),
      valueType: value.valueType,
      payload: value.payload,
    }));
  } catch (error) {
    if (error instanceof TandemError) {
      throw error;
    }
    throw new TandemRuntimeError("inspect", error);
  }
}

export async function run<TState>(
  graph: Pipeline<TState>,
  initial: unknown,
  options: RunOptions = {},
): Promise<RunResult<TState>> {
  const initialState = serializeBoundary(graph.state, initial, "initial state");
  if ((graph.persist || graph.nodes.some(participantPersists)) && !options.ledgerPath) {
    throw new TandemError("ledgerPath is required when persistence is enabled.");
  }
  const callbacks = new CallbackRegistry();
  try {
    const nodes = graph.nodes.map((node) => compileNode(node, graph.state, callbacks));
    const routes = graph.routes.map((item) => {
      const callback = item.when
        ? callbacks.registerSync((state) =>
            String(item.when!(parseJson(graph.state, state, `route '${item.label}' state`))),
          )
        : undefined;
      return {
        source: item.from.id,
        target: item.to.id,
        label: item.label,
        outcome: item.outcome,
        predicateCallback: callback,
      };
    });
    const handlerEntries = interactionHandlerEntries(options.interactions);
    const members = new Set<object>(graph.nodes);
    const interactionHandlers = handlerEntries.map((entry, index) => {
      if (!members.has(entry.interaction)) {
        throw new TandemError(
          `Interaction handler '${entry.interaction.id}' must target a participant in pipeline '${graph.name}'.`,
        );
      }
      const { id, requestSchema, responseSchema } = entry.interaction;
      const handleCallback = callbacks.registerAsync(async (_, input, signal) => {
        const response = await entry.handle(
          parseJson(requestSchema, input, `${id} request input`),
          { signal },
        );
        signal.throwIfAborted();
        return serializeBoundary(responseSchema, response, `${id} response`);
      });
      return { id: `h${index}`, target: entry.interaction.id, handleCallback };
    });
    const observationCallback = options.observe
      ? callbacks.registerAsync(async (_, input, signal) => {
          const event = parseJson(runObservationSchema, input, "run observation");
          const observationSignal =
            options.signal?.aborted === true
              ? AbortSignal.abort(options.signal.reason)
              : event.kind === "stepCancelled" && !signal.aborted
                ? AbortSignal.abort()
                : signal;
          await options.observe!(event, { signal: observationSignal });
          return "";
        })
      : undefined;
    const { runRegisteredGraphAsync } = await import("./runtime/loader.mjs");
    const resultJson = await runRegisteredGraphAsync(
      JSON.stringify({
        contractVersion: 10,
        name: graph.name,
        start: graph.start.id,
        initialState,
        persist: graph.persist,
        ledgerPath: options.ledgerPath,
        enableLedgerTools: options.enableLedgerTools ?? false,
        presentation: options.presentation,
        terminal: options.terminal,
        observationCallback,
        nodes,
        routes,
        outputs: graph.outputs.map((item) => item.id),
        interactionHandlers,
      }),
      (id: string, state: string, input: string) => {
        const result = callbacks.invoke(id, state, input, neverAborted);
        return typeof result === "string"
          ? result
          : callbackFailed(new Error(`Internal callback '${id}' is asynchronous.`));
      },
      async (id: string, state: string, input: string, signal: AbortSignal) =>
        callbacks.invoke(id, state, input, signal),
      options.signal,
    );
    const result = parseJson(runResultSchema, resultJson, "run result");
    return { ...result, state: parse(graph.state, result.state, "final state") };
  } catch (error) {
    if (error instanceof TandemError) {
      throw error;
    }
    const callbackFailure = callbackContractFailure(error);
    if (callbackFailure) {
      throw new ContractValidationError(callbackFailure.boundary, callbackFailure.problems);
    }
    if (isCancellation(error, options.signal)) {
      throw new TandemCancellationError(error);
    }
    throw new TandemRuntimeError("run", error);
  } finally {
    callbacks.dispose();
  }
}

function participantPersists<TState>(node: Node<TState>): boolean {
  const record = nodeRecord(node);
  return (
    record.persist === true ||
    (record.kind === "parallel" && Object.values(record.branches).some(participantPersists))
  );
}

function issues<T>(schema: z.ZodType<T>, input: string): string {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    return JSON.stringify([{ path: "$", message: "Invalid JSON" }]);
  }
  return issuesParsed(schema, value);
}

function issuesParsed<T>(schema: z.ZodType<T>, value: unknown): string {
  try {
    parse(schema, value, "agent contract");
    return "";
  } catch (error) {
    if (error instanceof ContractValidationError) {
      return JSON.stringify(error.problems);
    }
    throw error;
  }
}
const validationProblemsSchema = z.array(
  z.object({ path: z.string(), message: z.string() }).strict(),
);
function validationProblems(problems: readonly ValidationProblem[], boundary: string): string {
  return JSON.stringify(parse(validationProblemsSchema, problems, boundary));
}
function requireInstructions(instructions: string, boundary: string): void {
  if (typeof instructions !== "string" || instructions.trim().length === 0) {
    throw new ContractValidationError(boundary, [
      { path: "$", message: "Instructions must be a non-blank string." },
    ]);
  }
}
/** Authoring errors read as "<subject> <field path> <problem>", e.g. "Agent 'a' checkpoint session must be ...". */
function parseDefinition<T>(schema: z.ZodType<T>, value: unknown, subject: string): T {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  const problems = result.error.issues.map((issue) => {
    const field = issue.path
      .map((part) => (typeof part === "number" ? `[${part}]` : ` ${String(part)}`))
      .join("");
    return `${field} ${issue.message}`;
  });
  throw new TandemError(`${subject}${problems.join(";")}.`);
}
function interactionHandlerEntries(
  handlers: InteractionHandlers | undefined,
): readonly RegisteredInteractionHandler[] {
  if (!handlers) {
    return [];
  }
  const entries = registeredHandlers.get(handlers);
  if (!entries) {
    throw new TandemError("interactions must be created by interactions().");
  }
  return entries;
}
function compileNode<TState>(
  node: Node<TState>,
  stateSchema: z.ZodType<TState>,
  callbacks: CallbackRegistry,
): object {
  const record = nodeRecord(node);
  const { id } = record;
  const base = { id, persist: record.persist };
  const parseState = (state: string, boundary: string) =>
    parseJson(stateSchema, state, `${id} ${boundary}`);
  switch (record.kind) {
    case "stage":
      return {
        ...base,
        kind: "stage",
        runCallback: callbacks.registerAsync(async (state, _, signal) =>
          serializeBoundary(
            stateSchema,
            await record.execute(parseState(state, "input"), { signal }),
            `${id} output`,
          ),
        ),
      };
    case "terminal":
      return {
        ...base,
        kind: record.failed ? "failure" : "completion",
        summaryCallback: callbacks.registerSync((state) =>
          record.summary(parseState(state, "state")),
        ),
      };
    case "interaction":
      return {
        ...base,
        kind: "interaction",
        requestCallback: callbacks.registerSync((state) =>
          serializeBoundary(
            record.requestSchema,
            record.request(parseState(state, "state")),
            `${id} request`,
          ),
        ),
        applyCallback: callbacks.registerSync((state, input) =>
          serializeBoundary(
            stateSchema,
            record.apply(
              parseState(state, "state"),
              parseJson(record.responseSchema, input, `${id} response input`),
            ),
            `${id} applied state`,
          ),
        ),
      };
    case "collection":
      return compileCollection(record, stateSchema, callbacks);
    case "agent":
      return compileAgent(record, stateSchema, callbacks);
    case "parallel": {
      const branches = Object.entries(record.branches);
      const branchStates = z.strictObject(
        Object.fromEntries(branches.map(([branchId]) => [branchId, stateSchema])),
      );
      return {
        ...base,
        kind: "parallel",
        ...(record.max !== undefined ? { max: record.max } : {}),
        branches: branches.map(([branchId, participant]) => ({
          id: branchId,
          participant: compileNode(participant, stateSchema, callbacks),
        })),
        mergeCallback: callbacks.registerSync((state, input) =>
          serializeBoundary(
            stateSchema,
            record.merge(
              parseState(state, "merge baseline"),
              parseJson(branchStates, input, `${id} merge branches`),
            ),
            `${id} merged state`,
          ),
        ),
      };
    }
    default:
      return record satisfies never;
  }
}

function compileCollection<TState>(
  collection: CollectionRecord<TState, unknown, unknown>,
  stateSchema: z.ZodType<TState>,
  callbacks: CallbackRegistry,
): object {
  const { id } = collection;
  const agents = collection.agents.map((reference) => {
    const task = taskAgentRecord(reference);
    return compileNode(task.participant, task.state, callbacks);
  });
  const itemsCallback = callbacks.registerSync((state) =>
    serializeBoundary(
      z.array(collection.item),
      collection.items(parseJson(stateSchema, state, `${id} state`)),
      `${id} items`,
    ),
  );
  const runCallback = callbacks.registerAsync(async (item, scopeId, signal) => {
    let active = false;
    let closed = false;
    const context: CollectionContext = {
      signal,
      async run<TInput, TOutput>(
        value: TaskAgent<TInput, TOutput>,
        input: NoInfer<TInput>,
      ): Promise<TOutput> {
        if (closed) throw new TandemError("Collection scope has ended.");
        if (active) throw new TandemError("Collection item agents must be awaited serially.");
        if (!collection.agents.includes(value)) {
          throw new TandemError("Agent is not declared in this collection.");
        }
        const task = taskAgentRecord(value);
        signal.throwIfAborted();
        active = true;
        try {
          const { runCollectionAgentAsync } = await import("./runtime/loader.mjs");
          const response = await runCollectionAgentAsync(
            scopeId,
            task.id,
            serializeBoundary(task.state, { input, output: null }, `${task.id} input`),
          );
          const state = parseJson(task.state, response, `${task.id} output`);
          if (state.output === null) throw new TandemError("Agent returned no output.");
          return parse(task.result, state.output.value, `${task.id} result`);
        } finally {
          active = false;
        }
      },
    };
    try {
      const result = await collection.execute(
        parseJson(collection.item, item, `${id} item`),
        context,
      );
      if (active) throw new TandemError("Collection item returned before its agent completed.");
      signal.throwIfAborted();
      return serializeBoundary(collection.result, result, `${id} result`);
    } finally {
      closed = true;
    }
  });
  const applyCallback = callbacks.registerSync((state, results) =>
    serializeBoundary(
      stateSchema,
      collection.apply(
        parseJson(stateSchema, state, `${id} state`),
        parseJson(z.array(collection.result), results, `${id} results`),
      ),
      `${id} output`,
    ),
  );
  return {
    id,
    persist: collection.persist,
    kind: "collection",
    agents,
    max: collection.max,
    itemsCallback,
    runCallback,
    applyCallback,
  };
}

function compileAgent<TState>(
  agent: AgentRecord<TState, unknown>,
  stateSchema: z.ZodType<TState>,
  callbacks: CallbackRegistry,
): object {
  const { id, checkpoint } = agent;
  const message = callbacks.registerSync((state) =>
    agent.message(parseJson(stateSchema, state, `${id} message state`)),
  );
  const output = agent.output
    ? compileAgentOutput(id, agent.output, stateSchema, callbacks)
    : undefined;
  const capabilities = (agent.capabilities ?? []).map((item) =>
    item[compileCapabilityBrand]({ id, stateSchema, callbacks }),
  );
  const workspace = agent.workspace
    ? compileWorkspace(id, agent.workspace, stateSchema, callbacks)
    : undefined;
  return {
    id,
    persist: agent.persist,
    kind: "agent",
    instructions: agent.instructions,
    client: { ...agent.client, verifyModel: agent.client.verifyModel ?? false },
    messageCallback: message,
    output,
    capabilities,
    skillDirectories: (agent.skills ?? []).map((item) => item.directory),
    temperature: agent.temperature,
    maxOutputTokens: agent.maxOutputTokens,
    reasoning: agent.reasoning,
    continueSession: agent.continueSession ?? false,
    checkpoint: checkpoint
      ? {
          contextWindowTokens: checkpoint.contextWindowTokens,
          maxOutputTokens: checkpoint.maxOutputTokens,
          checkpointAtPercent: checkpoint.checkpointAtPercent,
          capabilityName: checkpoint.capability.name,
          instructions: checkpoint.instructions,
          messageCallback: callbacks.registerSync((state, input) =>
            checkpoint.message(
              parseJson(stateSchema, state, `${id} checkpoint state`),
              Number(input),
            ),
          ),
          resetSession: (checkpoint.session ?? "reset") === "reset",
          disableCompaction: checkpoint.disableCompaction ?? false,
        }
      : undefined,
    timeoutMilliseconds: agent.timeoutMs,
    workspace,
  };
}

function compileWorkspace<TState>(
  id: string,
  authored: AgentWorkspaceConfiguration<TState>,
  stateSchema: z.ZodType<TState>,
  callbacks: CallbackRegistry,
): object {
  if (!("groups" in authored)) {
    throw new TandemError(
      `Agent '${id}' workspace must be created by agentWorkspace().withTools().`,
    );
  }
  // A workspace configuration is the record `withTools()` returned.
  const configuration = authored as WorkspaceConfigurationRecord<TState>;
  const workspace = configuration.workspace;
  const pathCallback = callbacks.registerSync((state) => {
    const value = workspace.path(parseJson(stateSchema, state, `${id} workspace path state`));
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new TandemError(`Agent '${id}' workspace path must be non-blank.`);
    }
    return value;
  });
  const commandsCallback = callbacks.registerSync((state) => {
    const typedState = parseJson(stateSchema, state, `${id} workspace commands state`);
    const commands =
      typeof workspace.commandSource === "function"
        ? parseDefinition(
            agentCommandsSchema,
            workspace.commandSource(typedState),
            `Agent '${id}' workspace commands`,
          )
        : (workspace.commandSource ?? []);
    return JSON.stringify(commands);
  });
  const selected = new Set<AgentToolSelection>();
  const toolGroups = configuration.groups.map((group, index) => {
    let includeCommands = false;
    const tools: AgentToolName[] = [];
    for (const tool of group.tools) {
      if (typeof tool === "string") {
        if (selected.has(tool)) {
          throw new TandemError(`Agent '${id}' selects '${tool}' more than once.`);
        }
        selected.add(tool);
        tools.push(tool);
      } else {
        if (tool[commandSelectionBrand] !== workspace) {
          throw new TandemError(`Agent '${id}' selects commands from another workspace.`);
        }
        if (workspace.commandSource === undefined) {
          throw new TandemError(
            `Agent '${id}' selects workspace commands without declaring a command catalogue.`,
          );
        }
        if (selected.has(tool)) {
          throw new TandemError(`Agent '${id}' selects workspace commands twice.`);
        }
        selected.add(tool);
        includeCommands = true;
      }
    }
    const whenCallback = group.predicate
      ? callbacks.registerSync((state) => {
          const value = group.predicate!(
            parseJson(stateSchema, state, `${id} tool group ${index} state`),
          );
          if (typeof value !== "boolean") {
            throw new TandemError(
              `Agent '${id}' tool group ${index} predicate must return a boolean.`,
            );
          }
          return String(value);
        })
      : undefined;
    return { tools, includeCommands, whenCallback };
  });
  const interceptCallback = configuration.interceptTool
    ? callbacks.registerAsync(async (state, input, signal) => {
        const typedState = parseJson(stateSchema, state, `${id} tool interception state`);
        let invocation: AgentToolInvocation;
        try {
          invocation = JSON.parse(input) as AgentToolInvocation;
        } catch {
          throw new TandemError(`Agent '${id}' received an invalid tool interception payload.`);
        }
        const result = await configuration.interceptTool!(typedState, invocation, { signal });
        if (result !== null && typeof result !== "string") {
          throw new TandemError(`Agent '${id}' tool interceptor must return a string or null.`);
        }
        return JSON.stringify(result);
      })
    : undefined;
  return { pathCallback, commandsCallback, toolGroups, interceptCallback };
}

function compileAgentOutput<TState, TOutput>(
  id: string,
  output: {
    instructions: string;
    schema?: z.ZodType<TOutput>;
    raw?: true;
    parse?: (response: string) => TOutput;
    validateFor?: (state: TState, output: TOutput) => readonly ValidationProblem[];
    apply: (state: TState, output: TOutput) => TState;
  },
  stateSchema: z.ZodType<TState>,
  callbacks: CallbackRegistry,
): object {
  const raw = output.raw === true;
  const validate = raw
    ? callbacks.registerSync((_, input) =>
        issuesParsed(
          z.unknown(),
          (output.parse as (response: string) => TOutput)(JSON.parse(input) as string),
        ),
      )
    : callbacks.registerSync((_, input) => issues(output.schema!, input));
  const validateFor = output.validateFor
    ? callbacks.registerSync((state, input) =>
        validationProblems(
          output.validateFor!(
            parseJson(stateSchema, state, `${id} state`),
            raw ? (JSON.parse(input) as TOutput) : parseJson(output.schema!, input, `${id} output`),
          ),
          `${id} output contextual validation`,
        ),
      )
    : undefined;
  const apply = callbacks.registerSync((state, input) =>
    serializeBoundary(
      stateSchema,
      output.apply(
        parseJson(stateSchema, state, `${id} state`),
        raw ? (JSON.parse(input) as TOutput) : parseJson(output.schema!, input, `${id} output`),
      ),
      `${id} applied state`,
    ),
  );
  return {
    instructions: output.instructions,
    ...(raw
      ? {
          raw: true,
          rawParseCallback: callbacks.registerSync((_, input) =>
            JSON.stringify((output.parse as (response: string) => TOutput)(input)),
          ),
        }
      : {
          jsonSchema: inputJsonSchema(output.schema!, `${id} output schema`),
          validateCallback: validate,
        }),
    validateForCallback: validateFor,
    applyCallback: apply,
    valueType: `${id}.output`,
  };
}
