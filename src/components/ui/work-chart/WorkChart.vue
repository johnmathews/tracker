<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useElementSize } from '@vueuse/core'
import { weekDates, weekName, type WorkSeries, type WorkWeek } from '@/lib/programmes'
import { amountText, tickText, type FrameWeek } from '@/lib/work'

const props = defineProps<{
  /** One measure's weeks, as the run's `work` sends them (spec §3). */
  series: WorkSeries
  /**
   * The weeks the chart lays out, the run's grid weeks (`workFrame`): a series week sits in its
   * place by its Monday, and a week the series has no entry for (before the activity was added,
   * after it ended) keeps its place with no column, so every chart lines up week for week.
   * Without it, the series's own weeks.
   */
  frame?: FrameWeek[]
  /** This week's Monday (the grid's current week), which sits on the band; null when none is. */
  current: string | null
  /** The chart's height in px: 300 for the whole programme, 200 for an activity (K180). */
  height: number
  /** The chart's name for a screen reader, and its table's caption. */
  label: string
}>()

/** The plot's margins: the value axis's unit above it, the week numbers under it. */
const T = 40
const B = 30
const R = 8
/** Columns sit at least this far apart; fewer and the plot scrolls sideways (K181). */
const MIN_PITCH = 18
/** A character's room at 16px, and the space kept between two labels. */
const CH = 9
const GAP = 8

const host = useTemplateRef<HTMLElement>('host')
const scroller = useTemplateRef<HTMLElement>('scroller')
const { width } = useElementSize(host)
/** Drawn at the chart's own width, so its text stays 16px (as ProgrammeChart, K145). */
const W = computed(() => Math.max(280, Math.round(width.value)))
const H = computed(() => props.height)
/** Each place on the plot: a frame week, and the series's entry for it, or null. */
type Slot = FrameWeek & { entry: WorkWeek | null }
const weeks = computed<Slot[]>(() => {
  const byMonday = new Map(props.series.weeks.map((w) => [w.monday, w]))
  return (props.frame ?? props.series.weeks).map((f) => ({
    monday: f.monday,
    programmeWeeks: f.programmeWeeks,
    entry: byMonday.get(f.monday) ?? null,
  }))
})
const entries = computed(() => weeks.value.flatMap((s, i) => (s.entry ? [{ i, w: s.entry }] : [])))
const n = computed(() => weeks.value.length)
const bottom = computed(() => H.value - B)
const now = computed(() => weeks.value.findIndex((w) => w.monday === props.current))

/** A step for about four gaps from nothing: 1, 2 or 5 times a power of ten. */
function niceStep(v: number): number {
  const power = 10 ** Math.floor(Math.log10(v || 1))
  const m = v / power
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * power
}

/** The value axis, from nothing (a column stands on it) to a step at or over the most. */
const axis = computed(() => {
  const top = Math.max(0, ...entries.value.map(({ w }) => Math.max(w.planned, w.done ?? 0)))
  const step = niceStep(top / 4)
  const max = Math.ceil(top / step) * step || step
  const count = Math.round(max / step)
  const ticks = Array.from({ length: count + 1 }, (_, k) => Number((k * step).toFixed(3)))
  return { max, ticks }
})
const y = (v: number) => T + (bottom.value - T) * (1 - v / axis.value.max)

/** The axis's width: room for its widest tick or its unit, and 16px beside it. */
const L = computed(() => {
  const words = [...axis.value.ticks.map(tickText), props.series.unit]
  return Math.max(44, Math.max(...words.map((t) => t.length)) * CH + 16)
})

/** The columns' pitch: shared out across the plot's width, or the least when they don't fit. */
const fit = computed(() => (W.value - L.value - R) / Math.max(n.value, 1))
const scroll = computed(() => fit.value < MIN_PITCH)
const pitch = computed(() => (scroll.value ? MIN_PITCH : fit.value))
/** The plot's own width: the box's, or every column's when it scrolls. */
const PW = computed(() => (scroll.value ? n.value * pitch.value + R : W.value - L.value))
const centre = (i: number) => i * pitch.value + pitch.value / 2

