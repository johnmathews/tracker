<script setup lang="ts">
import { Chip } from '@/components/ui/chip'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'

/** Every form the detail takes (Chip card), with its fields. */
const FORMS = [
  { state: 'Sets and reps', text: '3 × 12', id: 'sets-reps' },
  { state: 'Sets and reps, each side', text: '3 × 8 each side', id: 'sets-reps-side' },
  { state: 'Reps only', text: '10 reps a set', id: 'reps' },
  { state: 'Reps only, each side', text: '8 each side', id: 'reps-side' },
  { state: 'Sets only', text: '3 sets', id: 'sets' },
  { state: 'Sets and time', text: '3 × 45 s', id: 'sets-time' },
  { state: 'Time only, each side', text: '1 min 30 s each side', id: 'time-side' },
  { state: 'Weight', text: '16 kg', id: 'weight' },
]
</script>

<!-- The card's forms (components/Chip/preview.html), then chips under a name as WeekGrid sets them,
     then the one state a chip names: "Shared", after a library programme's name (K171). -->
<template>
  <div class="flex flex-col gap-8">
    <ExampleGroup title="Every form the detail takes">
      <StateExample v-for="f in FORMS" :key="f.id" :state="f.state">
        <Chip :id="`sg-chip-${f.id}`">{{ f.text }}</Chip>
      </StateExample>
    </ExampleGroup>
    <ExampleGroup title="Under a name">
      <ul class="w-full max-w-90 border-t border-line">
        <li class="border-b border-line py-2">
          <span class="body block font-semibold">Squats</span>
          <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Chip>3 × 15</Chip><Chip>16 kg</Chip>
          </span>
        </li>
        <li class="border-b border-line py-2">
          <span class="body block font-semibold">Plank</span>
          <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Chip>3 sets</Chip>
          </span>
        </li>
        <li class="border-b border-line py-2">
          <span class="body block font-semibold">Back extensions</span>
        </li>
      </ul>
    </ExampleGroup>
    <ExampleGroup title="A state, after a name (the admin's Library)">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span class="body font-semibold">Strength 5×5</span>
        <Chip id="sg-chip-shared">Shared</Chip>
      </div>
    </ExampleGroup>
  </div>
</template>
