<script setup lang="ts">
import { Handle, Position } from "@vue-flow/core";
import type { RoutePort } from "../../src/semantic-graph";
import { kindLabels } from "../../src/semantic-graph";
import type { SemanticNodeData } from "../ports/studioGraph";
const props = defineProps<{ data: SemanticNodeData }>();
const emit = defineEmits<{
  "select-route": [routeId: string];
  "hover-route": [routeId: string];
  "leave-route": [];
}>();
function handleSize() {
  return { width: `${props.data.portSize}px`, height: `${props.data.portSize}px` };
}
function portStyle(port: RoutePort) {
  return {
    ...handleSize(),
    top: `${port.centerY}px`,
    right: "-4px",
  };
}
</script>
<template>
  <article
    class="semantic-card"
    :class="`semantic-${data.kind}`"
    :style="{ width: `${data.width}px`, height: `${data.height}px` }"
  >
    <Handle
      :id="data.incomingPort"
      type="target"
      :position="Position.Left"
      :style="{
        ...handleSize(),
        left: `${data.incomingCenterX}px`,
        top: `${data.incomingCenterY}px`,
      }"
    />
    <header>
      <strong>{{ data.title }}</strong
      ><small>{{ kindLabels[data.kind] }}</small>
    </header>
    <small class="authored-id">{{ data.id }}</small>
    <span class="start">{{ data.start ? "Execution begins here" : "" }}</span>
    <div v-for="(ports, outcome) in data.portGroups" :key="String(outcome)" class="outcome-group">
      <small v-if="outcome !== 'default'" class="outcome-heading">{{
        outcome === "success" ? "Succeeded" : "Failed"
      }}</small>
      <div
        v-for="port in ports"
        :key="port.id"
        class="route-row"
        :class="[`route-${port.classification}`, { compacted: port.compacted }]"
        role="button"
        tabindex="0"
        @mouseenter="emit('hover-route', port.routeId)"
        @mouseleave="emit('leave-route')"
        @click.stop="emit('select-route', port.routeId)"
        @keydown.enter.stop="emit('select-route', port.routeId)"
      >
        <span v-if="port.conditional" class="conditional" title="Conditional route">◇</span>
        <span v-if="port.classification === 'correction'" aria-label="Correction route">↩</span>
        <span v-if="port.classification === 'failure'" aria-label="Failure route">!</span>
        <span>{{ port.label }}</span>
      </div>
    </div>
    <Handle
      v-for="port in data.ports"
      :id="port.id"
      :key="port.id"
      class="boundary-route-handle boundary-right-handle"
      type="source"
      :position="Position.Right"
      :style="portStyle(port)"
      role="button"
      tabindex="0"
      :aria-label="`Select route ${port.label}`"
      @click.stop="emit('select-route', port.routeId)"
      @keydown.enter.stop.prevent="emit('select-route', port.routeId)"
      @keydown.space.stop.prevent="emit('select-route', port.routeId)"
    />
    <div v-for="port in data.creationPorts" :key="port.id" class="creation-row">
      <small>Add {{ port.outcome ?? "route" }}</small
      ><Handle :id="port.id" type="source" :position="Position.Right" />
    </div>
  </article>
</template>