const columns = computed(() => {
  const bw = Math.min(44, Math.max(4, pitch.value * 0.56))
  return entries.value.map(({ i, w }) => {
    const bx = centre(i) - bw / 2
    return {
      i,
      w,
      bx,
      bw,
      future: w.done === null,
      planned:
        w.planned > 0
          ? { y: y(w.planned) + 0.75, h: Math.max(y(0) - y(w.planned) - 1.5, 0) }
          : null,
      done: w.done ? { y: y(w.done), h: y(0) - y(w.done) } : null,
    }
  })
})
const dash = computed(() => (pitch.value < 30 ? '4 3' : '5 4'))

const number = (w: FrameWeek) => w.programmeWeeks.join('/') || '–'
/** The numbers' rhythm: every week, or every second, third… so the widest stays clear of the next. */
const rhythm = computed(() => {
  const widest = Math.max(0, ...weeks.value.map((w) => number(w).length * CH))
  return { widest, every: Math.max(1, Math.ceil((widest + GAP) / pitch.value)) }
})
/**
 * The first number reads "Wk 1" when it has room before the next one shown; otherwise, and always
 * while the plot scrolls, "Wk" sits in the axis at the left of the numbers.
 */
const wkInAxis = computed(() => {
  if (scroll.value || !n.value) return true
  const first = (`Wk ${number(weeks.value[0]!)}`.length * CH + rhythm.value.widest) / 2
  return pitch.value * rhythm.value.every < first + GAP
})

/**
 * The week numbers under the plot, thinned to stay apart ("1, 4, 7…"). This week's always shows,
 * and a number that would touch it is left out (K181).
 */
const labels = computed(() => {
  const texts = weeks.value.map((w, i) =>
    i === 0 && !wkInAxis.value ? `Wk ${number(w)}` : number(w),
  )
  const room = (i: number) => texts[i]!.length * CH
  const every = rhythm.value.every
  const clear = (i: number) =>
    now.value < 0 ||
    Math.abs(centre(i) - centre(now.value)) >= (room(i) + room(now.value)) / 2 + GAP
  return texts.flatMap((text, i) =>
    i === now.value || (i % every === 0 && clear(i))
      ? [{ i, text, x: centre(i), width: room(i), current: i === now.value }]
      : [],
  )
})

/** How far the plot is scrolled, for the panel's place and the numbers in view. */
const scrolled = ref(0)

/** A scrolling plot leaves out a number its box's edge would cut, so "13" never reads "3". */
const shownLabels = computed(() => {
  if (!scroll.value) return labels.value
  const from = scrolled.value
  const to = from + W.value - L.value
  return labels.value.filter(
    (l) => l.current || (l.x - l.width / 2 >= from && l.x + l.width / 2 <= to),
  )
})

const band = computed(() => {
  if (now.value < 0) return null
  const inset = pitch.value >= 30 ? 2 : 1
  return { x: now.value * pitch.value + inset, width: pitch.value - 2 * inset }
})

// -- scrolling (K181): the plot opens with this week about two thirds across --

function openOnThisWeek(): void {
  const box = scroller.value!
  if (!scroll.value) {
    scrolled.value = 0
    return
  }
  // No week is this week: an ended run opens at its end, one still to start at its start.
  const begun = entries.value.some(({ w }) => w.done !== null)
  const at = now.value >= 0 ? now.value : begun ? n.value - 1 : 0
  box.scrollLeft = Math.max(0, centre(at) - (box.clientWidth * 2) / 3)
  scrolled.value = box.scrollLeft
}
onMounted(openOnThisWeek)
watch(() => `${scroll.value}|${now.value}|${n.value}|${width.value > 0}`, openOnThisWeek, {
  flush: 'post',
})

