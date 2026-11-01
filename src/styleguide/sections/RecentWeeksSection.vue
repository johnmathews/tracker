<script setup lang="ts">
import type { RecentWeek } from '@/lib/history'
import type { Mark, MarkSet } from '@/lib/storage'
import RecentWeeks from '@/components/RecentWeeks.vue'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'

// The card's weeks (components/RecentWeeks/preview.html): eight weeks ending on 26 October, this
// week first, one of them not planned and one with a goal of 0.
const G = 'great'
const P = 'partial'
const X = 'missed'
const _ = null
function week(
  y: number,
  m: number,
  d: number,
  goal: number | null,
  marks: (Mark | null)[],
): RecentWeek {
  const monday = new Date(y, m, d)
  return { week: `${y}-${m + 1}-${d}`, monday, current: d === 26, marks, goal }
}
const WEEKS: RecentWeek[] = [
  week(2026, 9, 26, 3, [G, _, G, _, _, _, _]),
  week(2026, 9, 19, 3, [G, _, P, _, G, _, _]),
  week(2026, 9, 12, 3, [_, G, _, _, G, _, G]),
  week(2026, 9, 5, 3, [G, _, _, X, _, _, _]),
  week(2026, 8, 28, 3, [_, G, _, G, _, G, _]),
  week(2026, 8, 21, null, [_, _, _, _, _, _, _]),
  week(2026, 8, 14, 0, [G, _, G, _, _, _, _]),
  week(2026, 8, 7, 3, [_, P, _, _, G, _, _]),
]
const SETS: { set: MarkSet; state: string }[] = [
  { set: 'stamped-ticks', state: 'Eight weeks, in the Stamped ticks set' },
  { set: 'squiggles', state: 'The same weeks in the squiggles' },
]
</script>

<!-- The card's weeks drawn by the app's own RecentWeeks, in two of the mark sets. -->
<template>
  <ExampleGroup>
    <StateExample v-for="{ set, state } in SETS" :key="set" :state="state" class="w-full">
      <div :id="`sg-recent-weeks-${set}`" class="flex w-full max-w-142 flex-col gap-3">
        <h3 :id="`sg-recent-weeks-${set}-title`" class="title-2">Recent weeks</h3>
        <RecentWeeks :weeks="WEEKS" :mark-set="set" :labelledby="`sg-recent-weeks-${set}-title`" />
      </div>
    </StateExample>
  </ExampleGroup>
</template>
