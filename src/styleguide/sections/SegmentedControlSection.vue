<script setup lang="ts">
import { ref } from 'vue'
import { SegmentedControl } from '@/components/ui/segmented-control'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'

const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]
// The app's per-side wording, the Dialog card's (PerSideToggle.vue).
const REPS_COUNT = [
  { value: 'per-set', label: 'Per set' },
  { value: 'each-side', label: 'Each side' },
]

const theme = ref('system')
const themeFocus = ref('light')
const repsCount = ref('each-side')
</script>

<!-- The card's states (components/SegmentedControl/preview.html). The ids sit on the control's
     wrapper; Tab enters the group on the chosen segment, and the arrow keys move between them. -->
<template>
  <ExampleGroup layout="grid">
    <StateExample state="Default: System chosen">
      <SegmentedControl
        id="sg-segmented-control-theme-default"
        v-model="theme"
        label="Theme"
        :options="THEMES"
      />
    </StateExample>
    <StateExample state="Focus (Tab to it)">
      <SegmentedControl
        id="sg-segmented-control-theme-focus"
        v-model="themeFocus"
        label="Theme"
        :options="THEMES"
      />
    </StateExample>
    <StateExample state="Two choices: how reps are counted">
      <SegmentedControl
        id="sg-segmented-control-reps-default"
        v-model="repsCount"
        label="Sides"
        :options="REPS_COUNT"
      />
    </StateExample>
    <StateExample state="Disabled">
      <SegmentedControl
        id="sg-segmented-control-reps-disabled"
        model-value="per-set"
        label="Sides"
        :options="REPS_COUNT"
        disabled
      />
    </StateExample>
  </ExampleGroup>
</template>
