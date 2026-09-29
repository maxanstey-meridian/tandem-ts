<script setup lang="ts">
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { VueFlow } from "@vue-flow/core";
import { MiniMap } from "@vue-flow/minimap";
import NodeDetails from "../components/NodeDetails.vue";
import PipelineDetails from "../components/PipelineDetails.vue";
import RouteDetails from "../components/RouteDetails.vue";
import RouteDraftPanel from "../components/RouteDraftPanel.vue";
import SemanticEdge from "../components/SemanticEdge.vue";
import SemanticNode from "../components/SemanticNode.vue";
import { useRouteEditor } from "../composables/useRouteEditor";
import { useStudioGraph } from "../composables/useStudioGraph";
import { outgoingOrder } from "../logic/routes";
import { provideRouteEditor } from "../ports/routeEditor";
import { provideStudioGraph } from "../ports/studioGraph";

const studio = provideStudioGraph(useStudioGraph());
const editor = provideRouteEditor(useRouteEditor());
const { loaded, mode, dominantJourneyStatus, nodes, edges, diagnostic } = studio;
const { selected, draft } = editor;
</script>
<template>
  <main>
    <header>
      <div>
        <h1>Tandem Studio</h1>
        <p>
          Code is authoritative. Routes are attempted in displayed order; Studio never executes the
          pipeline.
        </p>
      </div>
      <div class="toolbar">
        <div class="mode-switch" role="group" aria-label="Graph presentation">
          <button :aria-pressed="mode === 'lifecycle'" @click="studio.setMode('lifecycle')">
            Lifecycle</button
          ><button :aria-pressed="mode === 'all'" @click="studio.setMode('all')">All routes</button>
        </div>
        <button @click="studio.reload(true)">Reload</button
        ><button :disabled="!loaded" @click="studio.relayout">Re-layout</button>
      </div>
    </header>
    <p v-if="diagnostic" class="diagnostic">
      <strong v-if="loaded">Last valid graph retained.</strong>
      <strong v-else>Studio could not load a pipeline.</strong> {{ diagnostic }}
    </p>
    <p
      v-if="mode === 'lifecycle' && dominantJourneyStatus === 'best-effort'"
      class="journey-notice"
    >
      No successful completion is reachable without a failure path. The highlighted journey is
      best-effort progression only.
    </p>
    <section>
      <VueFlow
        v-model:nodes="nodes"
        v-model:edges="edges"
        fit-view-on-init
        :delete-key-code="null"
        @node-drag-stop="studio.manualPositioningFinished"
        @node-click="(event) => editor.selectNode(event.node.id)"
        @node-mouse-enter="(event) => studio.focusNode(event.node.id)"
        @node-mouse-leave="editor.restoreEmphasis"
        @edge-click="(event) => editor.selectRoute(event.edge.id)"
        @edge-mouse-enter="(event) => studio.focusRoute(event.edge.id)"
        @edge-mouse-leave="editor.restoreEmphasis"
        @connect="editor.connect"
        @edge-update="(event) => editor.reconnect(event.edge.id, event.connection)"
        ><template #node-semantic="slotProps"
          ><SemanticNode
            v-bind="slotProps"
            @select-route="editor.selectRoute"
            @hover-route="studio.focusRoute"
            @leave-route="editor.restoreEmphasis" /></template
        ><template #edge-semantic="slotProps"><SemanticEdge v-bind="slotProps" /></template>
        <Background /><MiniMap /><Controls
      /></VueFlow>
      <aside>
        <RouteDraftPanel v-if="draft" />
        <template v-else-if="loaded">
          <NodeDetails
            v-if="selected.kind === 'node'"
            :node="selected.node"
            :start="selected.node.id === loaded.graph.start"
            :pipeline-persist="loaded.graph.persist"
            :participants="loaded.ownership.participants"
            @open="studio.openSource"
          />
          <RouteDetails
            v-else-if="selected.kind === 'route'"
            :route="selected.route"
            :group-order="outgoingOrder(loaded.graph.routes, selected.route)"
            :owner="loaded.ownership.routes[selected.route.order]"
            @open="studio.openSource"
          />
          <PipelineDetails
            v-else
            :graph="loaded.graph"
            :state="loaded.ownership.state"
            @open="studio.openSource"
          />
        </template>
      </aside>
    </section>
  </main>
