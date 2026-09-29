<script setup lang="ts">
import type { InspectedNode } from "@maxanstey-meridian/tandem";
import type { SourceOwnership } from "../../src/ownership";
import { kindLabels } from "../../src/semantic-graph";
import type { SourceTarget } from "../../src/source-open";
import { sourceLocation } from "../logic/routes";

const props = defineProps<{
  node: InspectedNode;
  start: boolean;
  pipelinePersist: boolean | undefined;
  participants: SourceOwnership["participants"];
}>();
defineEmits<{ open: [target: SourceTarget] }>();

const roles: Readonly<Record<InspectedNode["kind"], string>> = {
  stage: "Transforms pipeline state",
  interaction: "Pauses for an external response",
  agent: "Uses a model with granted capabilities",
  parallel: "Runs owned branches and merges their state",
  collection: "Runs a participant for each item in a collection",
  completion: "Successful pipeline output",
  failure: "Failed pipeline output",
};
function persistence() {
  if (props.node.persist === true) {
    return "explicitly enabled for this participant";
  }
  if (props.node.persist === false) {
    return "explicitly disabled for this participant";
  }
  return props.pipelinePersist
    ? "inherited from pipeline: enabled"
    : "inherited from pipeline: disabled";
}
</script>
<template>
  <h2>{{ node.id }}</h2>
  <p class="role">{{ roles[node.kind] }}</p>
  <p v-if="start"><strong>Execution begins here.</strong></p>
  <p>Persistence: {{ persistence() }}</p>
  <template v-if="node.agent"
    ><h3>Agent capabilities</h3>
    <ul>
      <li v-for="capability in node.agent.capabilities" :key="capability.name">
        <strong>{{ capability.name }}</strong>
        <pre>{{ JSON.stringify(capability.requestSchema, null, 2) }}</pre>
      </li>
    </ul>
    <template v-if="node.agent.outputSchema">
      <h3>Structured output shape</h3>
      <pre>{{ JSON.stringify(node.agent.outputSchema, null, 2) }}</pre>
    </template>
    <p v-else>Structured output: none</p>
    <p>Workspace tools: {{ node.agent.workspace ? "enabled" : "none" }}</p></template
  ><template v-if="node.interaction"
    ><h3>Interaction request shape</h3>
    <pre>{{ JSON.stringify(node.interaction.requestSchema, null, 2) }}</pre>
    <h3>Response shape</h3>
    <pre>{{ JSON.stringify(node.interaction.responseSchema, null, 2) }}</pre></template
  ><template v-if="node.branches"
    ><h3>Parallel branches</h3>
    <ul>
      <li v-for="branch in node.branches" :key="branch.id">
        {{ branch.id }} → {{ branch.participant.id }} ({{ kindLabels[branch.participant.kind] }})
        <button
          v-if="participants[branch.participant.id]?.file"
          @click="$emit('open', { kind: 'participant', id: branch.participant.id })"
        >
          Open declaration
        </button>
        <ul v-if="participants[branch.participant.id]?.callbacks">
          <li
            v-for="(callback, name) in participants[branch.participant.id]?.callbacks"
            :key="name"
          >
            {{ name }} — {{ sourceLocation(callback) }}
            <button @click="$emit('open', { kind: 'callback', id: branch.participant.id, name })">
              Open callback
            </button>
          </li>
        </ul>
      </li>
    </ul></template
  >
  <p>
    <small>{{ sourceLocation(participants[node.id]) }}</small>
    <button
      v-if="participants[node.id]?.file"
      @click="$emit('open', { kind: 'participant', id: node.id })"
    >
      Open declaration
    </button>
  </p>
  <template v-if="participants[node.id]?.callbacks">
    <h3>Callback source</h3>
    <ul>
      <li v-for="(callback, name) in participants[node.id]?.callbacks" :key="name">
        {{ name }} — {{ sourceLocation(callback) }}
        <button @click="$emit('open', { kind: 'callback', id: node.id, name })">Open</button>
      </li>
    </ul>
  </template>
</template>
<style scoped>
.role {
  font-size: 16px;
}
</style>
