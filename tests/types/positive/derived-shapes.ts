import type { AcceptedValue, RunObservation } from "../../../dist/index.js";

// Shapes as hand-written before L3 derived them from Zod; both directions must stay assignable.
type HandWrittenRunObservation = {
  readonly visitId?: string | null;
} & (
  | {
      readonly version: 1;
      readonly kind: "stepStarted";
      readonly stepId: string;
    }
  | {
      readonly version: 1;
      readonly kind: "stepCompleted";
      readonly stepId: string;
    }
  | {
      readonly version: 1;
      readonly kind: "stepCancelled";
      readonly stepId: string;
    }
  | {
      readonly version: 1;
      readonly kind: "stepFaulted";
      readonly stepId: string;
      readonly error: string;
    }
  | {
      readonly version: 1;
      readonly kind: "agentText";
      readonly stepId: string;
      readonly text: string;
    }
  | {
      readonly version: 1;
      readonly kind: "agentReasoning";
      readonly stepId: string;
      readonly text: string;
    }
  | {
      readonly version: 1;
      readonly kind: "agentModelSelected";
      readonly stepId: string;
      readonly modelId: string;
    }
  | {
      readonly version: 1;
      readonly kind: "agentUsage";
      readonly stepId: string;
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly reasoningTokens: number;
      readonly currentContextTokens: number;
      readonly contextWindowTokens: number | null;
    }
  | {
      readonly version: 1;
      readonly kind: "structuredOutputRejected";
      readonly stepId: string;
      readonly attempt: number;
      readonly problems: readonly {
        readonly field: string;
        readonly message: string;
      }[];
      readonly rawResponse: string;
    }
);
type AcceptedKinds = readonly [
  "StructuredOutputAccepted",
  "CapabilityAccepted",
  "InteractionRequested",
  "InteractionAnswered",
  "StepCompleted",
];
type AcceptedKind = AcceptedKinds[number];
type HandWrittenAcceptedValue = {
  [K in AcceptedKind]: {
    readonly version: 1;
    readonly kind: K;
    readonly stepId: string;
    readonly visitId?: string | null;
    readonly valueType: string | null;
    readonly payload: unknown | null;
  };
}[AcceptedKind];

type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
true satisfies MutuallyAssignable<RunObservation, HandWrittenRunObservation>;
true satisfies MutuallyAssignable<AcceptedValue, HandWrittenAcceptedValue>;
