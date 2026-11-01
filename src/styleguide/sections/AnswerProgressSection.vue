<script setup lang="ts">
import { AnswerProgress } from '@/components/ui/answer-progress'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'
</script>

<!-- The card's states (components/AnswerProgress/preview.html). The strokes stand still when the
     system asks for reduced motion; there is no other switch. -->
<template>
  <ExampleGroup>
    <StateExample state="Moving (still under reduced motion)">
      <AnswerProgress id="sg-answer-progress-default" />
    </StateExample>
    <StateExample state="Other words">
      <AnswerProgress id="sg-answer-progress-label" label="Reading your goals…" />
    </StateExample>
  </ExampleGroup>
</template>
