<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import { useElementSize, useMediaQuery } from '@vueuse/core'
import { FOLDED } from '@/components/ui/programme-grid'
import type { ActivityChart, ChartWeek } from './chart'

const props = defineProps<{
  /** The activity's weeks, as the run's grid has them (`activityChart`). */
  chart: ActivityChart
}>()

/** The plot's margins: the value axis at the left, change labels above, week numbers below. */
const L = 44
const R = 8
const T = 40
const B = 34

const host = useTemplateRef<HTMLElement>('host')
const { width } = useElementSize(host)
const folded = useMediaQuery(FOLDED)
/** Drawn at the chart's own width, so its text stays 16px at every size (K145). */
const W = computed(() => Math.max(280, Math.round(width.value)))
const H = computed(() => (folded.value ? 240 : 290))
const n = computed(() => props.chart.weeks.length)
const cw = computed(() => (W.value - L - R) / n.value)
const bottom = computed(() => H.value - B)
const x = (i: number) => L + i * cw.value

/** A step for about three gaps across the values: 1, 2, 2.5 or 5 times a power of ten. */
function niceStep(span: number): number {
  const raw = span / 3
  const power = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw)!
}

/** The value axis: from a step under the lowest value to a little over the highest. */
const axis = computed(() => {
  const values = props.chart.weeks.flatMap((w) => w.segments.map((s) => s.value))
  if (!values.length) return { lo: 0, hi: 10, ticks: [0, 5, 10] }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const step = niceStep(max - min || max || 1)
  const lo = Math.max(0, Math.floor((min - step / 2) / step) * step)
  const hi = Math.ceil((max + step / 4) / step) * step
  const count = Math.round((hi - lo) / step)
  const ticks = Array.from({ length: count + 1 }, (_, k) => Number((lo + k * step).toFixed(2)))
  return { lo, hi, ticks }
})
const y = (v: number) =>
  T + (bottom.value - T) * (1 - (v - axis.value.lo) / (axis.value.hi - axis.value.lo))

/** The step line over weeks `from` to `to`, broken where a week has nothing to draw. */
function line(from: number, to: number): string {
  let d = ''
  let joined = false
  for (let i = from; i <= to; i++) {
    const segs = props.chart.weeks[i]!.segments
    if (!segs.length) {
      joined = false
      continue
    }
    segs.forEach((s, j) => {
      d += joined ? `V${y(s.value)}` : `M${x(i + s.from)} ${y(s.value)}`
      d += `H${x(i + (segs[j + 1]?.from ?? 1))}`
      joined = true
    })
  }
  return d
}

const now = computed(() => props.chart.now)
/** Solid up to the end of this week. */
const done = computed(() => (now.value >= 0 ? line(0, Math.min(now.value, n.value - 1)) : ''))
/** Dashed after it, the step up into next week drawn once. */
const ahead = computed(() => {
  const rest = line(now.value + 1, n.value - 1)
  const here = props.chart.weeks[now.value]?.value
  const next = props.chart.weeks[now.value + 1]?.segments[0]?.value
  const step =
    here != null && next !== undefined ? `M${x(now.value + 1)} ${y(here)}V${y(next)}` : ''
  return step + rest
})
const band = computed(() => props.chart.weeks[now.value]?.current === true)

/** This week's value and the last week's, written over the line. */
const written = computed(() =>
  [...new Set([now.value, n.value - 1])]
    .filter((i) => i >= 0 && props.chart.weeks[i]!.value !== null)
    .map((i) => ({ i, value: props.chart.weeks[i]!.value! })),
)

const dots = computed(() =>
  props.chart.weeks.flatMap((w, i) =>
    w.done && w.value !== null
      ? [{ i, cx: x(i) + cw.value / 2, cy: y(w.value), met: w.done.met, count: w.doneText }]
      : [],
  ),
)

/** A change's label sits right of its line, or left when it would run off the chart. */
const changes = computed(() =>
  props.chart.changes.map((c) => {
    const cx = x(c.at)
    const left = cx + 6 + c.label.length * 8.2 > W.value
    return { ...c, cx, tx: left ? cx - 6 : cx + 6, anchor: left ? 'end' : 'start' }
  }),
)

/** A week's plan for the table and the panel: a deload says so. */
function planOf(w: ChartWeek): string {
  return w.label && w.state === 'running' ? `${w.plan}, ${w.label.toLowerCase()}` : w.plan
}

