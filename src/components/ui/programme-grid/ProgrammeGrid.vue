<script setup lang="ts">
import { computed, nextTick, onMounted, useTemplateRef, watch } from 'vue'
import { Pencil } from '@lucide/vue'
import { Chip } from '@/components/ui/chip'
import { Menu, MenuItem } from '@/components/ui/menu'
import {
  changeWords,
  dayText,
  goalText,
  madeOnText,
  primaryField,
  setsLine,
  valueText,
  weekCount,
  weekDates,
  weekdayText,
  weekName,
  type Cell,
  type Grid,
  type GridWeek,
  type PreviewCell,
  type ProgrammeKind,
} from '@/lib/programmes'
import { FOLDED } from '.'

const props = defineProps<{
  /** The server's grid (spec P4): the app computes no value of its own. */
  grid: Grid
  kind: ProgrammeKind
  /**
   * `running`: the overview, past weeks on a tile and this week framed. `start`: the start's
   * preview, every week still to come. `preview`: a change's preview, its cells before → after.
   */
  mode: 'running' | 'start' | 'preview'
  /** The scrolling box's name: "The plan, week by week". */
  label: string
  /** A change's preview: the cells it changes, before and after (spec §7.3). */
  changes?: PreviewCell[]
  /** The programme is paused with no end: the weeks after this one show as they will resume. */
  openPause?: boolean
  /** Offline: the cells' buttons are there, disabled (spec §11.2). */
  disabled?: boolean
  /** Nothing can change (an ended run): no cell is a button. */
  readonly?: boolean
  /** The table bleeds to the screen's edges when folded, as on the overview. */
  bleed?: boolean
  /** An activity's item page, for its name's link. */
  itemHref?: (key: string) => string
}>()

const emit = defineEmits<{
  /** Edit this week: a hand-edit of the activity's value for that week. */
  edit: [key: string, week: GridWeek]
  /** Change from here: a change from that week's Monday. */
  change: [key: string, week: GridWeek]
}>()

/** One column: a calendar week, or a programme week after an open pause, without dates. */
type Column = {
  id: string
  number: number | null
  name: string
  dates: string
  tags: string[]
  past: boolean
  current: boolean
  week: GridWeek | null
  cells: Record<string, Cell>
}

const running = computed(() => props.mode !== 'start')

const columns = computed<Column[]>(() => {
  const weeks = props.grid.weeks
  const now = weeks.findIndex((w) => w.current)
  const shown = props.openPause && now >= 0 ? weeks.slice(0, now + 1) : weeks
  const calendar = shown.map((week): Column => {
    const current = running.value && week.current
    const tags: string[] = []
    if (current) {
      const paused = week.days.find((d) => d.status === 'paused')
      tags.push(props.openPause && paused ? `Paused from ${weekdayText(paused.date)}` : 'This week')
    }
    if (week.label) tags.push(week.label)
    return {
      id: week.monday,
      number: week.programmeWeeks.at(-1) ?? null,
      name: weekName(week),
      dates: weekDates(week.monday),
      tags,
      past: running.value && week.locked,
      current,
      week,
      cells: week.cells,
    }
  })
  if (!props.openPause) return calendar
  const resumed = props.grid.whenResumed.map((w): Column => ({
    id: `resumed-${w.programmeWeek}`,
    number: w.programmeWeek,
    name: `Week ${w.programmeWeek}`,
    dates: 'When resumed',
    tags: w.label ? [w.label] : [],
    past: false,
    current: false,
    week: null,
    cells: w.cells,
  }))
  return [...calendar, ...resumed]
})

/** What an activity's name shows its chip and goal from: this week on, a week with no tag. */
function reference(key: string) {
  const from = Math.max(
    0,
    columns.value.findIndex((c) => c.current),
  )
  const later = columns.value.slice(from).filter((c) => c.cells[key]?.values)
  const pick = later.find((c) => c.tags.length === (c.current ? 1 : 0)) ?? later[0]
  return pick?.cells[key]?.values ?? null
}

const rows = computed(() =>
  props.grid.activities.map((a) => {
    const values = reference(a.key)
    return {
      key: a.key,
      name: a.name,
      chip: values && props.kind !== 'cardio' ? setsLine(values, props.kind) : null,
      goal: values?.target !== undefined ? goalText(values.target) : null,
    }
  }),
)

