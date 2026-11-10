<script setup lang="ts">
import type { Day } from '@/stores/planner'
import type { Mark, MarkSet } from '@/lib/storage'
import type { Tracked } from '@/lib/tracker'
import { useGridNav } from '@/composables/gridNav'
import { computed, ref } from 'vue'
import TrackerRow from '@/components/TrackerRow.vue'
import { itemHref } from '@/lib/routes'
import type { Section } from '@/lib/trackerTypes'

const props = defineProps<{
  /** The section the rows belong to: each name links to its item's page in it. */
  section: Section
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
  configMode: boolean
  /**
   * Which days reach the section's daily pick (K30, K57). A met day's name turns pen and is
   * underlined (K60).
   */
  metDays?: boolean[]
}>()

defineEmits<{
  toggle: [id: string, day: number]
  remove: [id: string]
}>()

defineSlots<{
  /** A short screen's title in the empty top-left cell (the SectionHeader is hidden there). */
  corner?: () => unknown
}>()

/**
 * The column template on screen (WeekGrid card): the names and the seven days, and in Edit plan
 * a Remove column (no Week column, K33),
 * both from main.css's sizes (K54).
 * Folded there are only the seven days. On paper the colgroup's widths apply instead.
 */
const columns = computed(() =>
  props.configMode
    ? 'screen:grid-cols-[var(--grid-name-w)_repeat(7,minmax(0,1fr))_var(--grid-remove-w)]'
    : 'screen:grid-cols-[var(--grid-name-w)_repeat(7,minmax(0,1fr))]',
)
// One tab stop for the whole grid, on today's DayMark in the first row (see gridNav for the keys
// and for Edit plan's Remove cells).
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
  so a tall screen centres it. Each day cell is a size
  container that its DayMark fills. Folded (held upright) the names leave their column: each row's
  name line spans the seven days above its boxes, placed by the row's --line-row and --box-row,
  Nothing scrolls sideways. On paper it is a
  table again, at the colgroup's widths and DayMark's fixed size.

  Edit plan adds a Remove column after the days, and the name column stays as wide as the week's
  (K104: no Edit button); its rows are a fixed 100u (K54).

  Keyboard (F15): the WAI-ARIA grid, one tab stop per grid (useGridNav). A day cell's focus is its
  DayMark and a name cell's its name's link, each the cell's one widget (Enter on a name opens the
  item's page, F9); Edit plan's Remove cells take focus themselves and draw the focus ring inset.
-->
<template>
  <table
    ref="table"
    role="grid"
    :aria-label="tableLabel"
    class="w-full table-fixed border-collapse tabular-nums screen:grid screen:grid-rows-[auto_repeat(var(--rows),minmax(var(--grid-row-min),1fr))] screen:content-center full:max-h-[calc(var(--rows)*var(--grid-row-max)_+_var(--u)*100)] folded:max-h-none folded:grid-cols-7 folded:grid-rows-none folded:content-start"
    :class="columns"
    :style="{ '--rows': items.length }"
  >
    <!-- Paper's column widths; on screen the grid's template sets them, and a colgroup would be
         a grid item. -->
    <colgroup class="screen:hidden">
      <col class="w-50" />
      <col v-for="d in days" :key="d.key" />
      <col v-if="configMode" class="w-14" />
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
          data-testid="day-head"
        >
          <!-- A met day: the name in pen, underlined (K60). -->
          <span
            class="label text-(length:--fs-day) leading-tight"
            :class="
              metDays?.[i]
                ? 'text-pen underline decoration-[max(2px,calc(var(--u)*3))] underline-offset-[0.22em]'
                : 'text-ink'
            "
            >{{ d.name }}</span
          >
          <!-- The day's name alone on screen (the owner's call, K29); the date stays for a screen
               reader, and the DayMarks' names carry the full date. -->
          <span class="sr-only">{{ ' ' + d.date }}</span>
          <span v-if="d.isToday" class="sr-only">, today</span>
          <span v-if="metDays?.[i]" class="sr-only">, daily goal met</span>
        </th>
        <th
          v-if="configMode"
          scope="col"
          role="columnheader"
          class="p-0 screen:border-b screen:border-ink folded:hidden"
          data-noprint
        >
          <span class="sr-only">Remove</span>
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
        :config-mode="configMode"
        :days="days"
        :marks="marksFor(it.id)"
        :mark-set="markSet"
        @toggle="$emit('toggle', it.id, $event)"
        @remove="$emit('remove', it.id)"
      />
    </tbody>
  </table>
</template>
