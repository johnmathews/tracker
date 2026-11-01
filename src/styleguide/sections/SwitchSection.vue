<script setup lang="ts">
import { ref } from 'vue'
import { Switch } from '@/components/ui/switch'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'

const off = ref(false)
const on = ref(true)
const shown = ref(true)
</script>

<!-- The card's states (components/Switch/preview.html). Below 640px the visible label shortens
     to "Edit"; the accessible name stays "Edit plan". -->
<template>
  <ExampleGroup>
    <StateExample state="Off">
      <Switch id="sg-switch-edit-plan-off" v-model="off" label="Edit plan" short-label="Edit" />
    </StateExample>
    <StateExample state="On">
      <Switch id="sg-switch-edit-plan-on" v-model="on" label="Edit plan" short-label="Edit" />
    </StateExample>
    <StateExample state="In a list: reads “Show Notes” (the item page, K66)">
      <Switch id="sg-switch-show-notes" v-model="shown" label="Show" context="Notes" />
    </StateExample>
    <StateExample state="Disabled">
      <Switch
        id="sg-switch-edit-plan-disabled"
        :model-value="false"
        label="Edit plan"
        short-label="Edit"
        disabled
      />
    </StateExample>
  </ExampleGroup>
</template>
