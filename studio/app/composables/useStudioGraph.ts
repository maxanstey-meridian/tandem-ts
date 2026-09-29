import { useVueFlow } from "@vue-flow/core";
import { createEventHook } from "@vueuse/core";
import ELK from "elkjs/lib/elk.bundled.js";
import { isEqual } from "ohash";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { mapElkLayout } from "../../src/elk-geometry";
import type { GraphResponse } from "../../src/graph-response";
import { mergeStablePositions, parseSavedPositions } from "../../src/presentation";
import {
  elkGraph,
  modePositionStorageKey,
  projectSemanticGraph,
  type PresentationMode,
  type SemanticGraph,
  type SemanticRoute,
} from "../../src/semantic-graph";
import type { SourceTarget } from "../../src/source-open";
import type {
  LoadedGraph,
  Point,
  Publication,
  StudioFlowEdge,
  StudioFlowNode,
  StudioGraph,
} from "../ports/studioGraph";

const failureMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const layoutFailure = (error: unknown) => `Automatic layout failed: ${failureMessage(error)}`;

function toFlowEdge(
  route: SemanticRoute,
  updatable: boolean | undefined,
  geometry: { readonly elkPath?: string; readonly elkAnchor?: Point } = {},
): StudioFlowEdge {
  return {
    id: route.id,
    source: route.source,
    sourceHandle: route.sourcePort,
    target: route.target,
    targetHandle: route.targetPort,
    type: "semantic",
    data: {
      ...route,
      ...geometry,
      focused: false,
      unrelated: false,
      normallyVisible: route.visible,
    },
    markerEnd: "arrowclosed",
    updatable,
  };
}

