import type { Connection } from "@vue-flow/core";
import { ref } from "vue";
import type { RouteEdit } from "../../src/source";
import { groupKey, outgoingOrder, type RouteOutcome } from "../logic/routes";
import type { RouteDraft, RouteEditor, Selection } from "../ports/routeEditor";
import { injectStudioGraph, type Publication } from "../ports/studioGraph";

export function useRouteEditor() {
  const studio = injectStudioGraph();
  const selected = ref<Selection>({ kind: "pipeline" });
  const draft = ref<RouteDraft>();
  const saving = ref(false);

  const needsOutcome = (id: string) => {
    const kind = studio.loaded.value?.graph.nodes.find((node) => node.id === id)?.kind;
    return kind === "agent" || kind === "parallel";
  };
  const insertionOptions = (source: string, outcome: RouteOutcome | null) =>
    studio.loaded.value?.editing.insertions[groupKey(source, outcome)] ?? [];
  function portOutcome(source: string, handle: string | null | undefined) {
    const node = studio.nodes.value.find((candidate) => candidate.id === source);
    return [...(node?.data.ports ?? []), ...(node?.data.creationPorts ?? [])].find(
      (port) => port.id === handle,
    )?.outcome;
  }

  function restoreEmphasis() {
    const current = selected.value;
    if (current.kind === "route") {
      studio.revealCompactedRoute(current.route.id);
      studio.compactUnfocusedFailures(current.route.id);
      studio.emphasize(current.route.id);
      return;
    }
    studio.compactUnfocusedFailures();
    studio.emphasize(undefined, current.kind === "node" ? current.node.id : undefined);
  }

  function selectNode(id: string) {
    const node = studio.loaded.value?.graph.nodes.find((candidate) => candidate.id === id);
    if (!node) {
      return;
    }
    studio.compactUnfocusedFailures();
    selected.value = { kind: "node", node };
    studio.emphasize(undefined, id);
    draft.value = undefined;
  }

  function selectRoute(id: string) {
    const loaded = studio.loaded.value;
    const route = loaded?.graph.routes.find((candidate) => candidate.id === id);
    if (!loaded || !route) {
      return;
    }
    const owner = loaded.ownership.routes[route.order];
    studio.compactUnfocusedFailures(route.id);
    studio.revealCompactedRoute(route.id);
    selected.value = { kind: "route", route };
    studio.emphasize(route.id);
    draft.value = owner?.editable
      ? {
          kind: "update",
          originalOrder: route.order,
          groupOrder: outgoingOrder(loaded.graph.routes, route),
          from: route.source,
          to: route.target,
          label: route.label,
          outcome: route.outcome ?? null,
          when: owner.predicate ?? "",
        }
      : undefined;
  }

  /** Keeps the selection on the same authored route or node across source reloads. */
  function reconcileSelection({ graph, topologyUnchanged, previousOwnership }: Publication) {
    const current = selected.value;
    const ownership = studio.loaded.value?.ownership;
    if (current.kind === "route") {
      const prior = current.route;
      const priorPredicate = previousOwnership?.routes[prior.order]?.predicate ?? null;
      const matches = graph.routes.filter((candidate) =>
        topologyUnchanged
          ? candidate.id === prior.id
          : candidate.source === prior.source &&
            candidate.target === prior.target &&
            candidate.label === prior.label &&
            candidate.outcome === prior.outcome &&
            candidate.conditional === prior.conditional &&
            (ownership?.routes[candidate.order]?.predicate ?? null) === priorPredicate,
      );
      const [route] = matches;
      if (route && matches.length === 1) {
        selected.value = { kind: "route", route };
        if (!topologyUnchanged && draft.value?.kind === "update") {
          draft.value = {
            ...draft.value,
            originalOrder: route.order,
            groupOrder: outgoingOrder(graph.routes, route),
          };
        }
      } else {
        selected.value = { kind: "pipeline" };
        draft.value = undefined;
      }
    } else if (current.kind === "node") {
      const node = graph.nodes.find((candidate) => candidate.id === current.node.id);
      if (node) {
        selected.value = { kind: "node", node };
      } else {
        selected.value = { kind: "pipeline" };
        draft.value = undefined;
      }
    }
    restoreEmphasis();
  }
  studio.onPublished(reconcileSelection);

  function resetInsertionOrder() {
    if (draft.value?.kind === "insert") {
      draft.value.order = insertionOptions(draft.value.from, draft.value.outcome).findIndex(
        Boolean,
      );
    }
  }
  function changeDraftSource() {
    if (!draft.value) {
      return;
    }
    draft.value.outcome = needsOutcome(draft.value.from)
      ? (draft.value.outcome ?? "success")
      : null;
    resetInsertionOrder();
  }

  function connect(connection: Connection) {
    const loaded = studio.loaded.value;
    if (!loaded) {
      return;
    }
    const source = connection.source;
    const outcome = needsOutcome(source)
      ? (portOutcome(source, connection.sourceHandle) ?? "success")
      : null;
    const options = insertionOptions(source, outcome);
    if (!options.some(Boolean)) {
      studio.diagnostic.value =
        "Route creation is read-only because no unambiguous source boundary is available.";
      return;
    }
    const port = studio.nodes.value
      .find((candidate) => candidate.id === source)
      ?.data.ports.find((candidate) => candidate.id === connection.sourceHandle);
    const after = loaded.graph.routes.find((route) => route.id === port?.routeId);
    const afterOrder =
      after && after.outcome === (outcome ?? undefined)
        ? outgoingOrder(loaded.graph.routes, after) + 1
        : -1;
    draft.value = {
      kind: "insert",
      order: options[afterOrder] ? afterOrder : options.findIndex(Boolean),
      from: source,
      to: connection.target,
      label: "",
      outcome,
      when: "",
    };
    selected.value = { kind: "new-route" };
  }

  function reconnect(routeId: string, connection: Connection) {
    const loaded = studio.loaded.value;
    const route = loaded?.graph.routes.find((candidate) => candidate.id === routeId);
    const owner = route ? loaded?.ownership.routes[route.order] : undefined;
    if (!loaded || !route || !owner?.editable) {
      studio.diagnostic.value = owner?.reason ?? "This route is read-only.";
      return;
    }
    draft.value = {
      kind: "update",
      originalOrder: route.order,
      groupOrder: outgoingOrder(loaded.graph.routes, route),
      from: connection.source,
      to: connection.target,
      label: route.label,
      outcome: needsOutcome(connection.source)
        ? (portOutcome(connection.source, connection.sourceHandle) ?? route.outcome ?? "success")
        : null,
      when: owner.predicate ?? "",
    };
  }

  async function postEdit(edit: RouteEdit) {
    const loaded = studio.loaded.value;
    if (!loaded) {
      return;
    }
    saving.value = true;
    studio.diagnostic.value = "";
    try {
      const result = await $fetch("/api/routes", {
        method: "POST",
        body: { edit, editRevision: loaded.editRevision },
      });
      if (!result.ok) {
        studio.diagnostic.value = result.error;
        return;
      }
      draft.value = undefined;
      await studio.reload(true);
    } catch (error) {
      studio.diagnostic.value = error instanceof Error ? error.message : String(error);
    } finally {
      saving.value = false;
    }
  }
  async function submit() {
    const edit = draft.value;
    if (edit?.kind === "insert") {
      await postEdit({
        kind: "insert",
        order: edit.order,
        from: edit.from,
        to: edit.to,
        label: edit.label,
        ...(edit.outcome ? { outcome: edit.outcome } : {}),
        ...(edit.when ? { when: edit.when } : {}),
      });
    } else if (edit?.kind === "update") {
      await postEdit({
        kind: "update",
        order: edit.originalOrder,
        from: edit.from,
        to: edit.to,
        label: edit.label,
        outcome: edit.outcome,
        when: edit.when || null,
      });
    }
  }
  async function remove() {
    if (draft.value?.kind === "update") {
      await postEdit({ kind: "delete", order: draft.value.originalOrder });
    }
  }
  async function move(delta: number) {
    if (draft.value?.kind === "update") {
      await postEdit({
        kind: "move",
        order: draft.value.originalOrder,
        toOrder: draft.value.groupOrder + delta,
      });
    }
  }

  const implementation = {
    selected,
    draft,
    saving,
    needsOutcome,
    selectNode,
    selectRoute,
    restoreEmphasis,
    connect,
    reconnect,
    changeDraftSource,
    resetInsertionOrder,
    submit,
    remove,
    move,
  };
  implementation satisfies RouteEditor;
  return implementation;
}
