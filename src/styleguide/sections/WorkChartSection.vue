<script setup lang="ts">
import { WorkChart, WorkLegend } from '@/components/ui/work-chart'
import { chartLabel, workLine } from '@/lib/work'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'
import { LONG_THIS_WEEK, LONG_TOTAL, PLANK, THIS_WEEK, TOTAL } from './workExamples'

/** The card's three charts (components/WorkChart/preview.html), each with its line over it. */
const CHARTS = [
  {
    id: 'sg-work-chart-total-running',
    state:
      'The whole programme, 300px: eight weeks, in week 4. Weeks 1 to 3 outlined and filled to the work done, this week on the band with its work so far, the weeks to come dashed. Point at a week, or focus the chart and use the arrows, for its numbers.',
    series: TOTAL,
    current: THIS_WEEK,
    height: 300,
    label: chartLabel('The whole programme', 'work'),
    line: workLine(TOTAL, THIS_WEEK, true),
  },
  {
    id: 'sg-work-chart-activity-seconds',
    state:
      'An activity without weight, 200px: Plank counts seconds held, from week 2, and its line leaves out the total so far.',
    series: PLANK,
    current: THIS_WEEK,
    height: 200,
    label: chartLabel('Plank', 'seconds'),
    line: workLine(PLANK, THIS_WEEK, false),
  },
  {
    id: 'sg-work-chart-long-scrolling',
    state:
      'A long programme (K181): 104 weeks, in week 40. A column per week, 18px apart; the plot scrolls sideways inside itself and opens with this week about two thirds across, while the axis stays at the left. The week numbers thin out, and this week’s always shows.',
    series: LONG_TOTAL,
    current: LONG_THIS_WEEK,
    height: 300,
    label: chartLabel('Two-year strength', 'work'),
    line: workLine(LONG_TOTAL, LONG_THIS_WEEK, true),
  },
]
</script>

<!-- The card's charts, drawn by the app's own WorkChart from the examples (workExamples.ts), each
     with the line and the legend the overview's Work tab puts over it. -->
<template>
  <ExampleGroup>
    <StateExample v-for="c in CHARTS" :key="c.id" :state="c.state" class="w-full">
      <div :id="c.id" class="flex w-full max-w-200 flex-col gap-3">
        <p class="body text-ink-secondary">
          {{ c.line.before }}<b class="font-semibold text-ink">{{ c.line.value }}</b
          >{{ c.line.after }}
        </p>
        <WorkLegend />
        <WorkChart :series="c.series" :current="c.current" :height="c.height" :label="c.label" />
      </div>
    </StateExample>
  </ExampleGroup>
</template>
