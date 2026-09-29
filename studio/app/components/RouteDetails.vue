<script setup lang="ts">
import type { InspectedRoute } from "@maxanstey-meridian/tandem";
import type { RouteOwnership } from "../../src/ownership";
import type { SourceTarget } from "../../src/source-open";
import { sourceLocation } from "../logic/routes";

defineProps<{
  route: InspectedRoute;
  groupOrder: number;
  owner: RouteOwnership | undefined;
}>();
defineEmits<{ open: [target: SourceTarget] }>();
</script>
<template>
  <h2>{{ route.label }}</h2>
  <p>
    After <strong>{{ route.source }}</strong
    >, continue to <strong>{{ route.target }}</strong
    >.
  </p>
  <p>
    Priority {{ groupOrder + 1 }} for this participant and outcome.
    {{
      route.conditional
        ? "Taken only when its TypeScript state predicate is true."
        : "Unconditional for this outcome."
    }}
  </p>
  <p>Participant outcome: {{ route.outcome ?? "ordinary" }}</p>
  <p>
    Exact predicate source:
    <code>{{ owner?.predicate ?? "none" }}</code>
  </p>
  <p>Editability: {{ owner?.editable ? "editable" : `read-only — ${owner?.reason}` }}</p>
  <p>Full source location: {{ sourceLocation(owner) }}</p>
  <button v-if="owner?.file" @click="$emit('open', { kind: 'route', order: route.order })">
    Open route source
  </button>
  <p v-if="!owner?.editable" class="readonly">
    Read-only: {{ owner?.reason }}<br /><small>{{ sourceLocation(owner) }}</small>
  </p>
</template>
<style scoped>
.readonly {
  padding: 10px;
  background: #fff0f0;
  color: #8b1721;
}
</style>
