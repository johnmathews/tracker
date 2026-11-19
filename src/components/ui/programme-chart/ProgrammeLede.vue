<script setup lang="ts">
import { LEDE } from '@/lib/itemPage'
import type { ActivityChart } from './chart'

defineProps<{
  /** The chart's lede (`activityChart(...).lede`): its words, its value and a pause's lead. */
  lede: ActivityChart['lede']
}>()
</script>

<!--
  The line over the chart in an activity's Programme row (ProgrammeChart card, K145): in
  ink-secondary, its value in ink at 600. A pause leads with its own sentence, "Paused until Mon 28
  Dec." or "Paused.", in paused-ink at 600, as the grid and the week view say it (K169).
-->
<template>
  <p :class="LEDE">
    <span
      v-if="lede.lead"
      class="font-semibold text-paused-ink"
      data-testid="programme-lede-lead"
      >{{ lede.lead }}</span
    >{{ lede.before }}<b v-if="lede.value" class="font-semibold text-ink">{{ lede.value }}</b
    >{{ lede.after }}
  </p>
</template>
