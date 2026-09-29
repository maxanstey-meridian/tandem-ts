<script setup lang="ts">
import type { PipelineInspection } from "@maxanstey-meridian/tandem";
import type { SourceOwnership } from "../../src/ownership";
import type { SourceTarget } from "../../src/source-open";
import { sourceLocation } from "../logic/routes";

defineProps<{ graph: PipelineInspection; state: SourceOwnership["state"] }>();
defineEmits<{ open: [target: SourceTarget] }>();
</script>
<template>
  <h2>{{ graph.name }}</h2>
  <p>
    Execution begins at <strong>{{ graph.start }}</strong> and may finish at
    {{ graph.outputs.join(", ") }}.
  </p>
  <p>Pipeline persistence: {{ graph.persist ? "enabled" : "participant opt-in only" }}</p>
  <h3>State shape</h3>
  <pre>{{ JSON.stringify(graph.stateSchema, null, 2) }}</pre>
  <p>
    <small>{{ sourceLocation(state) }}</small>
    <button v-if="state?.file" @click="$emit('open', { kind: 'state' })">Open state schema</button>
    <span v-else-if="state?.reason"> {{ state.reason }}</span>
  </p>
</template>