type View = {
  state: 'done' | 'current' | 'planned' | 'paused' | 'changed' | 'none'
  /** The leading line: a value, a count, "Paused", or before → after. */
  main: string
  /** Before a change's arrow, in ink-secondary. */
  was: string | null
  /** Words for a screen reader after the leading line. */
  hidden: string | null
  lines: string[]
  /** "Paused until Wed 2 Dec", after the lines, in paused-ink at 600 (K166). */
  until: string | null
  met: boolean
  split: boolean
  hand: string | null
  tap: boolean
}

function changeFor(column: Column, key: string, lead: string | null): PreviewCell | null {
  if (props.mode !== 'preview' || !column.week) return null
  const mine = (props.changes ?? []).filter(
    (c) => c.key === key && c.monday === column.week!.monday,
  )
  return mine.find((c) => c.field === lead) ?? mine.find((c) => c.field !== null) ?? mine[0] ?? null
}

function view(column: Column, key: string): View {
  const cell = column.cells[key]
  const blank: View = {
    state: 'none',
    main: '',
    was: null,
    hidden: 'Not in this week',
    lines: [],
    until: null,
    met: false,
    split: false,
    hand: null,
    tap: false,
  }
  if (!cell || !cell.values || cell.state === 'ended' || cell.state === 'not-started') return blank
  const values = cell.values
  const lead = primaryField(values)
  const out: View = { ...blank, hidden: null }
  if (cell.state === 'paused' || (column.past && cell.target === 0)) {
    return { ...out, state: 'paused', main: 'Paused', lines: cell.reason ? [cell.reason] : [] }
  }
  // An activity planned by its goal alone leads with the goal: "3 a week".
  const value = lead ? valueText(lead, values[lead]!) : goalText(cell.target)
  const splits = cell.splits[lead ?? 'target']
  const split = splits && splits.length > 1 ? splits : null
  const splitLines = split
    ? [
        `${split[0]!.value} → ${valueText(lead!, split.at(-1)!.value)}`,
        `from ${weekdayText(split.at(-1)!.from)}`,
      ]
    : []
  const handMark = (lead && cell.hand[lead]) || Object.values(cell.hand)[0]
  const hand = handMark ? madeOnText(handMark.madeOn) : null
  if (column.past) {
    const count = weekCount(cell)
    return {
      ...out,
      state: 'done',
      main: `${count.done} of ${count.target}`,
      hidden: count.met ? ', goal met' : null,
      met: count.met,
      split: !!split,
      lines: split ? splitLines : [value],
    }
  }
  const sets = setsLine(values, props.kind)
  const lines = split ? [splitLines[1]!] : []
  if (sets) lines.push(sets)
  if (column.current && cell.target > 0) {
    lines.push(`${weekCount(cell).done} of ${cell.target} so far`)
  }
  const until =
    cell.until && column.week && cell.until > column.week.monday
      ? `Paused until ${dayText(cell.until)}`
      : null
  const change = changeFor(column, key, lead)
  if (change) {
    const text = changeWords(change)
    return { ...out, state: 'changed', main: text.now, was: text.was, lines, until, hand }
  }
  const tap =
    props.mode === 'running' &&
    !props.readonly &&
    !column.current &&
    column.week !== null &&
    cell.state === 'running'
  return {
    ...out,
    state: column.current ? 'current' : 'planned',
    main: split ? splitLines[0]! : value,
    hidden: hand ? `, set by hand on ${hand}` : null,
    lines,
    until,
    split: !!split,
    hand,
    tap,
  }
}

const table = computed(() =>
  rows.value.map((row) => ({
    ...row,
    cells: columns.value.map((c) => ({ column: c, view: view(c, row.key) })),
  })),
)

// On a phone the box opens on this week, first after the activity column (ProgrammeGrid card).
const box = useTemplateRef<HTMLElement>('box')
async function openOnThisWeek(): Promise<void> {
  await nextTick()
  const wrap = box.value
  if (!wrap || !window.matchMedia?.(FOLDED).matches) return
  const current = wrap.querySelector('thead [data-current]')
  const activity = wrap.querySelector('thead th.sticky')
  if (!current || !activity) return
  wrap.scrollLeft = Math.max(
    0,
    current.getBoundingClientRect().left - activity.getBoundingClientRect().right,
  )
}
onMounted(openOnThisWeek)
watch(() => props.grid, openOnThisWeek)

