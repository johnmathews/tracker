<script setup lang="ts">
import { computed } from 'vue'
import type { Work } from '@/lib/programmes'
import { activityTitle, chartLabel, leftOutLine, workLine, type FrameWeek } from '@/lib/work'
import { WorkChart, WorkLegend } from '@/components/ui/work-chart'

const props = defineProps<{
  /** The run's work (K179, spec §3). */
  work: Work
  /** The run's grid weeks (`workFrame`), which every chart lays its weeks on. */
  frame: FrameWeek[]
  /** This week's Monday in the run's grid (`currentMonday`), or null when no week is. */
  current: string | null
}>()

const work = computed(() => props.work)
const current = computed(() => props.current)
const total = computed(() =>
  work.value.total
    ? {
        series: work.value.total,
        line: workLine(work.value.total, current.value, true),
        leftOut: leftOutLine(work.value.total.leftOut),
      }
    : null,
)
const activities = computed(() =>
  work.value.activities.map((a) => ({
    a,
    title: activityTitle(a),
    label: chartLabel(a.name, a.measure),
    line: workLine(a, current.value, a.measure === 'work'),
  })),
)

const HEADING =
  'text-[max(18px,calc(var(--u)*22))] leading-[1.3] font-semibold text-ink folded:text-[calc(var(--n)*20)]'
const LINE = 'body text-(length:--set-text) leading-[1.45] text-ink-secondary'
const CAPTION = 'caption text-(length:--set-caption) leading-[1.35] text-ink-secondary'
</script>

<!--
  The overview's Work tab (K180, option 2A; WorkChart card): "The whole programme" with its line,
  the legend, the total's chart (300px) and the line naming what it leaves out; then "By activity",
  a chart (200px) per activity with its name and line, two to a row, one folded. With no weighted
  activity there is no total, and the tab starts at "By activity" with the legend under it.
-->
<template>
  <div class="flex min-w-0 flex-col gap-3 pt-4" data-testid="programme-work">
    <template v-if="total">
      <h2 :class="HEADING">The whole programme</h2>
      <p :class="LINE" data-testid="work-total-line">
        {{ total.line.before }}<b class="font-semibold text-ink">{{ total.line.value }}</b
        >{{ total.line.after }}
      </p>
      <WorkLegend />
      <WorkChart
        :series="total.series"
        :frame="frame"
        :current="current"
        :height="300"
        :label="chartLabel('The whole programme', 'work')"
        data-testid="work-total"
      />
      <p v-if="total.leftOut" :class="CAPTION" data-testid="work-left-out">{{ total.leftOut }}</p>
    </template>
    <h2
      :class="[HEADING, total && 'mt-[calc(var(--u)*28)] border-t border-line pt-5']"
      data-testid="work-by-activity"
    >
      By activity
    </h2>
    <WorkLegend v-if="!total" />
    <ul class="m-0 grid list-none grid-cols-2 gap-x-8 gap-y-7 p-0 folded:grid-cols-1">
      <li
        v-for="{ a, title, label, line } in activities"
        :key="a.key"
        class="flex min-w-0 flex-col gap-1.5"
        data-testid="work-activity"
        :data-activity="a.key"
      >
        <h3 class="label text-(length:--set-label) leading-[1.3] font-semibold text-ink">
          {{ title }}
        </h3>
        <p :class="CAPTION" data-testid="work-activity-line">
          {{ line.before }}<b class="font-semibold text-ink">{{ line.value }}</b
          >{{ line.after }}
        </p>
        <WorkChart :series="a" :frame="frame" :current="current" :height="200" :label="label" />
      </li>
    </ul>
  </div>
</template>
