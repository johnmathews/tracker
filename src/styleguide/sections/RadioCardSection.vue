<script setup lang="ts">
import { ref } from 'vue'
import { DayMarkDrawing } from '@/components/ui/day-mark'
import { RadioCard } from '@/components/ui/radio-card'
import { MARK_KINDS, type MarkSet } from '@/lib/storage'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'

// The app's Marks setting (SettingsPage.vue), in its copy.
const MARKS = [
  { value: 'squiggles', label: 'Squiggles' },
  { value: 'ticks', label: 'Ticks' },
  { value: 'stamped-ticks', label: 'Stamped ticks' },
  { value: 'faces', label: 'Faces' },
  { value: 'stamped-faces', label: 'Stamped faces' },
]

// The connect screen's access (ConnectPage.vue), in its copy.
const ACCESS = [
  { value: 'read', label: 'Read only', hint: 'See your plans, marks and notes.' },
  { value: 'write', label: 'Read and change', hint: 'Also mark days, and add and edit items.' },
]

const chosen = ref('ticks')
const focus = ref('squiggles')
const access = ref('read')
</script>

<!-- The card's states (components/RadioCard/preview.html). Hover any unchosen row for the tile;
     Tab reaches the chosen row, and the arrow keys move between rows and choose them. -->
<template>
  <ExampleGroup>
    <StateExample state="Marks in Settings: Ticks chosen">
      <RadioCard id="sg-radio-card-marks" v-model="chosen" label="Marks" :options="MARKS">
        <template #picture="{ option }">
          <span v-for="kind in MARK_KINDS" :key="kind" class="grid size-16 place-items-center">
            <DayMarkDrawing :mark="kind" :set="option.value as MarkSet" />
          </span>
        </template>
      </RadioCard>
    </StateExample>
    <StateExample state="Without pictures; focus (Tab to it)">
      <RadioCard
        id="sg-radio-card-focus"
        v-model="focus"
        label="Marks"
        :options="MARKS.slice(0, 3)"
      />
    </StateExample>
    <StateExample state="With a line each: an app’s access on the connect screen">
      <RadioCard
        id="sg-radio-card-access"
        v-model="access"
        label="What Claude can do"
        :options="ACCESS"
        class="max-w-sm"
      />
    </StateExample>
  </ExampleGroup>
</template>