/** The ink frame round this week: down both sides, across the top of its head and under its foot. */
const FRAME_SIDES = 'shadow-[inset_2px_0_0_var(--color-ink),inset_-2px_0_0_var(--color-ink)]'
const FRAME_TOP =
  'shadow-[inset_2px_0_0_var(--color-ink),inset_-2px_0_0_var(--color-ink),inset_0_2px_0_var(--color-ink)]'
const FRAME_FOOT =
  'shadow-[inset_2px_0_0_var(--color-ink),inset_-2px_0_0_var(--color-ink),inset_0_-2px_0_var(--color-ink)]'

/** "Paused until …": the cell's last line, in paused-ink at 600 so it stands out (K166). */
const UNTIL =
  'block text-(length:--set-caption) leading-[1.35] font-semibold whitespace-nowrap text-paused-ink'

function cellClass(column: Column, last: boolean): string[] {
  return [column.past ? 'bg-tile' : '', column.current ? (last ? FRAME_FOOT : FRAME_SIDES) : '']
}
</script>

<!--
  The ProgrammeGrid card (brand/design-system/project/components/ProgrammeGrid, K142, K143, K148):
  a programme's plan as a real table at every width, a row per activity and a column per
  programme week, in a box that scrolls sideways on its own so the page never does. The activity
  column stays put. Past weeks sit on a tile and show how they went; this week is framed in 2px
  ink; a hand-edit has a pencil; later weeks' cells open Edit this week and Change from here. The
  same table is the start's preview and a change's preview, where a changed cell reads
  "40 → 45 kg". The box is positioned, so the visually hidden words in its cells scroll and clip
  with it.
