import type { PipelineInspection } from "@maxanstey-meridian/tandem";
import type { SourceOwnership } from "./ownership.js";

/** Which grouped route placements the source can accept without crossing helper-generated routes. */
export interface RouteEditing {
  /** Keyed by `source\u0000outcome`; one flag per insertion boundary in the group. */
  readonly insertions: Readonly<Record<string, readonly boolean[]>>;
  /** Per pipeline route, one flag per target position in its group. */
  readonly moves: readonly (readonly boolean[])[];
}

export type GraphResponse =
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: true;
      readonly config: string;
      readonly graph: PipelineInspection;
      readonly ownership: SourceOwnership;
      readonly editing: RouteEditing;
      readonly editRevision: string;
    };