export function useStudioGraph() {
  const loaded = ref<LoadedGraph>();
  const mode = ref<PresentationMode>("lifecycle");
  const dominantJourneyStatus = ref<SemanticGraph["dominantJourneyStatus"]>();
  const nodes = ref<StudioFlowNode[]>([]);
  const edges = ref<StudioFlowEdge[]>([]);
  const diagnostic = ref("");
  const published = createEventHook<Publication>();
  const pipeline = computed(() => loaded.value?.graph);
  const { fitView } = useVueFlow();
  let latestReload = 0;

  const positions = (): Record<string, Point> =>
    Object.fromEntries(nodes.value.map((node) => [node.id, node.position]));
  function savePositions() {
    if (loaded.value) {
      localStorage.setItem(
        modePositionStorageKey(loaded.value.config, loaded.value.graph.name, mode.value),
        JSON.stringify(positions()),
      );
    }
  }
  function manualPositioningFinished() {
    edges.value = edges.value.map((edge) => ({
      ...edge,
      data: { ...edge.data, elkPath: undefined, elkAnchor: undefined },
    }));
    savePositions();
  }
  async function automaticPositions(graph: LoadedGraph["graph"], presentation: PresentationMode) {
    return mapElkLayout(
      await new ELK().layout(elkGraph(projectSemanticGraph(graph, presentation))),
    );
  }

  async function publish(
    result: LoadedGraph,
    { force = false, retainLivePositions = true, nextMode = mode.value } = {},
  ) {
    const previous = loaded.value;
    const sameIdentity =
      previous?.config === result.config && previous.graph.name === result.graph.name;
    const current = sameIdentity && retainLivePositions ? positions() : {};
    // Layout may throw; nothing is committed before it succeeds.
    const layout = await automaticPositions(result.graph, nextMode);
    const retained = mergeStablePositions(
      result.graph.nodes.map((node) => node.id),
      current,
      parseSavedPositions(
        localStorage.getItem(modePositionStorageKey(result.config, result.graph.name, nextMode)),
      ),
      layout.positions,
    );
    const projection = projectSemanticGraph(result.graph, nextMode);
    const keepElkPaths = Object.keys(layout.positions).every(
      (id) =>
        retained[id]?.x === layout.positions[id]?.x && retained[id]?.y === layout.positions[id]?.y,
    );
    mode.value = nextMode;
    loaded.value = result;
    dominantJourneyStatus.value = projection.dominantJourneyStatus;
    nodes.value = projection.nodes.map((node) => ({
      id: node.id,
      position: retained[node.id] ?? { x: 0, y: 0 },
      data: { ...node, start: node.id === result.graph.start },
      type: "semantic",
      class: `kind-${node.kind}`,
    }));
    edges.value = projection.routes
      .filter((route) => route.visible)
      .map((route) =>
        toFlowEdge(
          route,
          result.ownership.routes[route.order]?.editable,
          keepElkPaths
            ? { elkPath: layout.edgePaths[route.id], elkAnchor: layout.edgeAnchors[route.id] }
            : {},
        ),
      );
    await published.trigger({
      graph: result.graph,
      projection,
      topologyUnchanged: isEqual(result.graph, previous?.graph),
      previousOwnership: previous?.ownership,
    });
    savePositions();
    if (force || !retained[result.graph.start]) {
      await nextTick();
      fitView();
    }
  }

  async function reload(force = false) {
    const generation = ++latestReload;
    const result: GraphResponse = await $fetch("/api/graph");
    if (generation !== latestReload) {
      return;
    }
    if (!result.ok) {
      diagnostic.value = result.error;
      return;
    }
    diagnostic.value = "";
    if (
      force ||
      !isEqual(result.graph, loaded.value?.graph) ||
      !isEqual(result.ownership, loaded.value?.ownership)
    ) {
      try {
        await publish(result, { force });
      } catch (error) {
        diagnostic.value = layoutFailure(error);
      }
    }
  }

  async function setMode(next: PresentationMode) {
    if (next === mode.value || !loaded.value) {
      return;
    }
    savePositions();
    try {
      await publish(loaded.value, { force: true, retainLivePositions: false, nextMode: next });
      diagnostic.value = "";
    } catch (error) {
      diagnostic.value = layoutFailure(error);
    }
  }

  async function relayout() {
    if (!loaded.value) {
      return;
    }
    try {
      const layout = await automaticPositions(loaded.value.graph, mode.value);
      nodes.value = nodes.value.map((node) => ({
        ...node,
        position: layout.positions[node.id] ?? node.position,
      }));
      edges.value = edges.value.map((edge) => ({
        ...edge,
        data: {
          ...edge.data,
          elkPath: layout.edgePaths[edge.id],
          elkAnchor: layout.edgeAnchors[edge.id],
        },
      }));
      diagnostic.value = "";
      savePositions();
      await nextTick();
      fitView();
    } catch (error) {
      diagnostic.value = layoutFailure(error);
    }
  }

  function emphasize(routeId?: string, nodeId?: string) {
    const route = loaded.value?.graph.routes.find((item) => item.id === routeId);
    const focusing = Boolean(routeId || nodeId);
    edges.value = edges.value.map((edge) => ({
      ...edge,
      data: {
        ...edge.data,
        focused: edge.id === routeId,
        unrelated:
          focusing && edge.id !== routeId && edge.source !== nodeId && edge.target !== nodeId,
      },
    }));
    nodes.value = nodes.value.map((node) => ({
      ...node,
      class: [
        `kind-${node.data.kind}`,
        {
          unrelated:
            focusing &&
            node.id !== nodeId &&
            node.id !== route?.source &&
            node.id !== route?.target,
        },
      ],
    }));
  }
  function compactUnfocusedFailures(exceptId?: string) {
    edges.value = edges.value.filter(
      (edge) => edge.id === exceptId || edge.data.normallyVisible !== false,
    );
  }
  function revealCompactedRoute(id: string) {
    if (edges.value.some((edge) => edge.id === id) || !loaded.value) {
      return;
    }
    const route = projectSemanticGraph(loaded.value.graph, mode.value).routes.find(
      (candidate) => candidate.id === id,
    );
    if (route?.compacted) {
      edges.value = [
        ...edges.value,
        toFlowEdge(route, loaded.value.ownership.routes[route.order]?.editable),
      ];
    }
  }
  function focusRoute(id: string) {
    revealCompactedRoute(id);
    emphasize(id);
  }
  function focusNode(id: string) {
    compactUnfocusedFailures();
    emphasize(undefined, id);
  }

  async function openSource(target: SourceTarget) {
    const result = await $fetch("/api/open", { method: "POST", body: target });
    if (!result.ok) {
      diagnostic.value = result.error;
    }
  }

  let changes: EventSource | undefined;
  onMounted(() => {
    void reload(true);
    changes = new EventSource("/api/changes");
    changes.addEventListener("change", () => void reload());
  });
  onBeforeUnmount(() => changes?.close());

  const implementation = {
    loaded,
    pipeline,
    mode,
    dominantJourneyStatus,
    nodes,
    edges,
    diagnostic,
    onPublished: published.on,
    reload,
    setMode,
    relayout,
    manualPositioningFinished,
    emphasize,
    compactUnfocusedFailures,
    revealCompactedRoute,
    focusRoute,
    focusNode,
    openSource,
  };
  implementation satisfies StudioGraph;
  return implementation;
}