-->
<template>
  <div
    ref="box"
    class="relative [scrollbar-width:thin] overflow-x-auto overscroll-x-contain"
    :class="bleed && 'folded:-mx-(--screen-pad-x)'"
    tabindex="0"
    role="region"
    :aria-label="label"
    data-slot="programme-grid"
    data-testid="programme-grid"
  >
    <table
      class="w-full border-separate border-spacing-0 text-(length:--set-text) leading-[1.35] text-ink tabular-nums"
    >
      <thead>
        <tr>
          <th
            scope="col"
            class="sticky left-0 z-2 w-[216px] min-w-[216px] border-b border-ink bg-canvas px-2 py-3 align-bottom folded:w-[132px] folded:min-w-[132px] folded:py-2.5 folded:shadow-[1px_0_0_var(--color-line)]"
            :class="bleed && 'folded:pl-(--screen-pad-x)'"
          >
            <span class="sr-only">Activity</span>
          </th>
          <th
            v-for="(column, i) in columns"
            :key="column.id"
            scope="col"
            class="min-w-[108px] border-b border-ink px-2 py-3 text-left align-bottom font-normal folded:min-w-[104px] folded:py-2.5"
            :class="[
              column.past && 'bg-tile',
              column.current && FRAME_TOP,
              bleed && i === columns.length - 1 && 'folded:pr-(--screen-pad-x)',
            ]"
            :data-week="column.number ?? undefined"
            :data-monday="column.week?.monday"
            :data-past="column.past ? '' : undefined"
            :data-current="column.current ? '' : undefined"
            :data-when-resumed="column.week ? undefined : ''"
            :aria-current="column.current ? 'date' : undefined"
          >
            <span class="block font-semibold whitespace-nowrap folded:text-[calc(var(--n)*16)]">{{
              column.name
            }}</span>
            <span
              class="block text-(length:--set-caption) leading-[1.35] whitespace-nowrap text-ink-secondary"
              >{{ column.dates }}</span
            >
            <span
              v-for="tag in column.tags"
              :key="tag"
              class="block text-(length:--set-caption) leading-[1.35] font-semibold whitespace-nowrap"
              >{{ tag }}</span
            >
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, r) in table" :key="row.key" :data-activity="row.key">
          <th
            scope="row"
            class="sticky left-0 z-2 w-[216px] min-w-[216px] border-b border-line bg-canvas px-2 py-3 text-left align-top font-normal folded:w-[132px] folded:min-w-[132px] folded:py-2.5 folded:shadow-[1px_0_0_var(--color-line)]"
            :class="bleed && 'folded:pl-(--screen-pad-x)'"
          >
            <a
              v-if="itemHref"
              :href="itemHref(row.key)"
              class="group text-ink no-underline"
              data-slot="programme-activity"
              ><span
                class="block text-[max(20px,calc(var(--u)*22))] leading-tight font-semibold wrap-anywhere group-hover:underline group-hover:decoration-2 group-hover:underline-offset-3 folded:text-[calc(var(--n)*18)]"
                >{{ row.name }}</span
              ></a
            >
            <span
              v-else
              class="block text-[max(20px,calc(var(--u)*22))] leading-tight font-semibold wrap-anywhere folded:text-[calc(var(--n)*18)]"
              >{{ row.name }}</span
            >
            <span class="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <Chip v-if="row.chip">{{ row.chip }}</Chip>
              <span
                v-if="row.goal"
                class="text-(length:--set-caption) leading-[1.35] text-ink-secondary"
                >{{ row.goal }}</span
              >
            </span>
          </th>
          <td
            v-for="({ column, view: v }, i) in row.cells"
            :key="column.id"
            class="border-b border-line align-top"
            :class="[
              cellClass(column, r === table.length - 1),
              v.tap ? 'p-0 hover:bg-tile' : 'px-2 py-3 folded:py-2.5',
              bleed && i === row.cells.length - 1 && !v.tap && 'folded:pr-(--screen-pad-x)',
            ]"
            :data-activity="row.key"
            :data-week="column.number ?? undefined"
            :data-cell="v.state"
            :data-met="v.met ? '' : undefined"
            :data-split="v.split ? '' : undefined"
            :data-hand-edit="v.hand ?? undefined"
            :data-when-resumed="column.week ? undefined : ''"
          >
            <Menu v-if="v.tap" align="start">
              <template #trigger>
                <button
                  type="button"
                  class="block min-h-11 w-full cursor-pointer px-2 py-3 text-left focus-visible:-outline-offset-2 disabled:cursor-not-allowed folded:py-2.5"
                  :class="bleed && i === row.cells.length - 1 && 'folded:pr-(--screen-pad-x)'"
                  :disabled="disabled"
                >
                  <span
                    class="flex items-center gap-1.5 text-[max(18px,calc(var(--u)*21))] leading-[1.3] font-semibold whitespace-nowrap folded:text-[calc(var(--n)*18)]"
                    >{{ v.main
                    }}<Pencil
                      v-if="v.hand"
                      :size="16"
                      :stroke-width="1.5"
                      class="text-ink-secondary"
                      aria-hidden="true"
                      data-slot="hand-edit"
                    /><span v-if="v.hidden" class="sr-only">{{ v.hidden }}</span></span
                  >
                  <span
                    v-for="line in v.lines"
                    :key="line"
                    class="block text-(length:--set-caption) leading-[1.35] font-normal whitespace-nowrap text-ink-secondary"
                    >{{ line }}</span
                  >
                  <span v-if="v.until" :class="UNTIL" data-testid="paused-until">{{
                    v.until
                  }}</span>
                </button>
              </template>
              <MenuItem @select="emit('edit', row.key, column.week!)">Edit this week</MenuItem>
              <MenuItem @select="emit('change', row.key, column.week!)">Change from here</MenuItem>
            </Menu>
            <template v-else-if="v.state !== 'none'">
              <span
                class="flex items-center gap-1.5 text-[max(18px,calc(var(--u)*21))] leading-[1.3] font-semibold whitespace-nowrap folded:text-[calc(var(--n)*18)]"
                :class="v.state === 'paused' && 'text-ink-secondary'"
              >
                <span v-if="v.was" class="font-normal text-ink-secondary">{{ v.was }}</span>
                <span
                  :class="
                    v.state === 'done' &&
                    (v.met
                      ? 'text-ink underline decoration-pen decoration-2 underline-offset-[0.22em]'
                      : 'font-normal text-ink-secondary')
                  "
                  >{{ v.main }}</span
                ><Pencil
                  v-if="v.hand"
                  :size="16"
                  :stroke-width="1.5"
                  class="text-ink-secondary"
                  aria-hidden="true"
                  data-slot="hand-edit"
                /><span v-if="v.hidden" class="sr-only">{{ v.hidden }}</span>
              </span>
              <span
                v-for="line in v.lines"
                :key="line"
                class="block text-(length:--set-caption) leading-[1.35] whitespace-nowrap text-ink-secondary"
                >{{ line }}</span
              >
              <span v-if="v.until" :class="UNTIL" data-testid="paused-until">{{ v.until }}</span>
            </template>
            <span v-else class="sr-only">{{ v.hidden }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
