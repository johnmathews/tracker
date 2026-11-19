<script setup lang="ts">
import { ProgrammeChart, ProgrammeLede, activityChart } from '@/components/ui/programme-chart'
import type { Run } from '@/lib/programmes'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'
import { RUN } from './programmeExamples'

/** The card's two activities (components/ProgrammeChart/preview.html), from the example run. */
const CHARTS = [
  {
    id: 'sg-programme-chart-squat-running',
    state:
      'Back squat: this week is a deload, and its increase went from 5% to 7.5% a week on Thu 3 Dec. Focus the chart and use the arrows, or point at a week, for its numbers.',
    chart: activityChart(RUN, 'squat')!,
  },
  {
    id: 'sg-programme-chart-deadlift-paused',
    state:
      'Deadlift: paused for two weeks from Mon 14 Dec (knee), so the line has a gap, and it ends at its week 6 of 8. The lede leads with “Paused until Mon 28 Dec.” in paused-ink at 600 (K169).',
    chart: activityChart(RUN, 'deadlift')!,
  },
]

/** Deadlift paused with no end day: its lede leads with "Paused." alone (K169). */
const OPEN_ENDED: Run = structuredClone(RUN)
;(OPEN_ENDED.clock.activities as Record<string, { until: string | null }>).deadlift!.until = null
const OPEN_LEDE = activityChart(OPEN_ENDED, 'deadlift')!.lede
</script>

<!-- The card's charts, drawn by the app's own ProgrammeChart from the example run
     (programmeExamples.ts): today Wed 16 Dec, in week 4. Each has the lede over it, as the item
     page's Programme row (ItemProgramme) shows it; the ends-short line and the activity's controls
     are ItemProgramme's, not the chart's. -->
<template>
  <ExampleGroup>
    <StateExample v-for="c in CHARTS" :key="c.id" :state="c.state" class="w-full">
      <div :id="c.id" class="flex w-full max-w-200 flex-col gap-5">
        <ProgrammeLede :lede="c.chart.lede" />
        <ProgrammeChart :chart="c.chart" />
      </div>
    </StateExample>
    <StateExample
      state="Deadlift paused with no end day: the lede leads with “Paused.” in paused-ink at 600, and the value comes back when you resume it (K169)."
      class="w-full"
    >
      <ProgrammeLede id="sg-programme-chart-lede-open" :lede="OPEN_LEDE" />
    </StateExample>
  </ExampleGroup>
</template>
