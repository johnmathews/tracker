<script setup lang="ts">
import { computed, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { usePlannerStore } from '@/stores/planner'
import { useDietStore } from '@/stores/diet'
import { useDetailsStore } from '@/stores/details'
import ItemPage from '@/components/ItemPage.vue'
import { SegmentedControl } from '@/components/ui/segmented-control'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'

// The style guide has no store of its own: these pages read a store set up here, with the card's
// items (components/ItemPage/preview.html). Today is Wednesday 28 October; nothing is saved.
setActivePinia(createPinia())
const planner = usePlannerStore()
const diet = useDietStore()
const details = useDetailsStore()
planner.now = new Date(2026, 9, 28, 12)
const G = 'great'
const P = 'partial'
const X = 'missed'
const _ = null
const KS = { id: 'ks', name: 'Kettlebell swings', sets: 3, reps: 15, weight: 16, perSide: false }
const PU = { id: 'pu', name: 'Push-ups', sets: 3, reps: 12, perSide: false, target: 4 }
planner.plans = {
  '2026-09-07': [{ ...KS, target: 3 }, PU],
  '2026-09-21': [PU],
  '2026-09-28': [
    { ...KS, target: 3 },
    PU,
    { id: 'tg', name: 'Turkish get-ups', reps: 3, perSide: true, target: 2 },
  ],
  '2026-10-12': [{ ...KS, target: 3 }, PU],
}
planner.log = {
  '2026-10-26': { ks: [G, _, G, _, _, _, _] },
  '2026-10-19': { ks: [G, _, P, _, G, _, _] },
  '2026-10-12': { ks: [_, G, _, _, G, _, G] },
  '2026-10-05': { ks: [G, _, _, X, _, _, _] },
  '2026-09-28': { ks: [_, G, _, G, _, G, _], tg: [G, _, _, G, _, _, _] },
  '2026-09-14': { ks: [G, _, G, _, _, G, _] },
  '2026-09-07': { ks: [_, P, _, _, G, _, _] },
}
diet.plans = {
  '2026-10-12': [
    { id: 'nuts', name: 'Nuts', target: 5 },
    { id: 'fish', name: 'Fish', target: 2 },
  ],
}
diet.log = {
  '2026-10-26': { nuts: [G, G, _, _, _, _, _] },
  '2026-10-19': { nuts: [G, G, G, G, G, _, _] },
}
details.adopt({
  exercise: {
    ks: {
      notes:
        '**Hinge, don’t squat.** The hips drive the bell. The arms only guide it.\n\n- Brace before each swing\n- The bell stops at chest height, no higher\n- Breathe out hard at the top\n\nMove to 20 kg once all three sets feel easy. [Form video](https://youtube.com/watch?v=swing-form)',
      fields: {
        equipment: '16 kg kettlebell',
        works: 'Glutes, hamstrings, grip',
        link: 'https://youtube.com/watch?v=swing-form',
      },
    },
  },
  diet: { nuts: { fields: { serving: 'A small handful' } } },
})

const PAGES = [
  {
    id: 'sg-item-page-exercise-default',
    label: 'Exercise',
    state: 'An exercise with notes, opened from this week',
    section: 'exercise',
    item: 'ks',
  },
  {
    id: 'sg-item-page-food-no-notes',
    label: 'Food',
    state: 'A food with no notes',
    section: 'diet',
    item: 'nuts',
  },
  {
    id: 'sg-item-page-exercise-not-in-week',
    label: 'Not in the week',
    state: 'Not in this week’s plan: the latest plan, read-only',
    section: 'exercise',
    item: 'tg',
  },
] as const
const OPTIONS = PAGES.map((p) => ({ value: p.id, label: p.label }))
// One page at a time: each repeats the same section names, which two pages on one screen would
// make ambiguous landmarks (axe's landmark-unique).
const showing = ref<string>(PAGES[0].id)
const page = computed(() => PAGES.find((p) => p.id === showing.value)!)
</script>

<!-- The app's own ItemPage, in a frame on the page's margins, for each state the card shows, one at
     a time. Notes, details, the plan and Arrange sections (K66) work, in this page's store only. -->
<template>
  <ExampleGroup>
    <SegmentedControl v-model="showing" label="Example" :options="OPTIONS" />
    <StateExample :state="page.state" class="w-full">
      <div :id="page.id" class="w-full rounded-lg border border-line px-(--screen-pad-x)">
        <ItemPage :key="page.id" :section="page.section" :item-id="page.item" example />
      </div>
    </StateExample>
  </ExampleGroup>
</template>
