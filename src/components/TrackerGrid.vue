<script setup lang="ts">
import type { Day } from '@/stores/planner'
import type { Mark, MarkSet } from '@/lib/storage'
import type { Tracked } from '@/lib/tracker'
import { useGridNav } from '@/composables/gridNav'
import { ref } from 'vue'
import { Lock } from '@lucide/vue'
import TrackerRow from '@/components/TrackerRow.vue'
import { itemHref } from '@/lib/routes'

defineProps<{
  /** The tracker id the rows belong to: each name links to its item's page in it. */
  section: string
  /** The rows' kind, for the name column's hidden header: "Exercise" or "Food". */
  label: string
  /** The table's name, repeating the section and week: "Exercises, week of 19 October". */
  tableLabel: string
  items: Tracked[]
  days: Day[]
  marksFor: (id: string) => (Mark | null)[]
  /** How the marks are drawn: the device's mark set. The squiggles when not given. */
  markSet?: MarkSet
  detailsFor?: (item: Tracked) => string[]
  /** Each item's notes, from its details (the same on every week); none when not given. */
  noteFor?: (item: Tracked) => string
  /**
   * Which days reach the section's daily pick (K30, K57). A met day's name turns pen and is
   * underlined (K60).
   */
  metDays?: boolean[]
  /**
   * A programme tracker's locked days (programmes spec §8, PlannerScreen card): a lock by the
   * day's name, and boxes that don't press. None on an ordinary tracker.
   */
  lockedDays?: boolean[]
  /** A programme tracker's paused activity's sentence, read in place of its boxes; else null. */
  pausedFor?: (item: Tracked) => string | null
}>()

defineEmits<{
  toggle: [id: string, day: number]
}>()

defineSlots<{
  /** A short screen's title in the empty top-left cell (the SectionHeader is hidden there). */
  corner?: () => unknown
}>()

// One tab stop for the whole grid, on today's DayMark in the first row (see gridNav for the keys).
const table = ref<HTMLTableElement | null>(null)
useGridNav(table, {
  widget: '[data-slot="day-mark-button"], [data-slot="item-link"]',
  start: '[data-slot="day-mark-button"][aria-current="date"]',
})
</script>

<!--
  One week (brand/design-system/project/components/WeekGrid): the name column, seven day columns
  hairline rules between rows, an ink rule under the header, no boxes and no
  card around it. Today has no band (K36): only its name for a screen reader says it.

  On screen the table is a CSS grid (its row groups and rows `display: contents`, so the explicit
  roles carry the table's meaning). It fills the height its screen leaves (PlannerScreen): rows
  share it, at least --grid-row-min each, and the grid stops at --grid-row-max a row (main.css),
  so a tracker with few rows keeps its rows' height and space is left under it (K110, K114). Each
  day cell is a size
  container that its DayMark fills. Folded (held upright) the names leave their column: each row's
  name line spans the seven days above its boxes, placed by the row's --line-row and --box-row,
  Nothing scrolls sideways. On paper it is a
  table again, at the colgroup's widths and DayMark's fixed size.

  Edit plan has the week's columns: no Edit button (K104) and no Remove column (K120). Its rows are
  a fixed 100u (K54).

  Keyboard (F15): the WAI-ARIA grid, one tab stop per grid (useGridNav). A day cell's focus is its
  DayMark and a name cell's its name's link, each the cell's one widget (Enter on a name opens the
  item's page, F9).
-->
<template>
  <table
    ref="table"
    role="grid"
    :aria-label="tableLabel"
    class="w-full table-fixed border-collapse tabular-nums screen:grid screen:grid-cols-[var(--grid-name-w)_repeat(7,minmax(0,1fr))] screen:grid-rows-[auto_repeat(var(--rows),minmax(var(--grid-row-min),1fr))] screen:content-center full:max-h-[calc(var(--rows)*var(--grid-row-max)_+_var(--grid-head-h))] folded:max-h-none folded:grid-cols-7 folded:grid-rows-none folded:content-start"
    :style="{ '--rows': items.length }"
  >
    <!-- Paper's column widths; on screen the grid's template sets them, and a colgroup would be
         a grid item. -->
    <colgroup class="screen:hidden">
      <col class="w-50" />
      <col v-for="d in days" :key="d.key" />
    </colgroup>
    <thead class="screen:contents">
      <tr role="row" class="border-b border-ink screen:contents">
        <th
          scope="col"
          role="columnheader"
          class="p-0 screen:flex screen:flex-col screen:justify-end screen:border-b screen:border-ink folded:hidden"
        >
          <span class="sr-only" data-slot="grid-label">{{ label }}</span>
          <span aria-hidden="true" class="hidden flex-col pb-1 text-left short:flex">
            <slot name="corner" />
          </span>
        </th>
        <th
          v-for="(d, i) in days"
          :key="d.key"
          scope="col"
          role="columnheader"
          class="px-0 py-2 text-center font-normal screen:flex screen:flex-col screen:justify-end screen:border-b screen:border-ink screen:py-[calc(var(--u)*12)] folded:py-1.5 short:py-1"
          :aria-current="d.isToday ? 'date' : undefined"
          :data-today="d.isToday"
          :data-met="metDays?.[i] ? 'true' : undefined"
          :data-locked="lockedDays?.[i] ? '' : undefined"
          data-testid="day-head"
        >
          <!-- A met day: the name in pen, underlined (K60). A locked day: a lock 4px after it,
               which an underline doesn't reach (PlannerScreen card, K146). -->
          <span
            class="label text-(length:--fs-day) leading-tight whitespace-nowrap"
            :class="
              metDays?.[i]
                ? 'text-pen underline decoration-[max(2px,calc(var(--u)*3))] underline-offset-[0.22em]'
                : 'text-ink'
            "
            >{{ d.name
            }}<Lock
              v-if="lockedDays?.[i]"
              :stroke-width="1.5"
              aria-hidden="true"
              data-slot="lock"
              class="ml-1 inline size-4 align-[-0.125em] text-ink-secondary folded:size-3.5"
          /></span>
          <!-- The day's name alone on screen (the owner's call, K29); the date stays for a screen
               reader, and the DayMarks' names carry the full date. -->
          <span class="sr-only">{{ ' ' + d.date }}</span>
          <span v-if="d.isToday" class="sr-only">, today</span>
          <span v-if="lockedDays?.[i]" class="sr-only">, locked</span>
          <span v-if="metDays?.[i]" class="sr-only">, daily goal met</span>
        </th>
      </tr>
    </thead>

    <tbody class="screen:contents">
      <TrackerRow
        v-for="(it, i) in items"
        :key="it.id"
        :index="i"
        :item="it"
        :href="itemHref(section, it.id)"
        :details="detailsFor?.(it)"
        :note="noteFor?.(it)"
        :days="days"
        :marks="marksFor(it.id)"
        :mark-set="markSet"
        :locked="lockedDays"
        :paused="pausedFor?.(it) ?? null"
        @toggle="$emit('toggle', it.id, $event)"
      />
    </tbody>
  </table>
</template>
