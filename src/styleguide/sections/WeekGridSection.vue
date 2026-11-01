<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { Day } from '@/stores/planner'
import { DAY_NAMES, addDays, dateKey, fullDate } from '@/lib/dates'
import { EXERCISE_CYCLE, cycleDay, type Tracked } from '@/lib/tracker'
import type { Log, Mark } from '@/lib/storage'
import { Pencil } from '@lucide/vue'
import { BarAction } from '@/components/ui/bar-action'
import TrackerGrid from '@/components/TrackerGrid.vue'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'

// The card's week (components/WeekGrid/preview.html): Monday 19 October, today Thursday.
const MONDAY = new Date(2026, 9, 19)
const TODAY = 3
const WEEK = 'sg'

const days: Day[] = DAY_NAMES.map((name, i) => {
  const d = addDays(MONDAY, i)
  return {
    name,
    date: String(d.getDate()),
    full: fullDate(d),
    key: dateKey(d),
    isToday: i === TODAY,
    isFuture: i > TODAY,
  }
})

type Row = Tracked & { chips: string[] }
const rows = reactive<Row[]>([
  { id: 'pu', name: 'Push-ups', target: 4, chips: ['3 × 12'] },
  { id: 'pl', name: 'Pull-ups', target: 3, chips: ['3 × 5'] },
  { id: 'sq', name: 'Squats', target: 3, chips: ['3 × 15', '16 kg'] },
  { id: 'kh', name: 'Kettlebell halos', target: 2, chips: ['8 each side'] },
])
// Great, partial, missed and empty, in all three drawings, so every kind of mark shows.
const _ = null
const log = reactive<Log>({
  [WEEK]: {
    pu: ['great', _, 'partial-solid', 'great-hatch', _, _, _],
    pl: ['great-solid', _, _, 'missed', _, _, _],
    sq: [_, 'great-hatch', 'great', 'partial-hatch', _, _, _],
    kh: [_, 'missed-solid', _, 'great-solid', _, _, _],
  },
})
const week = computed(() => log[WEEK]!)
const editing = ref(false)

/** The grid's keys (WeekGrid card, Accessibility; src/composables/gridNav.ts). */
const KEYS: [string, string][] = [
  ['Tab', 'Lands once on the grid: today’s first mark, or the last cell used. Tab again leaves.'],
  ['Arrows', 'Move cell by cell: names, days and totals. Never wrap.'],
  ['Home, End', 'First and last cell in the row.'],
  ['Ctrl+Home, Ctrl+End', 'First and last cell of the grid.'],
  ['Space, Enter', 'Step a day’s mark: great, partial, missed in each drawing, then empty.'],
  ['Enter on a name', 'Opens the item’s own page, in one press.'],
  ['F2, Escape', 'On a name: into its note and, in Edit plan, its Edit button; Escape back.'],
]

function marksFor(id: string): (Mark | null)[] {
  return week.value[id] ?? []
}
function remove(id: string): void {
  rows.splice(
    rows.findIndex((r) => r.id === id),
    1,
  )
}
</script>

<!-- The card's grid, drawn by the app's own TrackerGrid, and Edit plan as the Header's toggle (K48). A press steps a mark; nothing is saved. -->
<template>
  <ExampleGroup>
    <StateExample state="On screen. Today is Thursday." class="w-full">
      <BarAction label="Edit plan" :pressed="editing" @click="editing = !editing"
        ><Pencil
      /></BarAction>
      <div id="sg-week-grid-screen" class="w-full">
        <TrackerGrid
          section="exercise"
          label="Exercise"
          table-label="Exercises, week of 19 October"
          :items="rows"
          :days="days"
          :marks-for="marksFor"
          :details-for="(item) => (item as Row).chips"
          editable
          :config-mode="editing"
          @toggle="(id, day) => cycleDay(log, WEEK, id, day, EXERCISE_CYCLE)"
          @remove="remove"
        />
      </div>
    </StateExample>
  </ExampleGroup>
  <ExampleGroup title="Keyboard">
    <dl
      class="grid w-full max-w-160 grid-cols-[auto_1fr] gap-x-6 gap-y-2"
      data-testid="sg-week-grid-keys"
    >
      <template v-for="[key, does] in KEYS" :key="key">
        <dt class="text-base font-semibold text-ink">{{ key }}</dt>
        <dd class="text-base text-ink">{{ does }}</dd>
      </template>
    </dl>
  </ExampleGroup>
</template>
