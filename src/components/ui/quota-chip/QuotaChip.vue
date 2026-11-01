<script setup lang="ts">
import { computed } from 'vue'
import { Chip } from '@/components/ui/chip'
import { questionsLeft } from '.'

const props = defineProps<{
  /** Questions left today, from the server. */
  remaining: number
  /** The day's allowance; `remaining` is held between 0 and it. */
  limit: number
}>()

const words = computed(() => questionsLeft(props.remaining, props.limit))
const left = computed(() => Math.max(0, Math.min(Math.floor(props.remaining), props.limit)))
</script>

<!--
  How many questions are left today (brand/design-system/project/components/QuotaChip): a Chip,
  always shown under the question box. At none left the words are ink, so the count that stops
  you reads first; never error-ink or caution-ink, since the day's limit is not a fault. Not a
  live region: the answer and its progress are what is announced.
-->
<template>
  <Chip :data-left="left" class="py-0.5">
    <span :class="left === 0 ? 'text-ink' : undefined">{{ words }}</span>
  </Chip>
</template>