/** Keeps a week moved to with the arrows in view. */
function reveal(i: number): void {
  const box = scroller.value!
  if (!scroll.value) return
  const left = i * pitch.value
  if (left < box.scrollLeft) box.scrollLeft = left
  else if (left + pitch.value > box.scrollLeft + box.clientWidth)
    box.scrollLeft = left + pitch.value - box.clientWidth
  scrolled.value = box.scrollLeft
}

// -- the week whose numbers show: under the pointer, or chosen with the arrows --

const active = ref<number | null>(null)
/** The active week's entry: a week with none shows no panel. */
const shown = computed(() => (active.value === null ? null : weeks.value[active.value]!.entry))
const tipLeft = computed(() => {
  const at = L.value + centre(active.value ?? 0) - scrolled.value
  return Math.min(Math.max(at, 80), W.value - 80)
})

/** A week's done in words: "3,150 kg", "1,350 kg so far" this week; '' for a week to come. */
function doneText(w: WorkWeek, i: number): string {
  if (w.done === null) return ''
  return `${amountText(w.done, props.series.unit)}${i === now.value ? ' so far' : ''}`
}

function onFocus(): void {
  active.value = Math.max(now.value, 0)
  reveal(active.value)
}

function onKey(e: KeyboardEvent): void {
  const last = n.value - 1
  const moves: Record<string, number> = {
    ArrowLeft: Math.max(0, active.value! - 1),
    ArrowRight: Math.min(last, active.value! + 1),
    Home: 0,
    End: last,
  }
  if (!(e.key in moves)) return
  e.preventDefault()
  active.value = moves[e.key]!
  reveal(active.value)
}

const TEXT = 'text-[16px]'
</script>

<!--
  The WorkChart card's chart (K180, K181, work-charts spec §6): a column per week, outlined at the
  work planned (1.5px ink-secondary; dashed control-border for the weeks to come) and filled with
  pen up to the work done. This week sits on a tile band. The value axis is at the left with its
  unit above it, the week numbers under the plot, this week's in ink at 600. Columns sit at least
  18px apart: when they don't fit, the plot scrolls sideways inside itself, opening with this week
  about two thirds across, while the axis stays at the left. Week numbers thin out to stay apart,
  and this week's always shows. Pointing at a week, or focusing the chart and moving with the
  arrows, shows its numbers in a small panel; a screen reader reads every week in a hidden table.
  Nothing animates.
