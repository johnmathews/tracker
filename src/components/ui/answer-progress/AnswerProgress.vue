<script setup lang="ts">
import { cn } from '@/lib/utils'
import { STROKE, STROKE_DELAYS } from '.'

withDefaults(
  defineProps<{
    /** What is happening, as a fact. */
    label?: string
  }>(),
  { label: 'Reading your weeks…' },
)
</script>

<!--
  An answer on its way (brand/design-system/project/components/AnswerProgress): the pen's three
  strokes, then the words in ink-secondary at the page's label size. Only the strokes move, and
  they stand still under reduced motion; the words never fade. role="status" reads them once.
-->
<template>
  <span
    data-slot="answer-progress"
    role="status"
    class="inline-flex items-center gap-[calc(var(--u)*10)] text-[max(16px,calc(var(--u)*17))] leading-snug text-ink-secondary"
  >
    <span data-pen aria-hidden="true" class="inline-flex gap-1">
      <span v-for="delay in STROKE_DELAYS" :key="delay" :class="cn(STROKE, delay)" />
    </span>
    {{ label }}
  </span>
</template>
