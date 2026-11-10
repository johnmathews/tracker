<script lang="ts">
/**
 * Class lists the grid's cells share (WeekGrid card). On screen every cell draws its own row rule,
 * since a row is `display: contents` there and can't; folded, a row's name line has none.
 */
export const CELL = {
  /** A row's rule, on screen and on paper alike. */
  rule: 'screen:border-b screen:border-line',
}
</script>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Trash2 } from '@lucide/vue'
import type { Day } from '@/stores/planner'
import type { Mark, MarkSet } from '@/lib/storage'
import type { Tracked } from '@/lib/tracker'
import { useConfirm } from '@/composables/useConfirm'
import { Chip } from '@/components/ui/chip'
import { DayMark } from '@/components/ui/day-mark'
import { IconButton } from '@/components/ui/icon-button'
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
  /** Config mode shows the remove button in a cell of its own at the end of the row. The name
   * links to the item's page in both modes, where Edit plan edits it (K104). */
  configMode: boolean
  days: Day[]
  /** Each day's mark, Monday first; `null` is an empty box. */
  marks: (Mark | null)[]
  /** How the marks are drawn: the device's mark set. The squiggles when not given. */
  markSet?: MarkSet
}>()
const emit = defineEmits<{
  toggle: [day: number]
  remove: []
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

const { confirm } = useConfirm()
const row = ref<HTMLTableRowElement | null>(null)

/**
 * Where focus can go once this row is gone: the next row's Remove button, else the previous
 * row's, else the section's Add button (K54). Found before asking, while it's there.
 */
function neighbours(): HTMLElement[] {
  const tr = row.value!
  const removeIn = (el: Element | null) =>
    el?.querySelector<HTMLElement>('[data-action="remove"]') ?? null
  const add = tr.closest('section')?.querySelector<HTMLElement>('[data-add]') ?? null
  return [removeIn(tr.nextElementSibling), removeIn(tr.previousElementSibling), add].filter(
    (el): el is HTMLElement => el !== null,
  )
}

/**
 * Removing takes the item off this week's plan only (and off the weeks that follow it without a
 * plan of their own); weeks with their own plan and the log are untouched (removeExercise,
 * removeFood). So the question says what goes and what stays, per the ConfirmDialog card.
 */
async function remove(event: MouseEvent): Promise<void> {
  // Back to this Remove button on Cancel; to a neighbour once the row has gone.
  const targets = [event.currentTarget as HTMLElement, ...neighbours()]
  // "This week" in the question is the week showing now (its Monday's key); if the week changes
  // while it is open (midnight on Sunday), Remove would take the item off another week instead.
  const week = props.days[0]!.key
  const yes = await confirm({
    title: `Remove ${props.item.name}?`,
    message:
      'It comes off this week’s plan. Weeks with their own plan keep it, and its marks stay.',
    confirmLabel: 'Remove',
    returnFocus: () => targets.find((el) => el.isConnected) ?? null,
  })
  if (yes && props.days[0]!.key === week) emit('remove')
}
</script>

<!--
  One row of the WeekGrid card: the name in body-large 600, a link to the item's page, then the
  chips, and a DayMark per day. No
  week total (K33): the goal shows on the item's page. In Edit plan the remove IconButton ends the
  row in a cell of its own, and the name, a link to the item's page in both modes, is the way to
  edit it there (K104). The header is at least 44px tall (an IconButton's target) in both modes, so
  the row keeps its height (F25).
  The name's link is its cell's widget (Enter opens the page, F9); the note's button and Edit
  plan's Remove stays out of the Tab order until F2 on their cell (or Enter, on the Remove cell)
  lets them in, and Escape leaves them (gridNav), so each grid stays one tab stop.

  Folded, the name spans the seven days on the row's first line, the
  remove button over its right end in Edit plan; the days take the second line.
-->
<template>
  <tr ref="row" role="row" class="border-b border-line screen:contents" :style="lines">
    <th
      scope="row"
      role="rowheader"
      class="py-2 pr-1.5 pl-1.5 text-left align-middle font-normal focus-visible:-outline-offset-2 screen:flex screen:items-center screen:pl-0 short:py-0"
      :class="[
        CELL.rule,
        'folded:col-[1/-1] folded:row-(--line-row) folded:border-0 folded:pt-[calc(var(--n)*10)] folded:pb-0.5',
        configMode ? 'folded:pr-[15%]' : 'folded:pr-0',
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
    <td
      v-for="(d, i) in days"
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
        fill
        @toggle="emit('toggle', i)"
      />
    </td>
    <td
      v-if="configMode"
      role="gridcell"
      class="px-1.5 text-center align-middle focus-visible:-outline-offset-2 screen:flex screen:items-center screen:justify-center folded:col-7 folded:row-(--line-row) folded:border-0 folded:p-0"
      :class="CELL.rule"
      data-noprint
    >
      <IconButton
        :label="`Remove ${item.name}`"
        class="size-(--edit-ib) [&_svg]:size-(--edit-ib-icon)"
        data-action="remove"
        @click="remove"
      >
        <Trash2 />
      </IconButton>
    </td>
  </tr>
</template>