-->
<template>
  <div ref="host" class="relative w-full" data-slot="work-chart">
    <div class="flex">
      <svg
        :viewBox="`0 0 ${L} ${H}`"
        :width="L"
        :height="H"
        aria-hidden="true"
        class="block flex-none overflow-visible font-sans tabular-nums"
        data-axis
      >
        <text
          v-for="t in axis.ticks"
          :key="t"
          :x="L - 8"
          :y="y(t) + 5"
          text-anchor="end"
          :class="TEXT"
          class="fill-ink-secondary"
          data-tick
        >
          {{ tickText(t) }}
        </text>
        <text
          :x="L - 8"
          :y="T - 22"
          text-anchor="end"
          :class="TEXT"
          class="fill-ink-secondary"
          data-unit
        >
          {{ series.unit }}
        </text>
        <text
          v-if="wkInAxis"
          :x="L - 8"
          :y="H - 8"
          text-anchor="end"
          :class="TEXT"
          class="fill-ink-secondary"
          data-wk
        >
          Wk
        </text>
      </svg>
      <div
        ref="scroller"
        class="min-w-0 flex-1"
        :class="scroll && '[scrollbar-width:thin] overflow-x-auto overscroll-x-contain'"
        :data-scroll="scroll ? '' : undefined"
        data-testid="work-chart-plot"
        @scroll="scrolled = ($event.target as HTMLElement).scrollLeft"
      >
        <!-- Focus and the arrows only move the panel a keyboard user sees; a screen reader reads
             the table, which carries every number. -->
        <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
        <svg
          :viewBox="`0 0 ${PW} ${H}`"
          :width="PW"
          :height="H"
          role="img"
          :aria-label="label"
          tabindex="0"
          class="block rounded-sm font-sans tabular-nums focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
          :class="!scroll && 'overflow-visible'"
          data-testid="work-chart"
          @focus="onFocus"
          @blur="active = null"
          @keydown="onKey"
        >
          <rect
            v-if="band"
            :x="band.x"
            :y="T - 22"
            :width="band.width"
            :height="bottom - T + 22"
            :rx="pitch >= 30 ? 4 : 3"
            class="fill-tile"
            data-band
          />
          <line
            v-for="t in axis.ticks"
            :key="t"
            :x1="0"
            :x2="PW"
            :y1="y(t)"
            :y2="y(t)"
            class="stroke-line"
            data-rule
          />
          <template v-for="c in columns" :key="c.w.monday">
            <rect
              v-if="c.done"
              :x="c.bx"
              :y="c.done.y"
              :width="c.bw"
              :height="c.done.h"
              class="fill-pen"
              data-done
              :data-week="c.i"
            />
            <rect
              v-if="c.planned"
              :x="c.bx + 0.75"
              :y="c.planned.y"
              :width="c.bw - 1.5"
              :height="c.planned.h"
              stroke-width="1.5"
              class="fill-none"
              :class="c.future ? 'stroke-control-border' : 'stroke-ink-secondary'"
              :stroke-dasharray="c.future ? dash : undefined"
              data-planned
              :data-future="c.future ? '' : undefined"
              :data-week="c.i"
            />
          </template>
          <text
            v-for="l in shownLabels"
            :key="l.i"
            :x="l.x"
            :y="H - 8"
            text-anchor="middle"
            :class="[TEXT, l.current ? 'fill-ink font-semibold' : 'fill-ink-secondary']"
            data-label
            :data-current="l.current ? '' : undefined"
          >
            {{ l.text }}
          </text>
          <rect
            v-for="(s, i) in weeks"
            :key="s.monday"
            :x="i * pitch"
            :y="T - 22"
            :width="pitch"
            :height="bottom - T + 22"
            :class="active === i ? 'fill-ink/6' : 'fill-transparent'"
            data-hit
            @pointerenter="active = i"
            @pointerleave="active = null"
          />
        </svg>
      </div>
    </div>

    <!-- A screen reader's copy of the numbers. A table ignores a 1px width of its own, so the box
         carries the hiding (WorkChart card). -->
    <div class="sr-only">
      <table data-testid="work-chart-table">
        <caption>
          {{
            label
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            <th scope="col">Planned</th>
            <th scope="col">Done</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="{ i, w } in entries" :key="w.monday">
            <th scope="row">{{ weekName(w) }}, {{ weekDates(w.monday) }}</th>
            <td>{{ amountText(w.planned, series.unit) }}</td>
            <td>{{ doneText(w, i) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- The numbers for the week pointed at: the Popover's skin, for a pointer only. -->
    <div
      :hidden="!shown"
      aria-hidden="true"
      class="pointer-events-none absolute z-[5] -translate-x-1/2 -translate-y-full rounded-sm border border-line bg-panel px-2.5 py-2 text-[16px] leading-[22px] whitespace-nowrap text-ink shadow-overlay"
      :style="{ left: `${tipLeft}px`, top: `${T + 28}px` }"
      data-testid="work-chart-tip"
    >
      <template v-if="shown"
        ><b class="font-semibold">{{ weekName(shown) }}</b> · {{ weekDates(shown.monday)
        }}<span class="block text-ink-secondary"
          >Planned {{ amountText(shown.planned, series.unit) }}</span
        ><span v-if="shown.done !== null" class="block text-ink-secondary"
          >Done {{ doneText(shown, active!) }}</span
        ></template
      >
    </div>
  </div>
</template>
