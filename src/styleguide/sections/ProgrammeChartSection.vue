<script setup lang="ts">
import { ProgrammeChart, activityChart } from '@/components/ui/programme-chart'
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
      'Deadlift: paused for two weeks from Mon 14 Dec (knee), so the line has a gap, and it ends at its week 6 of 8.',
    chart: activityChart(RUN, 'deadlift')!,
  },
]
</script>

<!-- The card's charts, drawn by the app's own ProgrammeChart from the example run
     (programmeExamples.ts): today Wed 16 Dec, in week 4. The Programme row round it on the item
     page (the lede, the ends-short line and the activity's controls) is ItemProgramme's, not the
     chart's. -->
<template>
  <ExampleGroup>
    <StateExample v-for="c in CHARTS" :key="c.id" :state="c.state" class="w-full">
      <div class="w-full max-w-200">
        <ProgrammeChart :id="c.id" :chart="c.chart" />
      </div>
    </StateExample>
  </ExampleGroup>
</template>
