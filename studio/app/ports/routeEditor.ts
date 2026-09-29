import type { InspectedNode, InspectedRoute } from "@maxanstey-meridian/tandem";
import type { Connection } from "@vue-flow/core";
import type { Ref } from "vue";
import { useProvideInject } from "../composables/useProvideInject";
import type { RouteOutcome } from "../logic/routes";

export type Selection =
  | { readonly kind: "pipeline" }
  | { readonly kind: "node"; readonly node: InspectedNode }
  | { readonly kind: "route"; readonly route: InspectedRoute }
  | { readonly kind: "new-route" };

/** An unsaved route edit. Orders are within the source's outgoing group, as the server expects. */
export type RouteDraft =
  | {
      kind: "insert";
      order: number;
      from: string;
      to: string;
      label: string;
      outcome: RouteOutcome | null;
      when: string;
    }
  | {
      kind: "update";
      originalOrder: number;
      groupOrder: number;
      from: string;
      to: string;
      label: string;
      outcome: RouteOutcome | null;
      when: string;
    };

/** What is selected, and the route edit being drafted from it. */
export interface RouteEditor {
  readonly selected: Ref<Selection>;
  readonly draft: Ref<RouteDraft | undefined>;
  readonly saving: Ref<boolean>;
  readonly needsOutcome: (id: string) => boolean;
  readonly selectNode: (id: string) => void;
  readonly selectRoute: (id: string) => void;
  readonly restoreEmphasis: () => void;
  readonly connect: (connection: Connection) => void;
  readonly reconnect: (routeId: string, connection: Connection) => void;
  readonly changeDraftSource: () => void;
  readonly resetInsertionOrder: () => void;
  readonly submit: () => Promise<void>;
  readonly remove: () => Promise<void>;
  readonly move: (delta: number) => Promise<void>;
}

export const [injectRouteEditor, provideRouteEditor] = useProvideInject<RouteEditor>("RouteEditor");
