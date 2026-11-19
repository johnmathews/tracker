<script lang="ts">
/**
 * Class lists the grid's cells share (WeekGrid card). On screen every cell draws its own row rule,
 * since a row is `display: contents` there and can't; folded, a row's name line has none.
 */
export const CELL = {
  /** A row's rule, on screen and on paper alike. */
  rule: 'screen:border-b screen:border-line',
}

/**
 * A paused activity's sentence (spec §9.5) in its two parts (K169): the lead, "Paused until Mon 28
 * Dec." or "Paused.", in paused-ink at 600, then the reason, "Knee.", in the row's ink-secondary.
 */
export type PausedLine = { lead: string; reason: string | null }
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { Pause } from '@lucide/vue'
import type { Day } from '@/stores/planner'
import type { Mark, MarkSet } from '@/lib/storage'
import type { Tracked } from '@/lib/tracker'
import { Chip } from '@/components/ui/chip'
import { DayMark } from '@/components/ui/day-mark'
import { Popover } from '@/components/ui/popover'
import { renderNote, renderNoteLine } from '@/lib/markdown'

const props = defineProps<{
  /** The row's place in the grid, 0 first: folded, it says which lines the row takes. */
  index: number
  item: Tracked
  /** The item's page (`itemHref`), which its name links to. */
  href: string
  /** The chips under the name, already in the Chip card's words ("3 × 12", "16 kg"). */
  details?: string[]
  /** The item's notes in markdown (K43), from its details: the same on every week. */
  note?: string
  days: Day[]
  /** Each day's mark, Monday first; `null` is an empty box. */
  marks: (Mark | null)[]
  /** How the marks are drawn: the device's mark set. The squiggles when not given. */
  markSet?: MarkSet
  /** Which days are locked (a programme tracker's, programmes spec §8): they don't press. */
  locked?: boolean[]
  /** A paused activity's sentence (spec §9.5), read in place of its seven boxes. */
  paused?: PausedLine | null
}>()
const emit = defineEmits<{
  toggle: [day: number]
}>()

/**
 * The note (K43): one line in the row, the whole of it in the popover, which scrolls when the
 * notes are longer than the screen. Raw HTML never renders.
 */
const noteLine = computed(() => renderNoteLine(props.note ?? ''))
const noteHtml = computed(() => renderNote(props.note ?? ''))

/** Folded, the row's name line and box line (TrackerGrid's header is line 1). */
const lines = computed(() => ({
  '--line-row': 2 + 2 * props.index,
  '--box-row': 3 + 2 * props.index,
}))
</script>

<!--
  One row of the WeekGrid card: the name in body-large 600, a link to the item's page, then the
  chips, and a DayMark per day. No week total (K33): the goal shows on the item's page. The row is
  the same in Edit plan: the name, a link to the item's page in both modes, is the way to edit or
  remove the item (K104, K120). The header is at least 44px tall (an IconButton's target), so the
  row keeps its height (F25).
  The name's link is its cell's widget (Enter opens the page, F9); the note's button stays out of
  the Tab order until F2 on its cell lets it in, and Escape leaves it (gridNav), so each grid stays
  one tab stop.

  Folded, the name spans the seven days on the row's first line; the days take the second line.
-->
<template>
  <tr role="row" class="border-b border-line screen:contents" :style="lines">
    <th
      scope="row"
      role="rowheader"
      class="py-2 pr-1.5 pl-1.5 text-left align-middle font-normal focus-visible:-outline-offset-2 screen:flex screen:items-center screen:pl-0 short:py-0"
      :class="[
        CELL.rule,
        'folded:col-[1/-1] folded:row-(--line-row) folded:border-0 folded:pt-[calc(var(--n)*10)] folded:pr-0 folded:pb-0.5',
      ]"
    >
      <div class="flex min-h-11 min-w-0 items-center gap-2 folded:min-h-0">
        <div class="flex min-w-0 flex-col gap-1 folded:gap-0.5">
          <!-- The name and its chips share a line, wrapping when they must (K43). -->
          <span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span class="flex min-w-0 items-center gap-1">
              <!-- The name is a link to the item's page (WeekGrid card, K64): it looks as it always
                   has, underlines under the pointer, and prints as plain text. -->
              <a
                :href="href"
                class="block min-w-0 rounded-[2px] text-(length:--fs-name) leading-tight font-semibold break-words text-ink no-underline decoration-2 underline-offset-3 hover:underline print:no-underline"
                data-slot="item-link"
                data-testid="item-name"
                >{{ item.name }}</a
              >
            </span>
            <Chip
              v-for="d in details"
              :key="d"
              class="text-(length:--fs-chip) short:hidden"
              data-testid="item-detail"
              >{{ d }}</Chip
            >
          </span>
          <!-- The note on the next line, cut to one; a press opens the whole of it (K43). -->
          <Popover v-if="note" :title="item.name" align="start">
            <template #trigger>
              <!-- eslint-disable-next-line vue/no-v-html -- markdown-it with raw HTML off (lib/markdown) -->
              <button
                type="button"
                class="note-line block max-w-full min-w-0 cursor-pointer truncate text-left font-serif text-(length:--fs-chip) leading-snug text-ink-secondary italic hover:text-ink short:hidden"
                data-testid="item-note"
                v-html="noteLine"
              ></button>
            </template>
            <!-- eslint-disable-next-line vue/no-v-html -- markdown-it with raw HTML off (lib/markdown) -->
            <div
              class="note-body font-serif text-ink italic"
              data-testid="item-note-body"
              v-html="noteHtml"
            ></div>
          </Popover>
        </div>
      </div>
    </th>
    <!-- A paused activity says so across its seven days (PlannerScreen card, K146). Its lead is
         paused-ink at 600 (K169); the reason and the icon stay ink-secondary at 400. One span
         holds the sentence, so it reads as one line beside the icon. -->
    <td
      v-if="paused"
      role="gridcell"
      colspan="7"
      class="px-2 text-center align-middle text-[max(18px,calc(var(--u)*19))] leading-[1.4] text-ink-secondary screen:col-span-7 screen:flex screen:items-center screen:justify-center screen:gap-2 folded:col-[1/-1] folded:row-(--box-row) folded:min-h-12 folded:text-[16px]"
      :class="CELL.rule"
      data-testid="paused-row"
    >
      <Pause :stroke-width="1.5" aria-hidden="true" class="inline size-[18px] flex-none" />
      <span
        ><span class="font-semibold text-paused-ink" data-testid="paused-lead">{{
          paused.lead
        }}</span
        >{{ paused.reason ? ` ${paused.reason}` : '' }}</span
      >
    </td>
    <td
      v-for="(d, i) in paused ? [] : days"
      :key="d.key"
      role="gridcell"
      class="p-0 align-middle screen:[container-type:size] folded:row-(--box-row) folded:h-(--grid-box-h)"
      :class="CELL.rule"
    >
      <DayMark
        :name="item.name"
        :date="d.full"
        :today="d.isToday"
        :mark="marks[i] ?? null"
        :set="markSet"
        :locked="locked?.[i] ?? false"
        fill
        @toggle="emit('toggle', i)"
      />
    </td>
  </tr>
</template>
