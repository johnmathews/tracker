<script setup lang="ts">
import { reactive, ref } from 'vue'
import { Checkbox } from '@/components/ui/checkbox'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'

const unticked = ref(false)
const ticked = ref(true)
/** The exception week's rest list: the legs rest (ExceptionWeekEditor, K191). */
const rest = reactive([
  { name: 'Every activity', on: false },
  { name: 'Back squat', on: true },
  { name: 'Bench press', on: false },
  { name: 'Barbell row', on: false },
  { name: 'Deadlift', on: true },
  { name: 'Plank', on: false },
])
</script>

<!-- The card's states (components/Checkbox/preview.html). -->
<template>
  <ExampleGroup>
    <StateExample state="Unticked">
      <Checkbox id="sg-checkbox-unticked" v-model="unticked" label="Back squat" />
    </StateExample>
    <StateExample state="Ticked">
      <Checkbox id="sg-checkbox-ticked" v-model="ticked" label="Deadlift" />
    </StateExample>
    <StateExample state="Disabled">
      <Checkbox id="sg-checkbox-disabled" :model-value="false" label="Plank" disabled />
    </StateExample>
    <StateExample state="Disabled, ticked: something else ticks it">
      <Checkbox id="sg-checkbox-disabled-ticked" :model-value="true" label="Plank" disabled />
    </StateExample>
    <StateExample state="In a list: an exception week rests the legs (ExceptionWeekEditor)">
      <div
        id="sg-checkbox-list"
        role="group"
        aria-labelledby="sg-checkbox-list-title"
        class="flex w-full max-w-105 flex-col gap-3 rounded-md bg-tile p-4"
      >
        <span id="sg-checkbox-list-title" class="label text-ink">Rest these activities</span>
        <ul class="flex flex-col">
          <li v-for="row in rest" :key="row.name" class="border-control-border not-first:border-t">
            <Checkbox v-model="row.on" :label="row.name" class="w-full" />
          </li>
        </ul>
        <p class="caption text-ink-secondary">A rested activity has no sessions in these weeks.</p>
      </div>
    </StateExample>
  </ExampleGroup>
</template>