</template>
<style scoped>
main {
  height: 100vh;
  font: 14px system-ui;
  color: #172033;
  background: #f6f8fb;
}
header {
  height: 88px;
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 0 20px;
  border-bottom: 1px solid #d9deea;
}
header div {
  flex: 1;
}
h1,
p {
  margin: 3px 0;
}
button,
input,
select {
  padding: 8px;
}
section {
  display: grid;
  grid-template-columns: 1fr 340px;
  height: calc(100vh - 89px);
}
aside {
  overflow: auto;
  padding: 18px;
  border-left: 1px solid #d9deea;
  background: white;
}
aside :deep(p) {
  margin: 3px 0;
}
aside :deep(button),
aside :deep(input),
aside :deep(select) {
  padding: 8px;
}
aside :deep(pre) {
  white-space: pre-wrap;
  font-size: 12px;
}
.diagnostic {
  padding: 10px;
  background: #fff0f0;
  color: #8b1721;
}
.vue-flow {
  background: #eef2f8;
}
aside :deep(label) {
  display: grid;
  gap: 5px;
  margin: 12px 0;
}
aside :deep(fieldset label) {
  display: inline-flex;
  margin-right: 14px;
}
aside :deep(.actions) {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
}
.toolbar,
.mode-switch {
  display: flex;
  align-items: center;
  gap: 7px;
}
.mode-switch button[aria-pressed="true"] {
  background: #26334c;
  color: white;
}
:deep(.semantic-card) {
  position: relative;
  box-sizing: border-box;
  padding: 12px;
  border: 1px solid #aeb8c9;
  border-left: 5px solid #73809b;
  border-radius: 8px;
  background: white;
  text-align: left;
  box-shadow: 0 2px 7px #26334c18;
}
:deep(.semantic-card header) {
  height: 30px;
  padding: 0;
  border: 0;
  display: grid;
  gap: 2px;
}
:deep(.semantic-card header small),
:deep(.authored-id),
:deep(.route-row small) {
  color: #526078;
  font-size: 11px;
}
:deep(.authored-id) {
  display: block;
  height: 14px;
}
:deep(.start) {
  display: block;
  height: 16px;
  margin: 0;
}
:deep(.outcome-heading) {
  display: flex;
  align-items: center;
  height: 18px;
}
:deep(.route-row) {
  position: relative;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  margin: 0 -6px;
  padding: 0 12px 0 6px;
  border-top: 1px solid #e3e7ee;
  cursor: pointer;
}
:deep(.route-row small) {
  margin-left: auto;
}
:deep(.creation-row) {
  position: relative;
  box-sizing: border-box;
  height: 20px;
}
:deep(.route-row.compacted) {
  opacity: 0.72;
  border-left: 3px double #a73541;
}
:deep(.route-correction) {
  stroke-dasharray: 7 5;
}
:deep(.route-failure) {
  stroke-dasharray: 2 5;
}
:deep(.vue-flow__edge-path.route-primary),
:deep(.vue-flow__edge-path.route-terminal) {
  stroke-width: 3;
  stroke: #385d4d;
}
:deep(.vue-flow__edge-path.route-correction) {
  stroke: #735b2e;
  stroke-width: 2;
}
:deep(.vue-flow__edge-path.route-failure) {
  stroke: #9e3540;
}
:deep(.unrelated) {
  opacity: 0.22;
}
:deep(.focused-edge-label) {
  position: absolute;
  max-width: 180px;
  padding: 4px 7px;
  border: 1px solid #aeb8c9;
  border-radius: 4px;
  background: white;
  pointer-events: none;
}
:deep(.semantic-card .vue-flow__handle) {
  width: 8px;
  height: 8px;
}
.start {
  display: inline-block;
  margin-top: 4px;
  font-size: 11px;
  font-weight: 700;
}
.semantic-agent {
  border-color: #6255c7;
}
.semantic-interaction {
  border-color: #b88919;
}
.semantic-parallel {
  border-color: #27845b;
}
.semantic-completion {
  border-color: #21833d;
  background: #e6faeb;
}
.semantic-failure {
  border-color: #bd3441;
  background: #ffeaea;
}
.kind-agent {
  background: #eef0ff;
}
.kind-interaction {
  background: #fff8dd;
}
.kind-parallel {
  background: #eefbf4;
}
.kind-completion {
  background: #e6faeb;
}
.kind-failure {
  background: #ffeaea;
}
@media (max-width: 720px) {
  main {
    height: auto;
    min-height: 100vh;
  }
  header {
    height: auto;
    min-height: 88px;
    padding: 10px;
    flex-wrap: wrap;
  }
  header p {
    display: none;
  }
  section {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(55vh, 1fr) auto;
    height: auto;
    min-height: calc(100vh - 100px);
  }
  .vue-flow {
    min-height: 55vh;
  }
  aside {
    max-height: 45vh;
    border-left: 0;
    border-top: 1px solid #d9deea;
  }
}
</style>