/** The week whose numbers show: under the pointer, or chosen with the arrows. */
const active = ref<number | null>(null)
const shown = computed(() => (active.value === null ? null : props.chart.weeks[active.value]!))
const tipLeft = computed(() => {
  const centre = x(active.value ?? 0) + cw.value / 2
  return Math.min(Math.max(centre, 80), W.value - 80)
})

function onFocus(): void {
  active.value = Math.max(now.value, 0)
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
}

const TEXT = 'text-[16px]'
</script>

<!--
  The ProgrammeChart card's chart (K145, spec §9.4): the legend, then a step chart of an activity's
  planned value week by week, drawn at its own width so its text stays 16px. The line is solid in
  ink to the end of this week, dashed in ink-secondary after it; a pause leaves a gap with its
  reason; a change is a labelled dashed line where it took effect; each week done so far has a dot
  at its value, pen when it met its goal and a ring with its count when it didn't. Pointing at a
  week, or focusing the chart and moving with the arrows, shows its numbers in a small panel. A
  screen reader reads the same numbers in a table in a visually hidden box. Nothing animates.
-->
<template>
  <div class="flex flex-col gap-3" data-slot="programme-chart">
    <ul
      class="m-0 flex list-none flex-wrap gap-x-[18px] gap-y-1 p-0 text-(length:--set-caption) leading-[1.4] text-ink-secondary"
      data-testid="programme-chart-legend"
    >
      <li class="inline-flex items-center gap-2">
        <svg viewBox="0 0 22 12" class="h-3 w-[22px] overflow-visible" aria-hidden="true">
          <path d="M1 6h20" class="stroke-ink stroke-2" />
        </svg>
        Planned
      </li>
      <li class="inline-flex items-center gap-2">
        <svg viewBox="0 0 22 12" class="h-3 w-[22px] overflow-visible" aria-hidden="true">
          <path d="M1 6h20" class="stroke-ink-secondary stroke-2 [stroke-dasharray:6_5]" />
        </svg>
        Still to come
      </li>
      <li class="inline-flex items-center gap-2">
        <svg viewBox="0 0 22 12" class="h-3 w-[22px] overflow-visible" aria-hidden="true">
          <circle cx="11" cy="6" r="6" class="fill-pen" />
        </svg>
        Goal met
      </li>
      <li class="inline-flex items-center gap-2">
        <svg viewBox="0 0 22 12" class="h-3 w-[22px] overflow-visible" aria-hidden="true">
          <circle cx="11" cy="6" r="5" class="fill-canvas stroke-ink-secondary stroke-2" />
        </svg>
        Goal not met
      </li>
    </ul>

    <div ref="host" class="relative w-full">
      <!-- Focus and the arrows only move the panel a keyboard user sees; a screen reader reads
           the table, which carries every number. -->
      <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
      <svg
        :viewBox="`0 0 ${W} ${H}`"
        :width="W"
        :height="H"
        role="img"
        :aria-label="chart.label"
        tabindex="0"
        class="block h-auto w-full overflow-visible rounded-sm font-sans tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        data-testid="programme-chart"
        @focus="onFocus"
        @blur="active = null"
        @keydown="onKey"
      >
        <rect
          v-if="band"
          :x="x(now)"
          :y="T - 6"
          :width="cw"
          :height="bottom - T + 6"
          rx="4"
          class="fill-tile"
          data-band
        />
        <template v-for="t in axis.ticks" :key="t">
          <line :x1="L" :x2="W - R" :y1="y(t)" :y2="y(t)" class="stroke-line" />
          <text
            :x="L - 8"
            :y="y(t) + 5"
            text-anchor="end"
            :class="TEXT"
            class="fill-ink-secondary"
            data-tick
          >
            {{ t }}
          </text>
        </template>
        <text
          :x="L - 8"
          :y="T - 18"
          text-anchor="end"
          :class="TEXT"
          class="fill-ink-secondary"
          data-unit
        >
          {{ chart.unit }}
        </text>
        <text
          v-for="(w, i) in chart.weeks"
          :key="w.monday"
          :x="x(i) + cw / 2"
          :y="H - 8"
          text-anchor="middle"
          :class="[TEXT, w.current ? 'fill-ink font-semibold' : 'fill-ink-secondary']"
          data-week
          :data-current="w.current ? '' : undefined"
        >
          {{ w.number }}
        </text>
        <text :x="L - 8" :y="H - 8" text-anchor="end" :class="TEXT" class="fill-ink-secondary">
          Wk
        </text>

        <path
          v-if="done"
          :d="done"
          class="fill-none stroke-ink stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
          data-plan="done"
        />
        <path
          v-if="ahead"
          :d="ahead"
          class="fill-none stroke-ink-secondary stroke-2 [stroke-dasharray:6_5] [stroke-linejoin:round]"
          data-plan="ahead"
        />

        <template v-for="c in changes" :key="c.at">
          <line
            :x1="c.cx"
            :x2="c.cx"
            :y1="T - 26"
            :y2="bottom"
            class="stroke-control-border [stroke-dasharray:3_3]"
            data-change
          />
          <text
            :x="c.tx"
            :y="T - 14"
            :text-anchor="c.anchor"
            :class="TEXT"
            class="fill-ink font-semibold"
            data-change
          >
            {{ c.label }}
          </text>
        </template>

        <template v-for="p in chart.pauses" :key="p.from">
          <line
            v-for="edge in [p.from, p.to + 1]"
            :key="edge"
            :x1="x(edge)"
            :x2="x(edge)"
            :y1="T - 6"
            :y2="bottom"
            class="stroke-control-border [stroke-dasharray:3_3]"
            data-pause
          />
          <!-- The words need room: a gap narrower than "Paused" leaves them to the lede, the
               table and the panel. -->
          <text
            v-if="x(p.to + 1) - x(p.from) >= 64"
            :x="(x(p.from) + x(p.to + 1)) / 2"
            :y="(T + bottom) / 2 - 4"
            text-anchor="middle"
            :class="TEXT"
            class="fill-ink-secondary"
            data-pause
          >
            Paused
          </text>
          <text
            v-if="p.reason && x(p.to + 1) - x(p.from) >= 64"
            :x="(x(p.from) + x(p.to + 1)) / 2"
            :y="(T + bottom) / 2 + 16"
            text-anchor="middle"
            :class="TEXT"
            class="fill-ink-secondary"
            data-pause
          >
            {{ p.reason }}
          </text>
        </template>

        <template v-for="d in dots" :key="d.i">
          <circle
            v-if="d.met"
            :cx="d.cx"
            :cy="d.cy"
            r="7"
            class="fill-pen stroke-canvas stroke-2"
            data-met
          />
          <template v-else>
            <circle
              :cx="d.cx"
              :cy="d.cy"
              r="6"
              class="fill-canvas stroke-ink-secondary stroke-2"
              data-unmet
            />
            <text
              :x="d.cx"
              :y="d.cy + 26"
              text-anchor="middle"
              :class="TEXT"
              class="fill-ink-secondary"
              data-count
            >
              {{ d.count.replace(' so far', '') }}
            </text>
          </template>
        </template>

        <text
          v-for="v in written"
          :key="v.i"
          :x="x(v.i) + cw / 2"
          :y="y(v.value) - 12"
          text-anchor="middle"
          :class="TEXT"
          class="fill-ink font-semibold"
          data-value
        >
          {{ v.value }}
        </text>

        <rect
          v-for="(w, i) in chart.weeks"
          :key="w.monday"
          :x="x(i)"
          :y="T - 6"
          :width="cw"
          :height="bottom - T + 6"
          :class="active === i ? 'fill-ink/6' : 'fill-transparent'"
          data-hit
          @pointerenter="active = i"
          @pointerleave="active = null"
        />
      </svg>

      <!-- A screen reader's copy of the numbers. A table ignores a 1px width of its own, so the
           box carries the hiding (ProgrammeChart card). -->
      <div class="sr-only">
        <table data-testid="programme-chart-table">
          <caption>
            {{
              chart.name
            }}, week by week
          </caption>
          <thead>
            <tr>
              <th scope="col">Week</th>
              <th scope="col">Planned</th>
              <th scope="col">Done</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="w in chart.weeks" :key="w.monday">
              <th scope="row">{{ w.name }}, {{ w.dates }}</th>
              <td>{{ planOf(w) }}</td>
              <td>{{ w.doneText }}</td>
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
        data-testid="programme-chart-tip"
      >
        <template v-if="shown"
          ><b class="font-semibold">{{ shown.name }}</b> · {{ shown.dates
          }}<span class="block text-ink-secondary">{{ planOf(shown) }}</span
          ><span v-if="shown.doneText" class="block text-ink-secondary">{{
            shown.doneText
          }}</span></template
        >
      </div>
    </div>
  </div>
</template>
