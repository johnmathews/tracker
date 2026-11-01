<script setup lang="ts">
import { computed } from 'vue'
import { addDays, dayMonth } from '@/lib/dates'
import { metPhrase, weekCount, weekMet, type RecentWeek } from '@/lib/history'
import { markKind, type MarkSet } from '@/lib/storage'
import { DayMarkDrawing, MARK_WORDS } from '@/components/ui/day-mark'

const props = defineProps<{
  /** Up to eight weeks, newest first (`itemHistory`). */
  weeks: RecentWeek[]
  /** The device's mark set (K20). */
  markSet: MarkSet
  /** The id of the heading that labels the list ("Recent weeks"). */
  labelledby: string
}>()

const phrase = computed(() => metPhrase(props.weeks))

/** "A, B and C", as a sentence lists things. */
function listed(words: string[]): string {
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
}

/** "26 Oct" on screen: the short date, for the eye only. */
function shortDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** What the drawings show, for a screen reader: "Marked Monday, Wednesday (partly done)…". */
function marked(week: RecentWeek): string {
  const days = week.marks.flatMap((mark, d) => {
    if (!mark) return []
    const day = addDays(week.monday, d).toLocaleDateString('en-GB', { weekday: 'long' })
    const kind = MARK_WORDS[markKind(mark)]
    return [kind ? `${day} (${kind})` : day]
  })
  return days.length ? `Marked ${listed(days)}.` : 'Nothing marked.'
}

/** The count: "2 of 3", "2 days" for a goal of 0, "Not planned" when the plan didn't hold it. */
function count(week: RecentWeek): string {
  if (week.goal === null) return 'Not planned'
  const n = weekCount(week)
  return week.goal === 0 ? `${n} ${n === 1 ? 'day' : 'days'}` : `${n} of ${week.goal}`
}
</script>

<!--
  An item's recent weeks (brand/design-system/project/components/RecentWeeks): one line a week,
  newest first: when, its seven marks as pictures, and the count against that week's goal, a met
  week's count in pen, underlined like a met day's name (K60). The line above says how many weeks
  met their goal, in words. Each line reads as one sentence to a screen reader.
-->
<template>
  <div class="flex flex-col gap-[calc(var(--u)*18)] folded:gap-4" data-slot="recent-weeks">
    <p
      v-if="phrase"
      class="body text-(length:--set-text) leading-normal text-ink-secondary"
      data-testid="recent-weeks-line"
    >
      The goal was met in <span class="text-ink">{{ phrase }}</span
      >.
    </p>
    <ol
      :aria-labelledby="labelledby"
      class="grid grid-cols-[max-content_max-content_minmax(0,1fr)] gap-x-[calc(var(--u)*14)] folded:gap-x-2.5"
    >
      <li
        v-for="week in weeks"
        :key="week.week"
        :aria-current="week.current ? 'date' : undefined"
        class="body col-span-full grid grid-cols-subgrid items-center border-t border-line py-[calc(var(--u)*8)] text-(length:--set-text) leading-normal last:border-b"
        data-testid="recent-week"
      >
        <span v-if="week.current" class="font-semibold whitespace-nowrap text-ink"
          >This week<span class="sr-only">.</span></span
        >
        <span v-else class="whitespace-nowrap text-ink"
          ><span aria-hidden="true">{{ shortDate(week.monday) }}</span
          ><span class="sr-only">Week of {{ dayMonth(week.monday) }}.</span></span
        >
        <span
          class="flex gap-[calc(var(--u)*6)] folded:gap-0.75"
          aria-hidden="true"
          data-testid="recent-week-marks"
        >
          <span
            v-for="(mark, d) in week.marks"
            :key="d"
            class="grid size-[max(20px,calc(var(--u)*24))] shrink-0 place-items-center folded:size-[min(calc(var(--n)*24),5.4vw)] [&_svg]:size-full"
          >
            <DayMarkDrawing :mark="mark" :set="markSet" />
          </span>
        </span>
        <span class="sr-only">{{ ` ${marked(week)} ` }}</span>
        <span
          :class="
            weekMet(week)
              ? 'font-semibold whitespace-nowrap text-pen underline decoration-[max(2px,calc(var(--u)*3))] underline-offset-[0.22em]'
              : week.goal === null
                ? 'text-ink-secondary'
                : 'whitespace-nowrap text-ink-secondary'
          "
          :data-met="weekMet(week) ? 'true' : undefined"
          data-testid="recent-week-count"
          >{{ count(week) }}<span v-if="weekMet(week)" class="sr-only">, goal met</span></span
        >
      </li>
    </ol>
  </div>
</template>
