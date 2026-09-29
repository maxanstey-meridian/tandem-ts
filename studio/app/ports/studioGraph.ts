import type { PipelineInspection } from "@maxanstey-meridian/tandem";
import type { EventHookOn } from "@vueuse/core";
import type { ComputedRef, Ref } from "vue";
import type { GraphResponse } from "../../src/graph-response";
import type { SourceOwnership } from "../../src/ownership";
import type {
  PresentationMode,
  SemanticGraph,
  SemanticNode,
  SemanticRoute,
} from "../../src/semantic-graph";
import type { SourceTarget } from "../../src/source-open";
import { useProvideInject } from "../composables/useProvideInject";

export interface Point {
  readonly x: number;
  readonly y: number;
}
export interface SemanticNodeData extends SemanticNode {
  readonly start: boolean;
}
export interface SemanticEdgeData extends SemanticRoute {
  readonly elkPath?: string;
  readonly elkAnchor?: Point;
  readonly focused: boolean;
  readonly unrelated: boolean;
  readonly normallyVisible: boolean;
}
// Narrower than Vue Flow's Node/Edge, which make `data` optional and are too deep for UnwrapRef.
export interface StudioFlowNode {
  readonly id: string;
  readonly position: Point;
  readonly data: SemanticNodeData;
  readonly type: "semantic";
  readonly class: string | readonly (string | Readonly<Record<string, boolean>>)[];
}
export interface StudioFlowEdge {
  readonly id: string;
  readonly source: string;
  readonly sourceHandle: string;
  readonly target: string;
  readonly targetHandle: string;
  readonly type: "semantic";
  readonly data: SemanticEdgeData;
  readonly markerEnd: "arrowclosed";
  readonly updatable: boolean | undefined;
}

export type LoadedGraph = Extract<GraphResponse, { readonly ok: true }>;

export interface Publication {
  readonly graph: PipelineInspection;
  readonly projection: SemanticGraph;
  readonly topologyUnchanged: boolean;
  readonly previousOwnership: SourceOwnership | undefined;
}

/** The loaded pipeline, its Vue Flow presentation, and graph-level emphasis. */
export interface StudioGraph {
  readonly loaded: Ref<LoadedGraph | undefined>;
  readonly mode: Ref<PresentationMode>;
  readonly dominantJourneyStatus: Ref<SemanticGraph["dominantJourneyStatus"] | undefined>;
  readonly nodes: Ref<StudioFlowNode[]>;
  readonly edges: Ref<StudioFlowEdge[]>;
  readonly diagnostic: Ref<string>;
  readonly reload: (force?: boolean) => Promise<void>;
  readonly setMode: (next: PresentationMode) => Promise<void>;
  readonly relayout: () => Promise<void>;
  readonly manualPositioningFinished: () => void;
  readonly emphasize: (routeId?: string, nodeId?: string) => void;
  readonly compactUnfocusedFailures: (exceptId?: string) => void;
  readonly revealCompactedRoute: (id: string) => void;
  readonly focusRoute: (id: string) => void;
  readonly focusNode: (id: string) => void;
  readonly openSource: (target: SourceTarget) => Promise<void>;
  readonly onPublished: EventHookOn<Publication>;
  readonly pipeline: ComputedRef<PipelineInspection | undefined>;
}

export const [injectStudioGraph, provideStudioGraph] = useProvideInject<StudioGraph>("StudioGraph");
