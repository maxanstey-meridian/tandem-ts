<script setup lang="ts">
import { computed } from "vue";
import { groupKey, outgoingOrder, sourceLocation } from "../logic/routes";
import { injectRouteEditor } from "../ports/routeEditor";
import { injectStudioGraph } from "../ports/studioGraph";
import PredicateEditor from "./PredicateEditor.vue";

const { loaded } = injectStudioGraph();
const {
  draft,
  selected,
  saving,
  needsOutcome,
  changeDraftSource,
  resetInsertionOrder,
  submit,
  remove,
  move,
} = injectRouteEditor();

const selectedRoute = computed(() =>
  selected.value.kind === "route" ? selected.value.route : undefined,
);
const selectedOwner = computed(() =>
  selectedRoute.value ? loaded.value?.ownership.routes[selectedRoute.value.order] : undefined,
);
const insertionOptions = computed(() =>
  draft.value
    ? (loaded.value?.editing.insertions[groupKey(draft.value.from, draft.value.outcome)] ?? [])
    : [],
);
const moves = computed(() =>
  draft.value?.kind === "update"
    ? (loaded.value?.editing.moves[draft.value.originalOrder] ?? [])
    : [],
);
</script>
<template>
  <template v-if="draft">
    <h2>{{ draft.kind === "insert" ? "Create route" : "Edit route" }}</h2>
    <div v-if="draft.kind === 'update' && selectedRoute && loaded" class="route-facts">
      <p>
        Source: <strong>{{ selectedRoute.source }}</strong> · Target:
        <strong>{{ selectedRoute.target }}</strong>
      </p>
      <p>
        Grouped priority: {{ outgoingOrder(loaded.graph.routes, selectedRoute) + 1 }} · Outcome:
        {{ selectedRoute.outcome ?? "ordinary" }} · Conditional:
        {{ selectedRoute.conditional ? "yes" : "no" }}
      </p>
      <p>
        Exact predicate source:
        <code>{{ selectedOwner?.predicate ?? "none" }}</code>
      </p>
      <p>Editability: editable · Full source location: {{ sourceLocation(selectedOwner) }}</p>
    </div>
    <label
      >From<select v-model="draft.from" @change="changeDraftSource">
        <option
          v-for="node in loaded?.graph.nodes"
          :key="node.id"
          :disabled="['completion', 'failure'].includes(node.kind)"
          :value="node.id"
        >
          {{ node.id }} · {{ node.kind }}
        </option>
      </select></label
    ><label
      >To<select v-model="draft.to">
        <option v-for="node in loaded?.graph.nodes" :key="node.id" :value="node.id">
          {{ node.id }} · {{ node.kind }}
        </option>
      </select></label
    >
    <fieldset v-if="needsOutcome(draft.from)">
      <legend>What happened?</legend>
      <label
        ><input
          v-model="draft.outcome"
          type="radio"
          value="success"
          @change="resetInsertionOrder"
        />Succeeded</label
      ><label
        ><input
          v-model="draft.outcome"
          type="radio"
          value="failed"
          @change="resetInsertionOrder"
        />Failed</label
      >
    </fieldset>
    <label
      >Meaning<input v-model="draft.label" placeholder="Describe this possible next step" /></label
    ><label
      >Optional state condition<PredicateEditor v-model="draft.when" /><small
        >Ordinary TypeScript, e.g. (state) =&gt; state.review?.decision === "Accept"</small
      ></label
    ><label v-if="draft.kind === 'insert'"
      >Route order<select v-model.number="draft.order">
        <option
          v-for="(allowed, boundary) in insertionOptions"
          v-show="allowed"
          :key="boundary"
          :value="boundary"
        >
          {{ boundary + 1 }}
        </option>
      </select></label
    >
    <p v-else>Outgoing route priority: {{ draft.groupOrder + 1 }}</p>
    <div class="actions">
      <button :disabled="saving" @click="submit">Validate and save code</button
      ><button v-if="draft.kind === 'update'" :disabled="saving" @click="remove">Delete</button
      ><button
        v-if="draft.kind === 'update' && draft.groupOrder > 0 && moves[draft.groupOrder - 1]"
        :disabled="saving"
        @click="move(-1)"
      >
        Earlier</button
      ><button
        v-if="draft.kind === 'update' && moves[draft.groupOrder + 1]"
        :disabled="saving"
        @click="move(1)"
      >
        Later
      </button>
    </div>
    <p>
      <small
        >Changes are formatted, typechecked, reconstructed, and shown only after validation
        succeeds.</small
      >
    </p>
  </template>
</template>
