<script setup lang="ts">
import { computed } from 'vue'
import { SegmentedControl } from '@/components/ui/segmented-control'

const perSide = defineModel<boolean>({ required: true })
// The Dialog card's words; the chip under the exercise then reads "8 each side".
const OPTIONS = [
  { value: 'per-set', label: 'Per set' },
  { value: 'each-side', label: 'Each side' },
]

const choice = computed({
  get: () => (perSide.value ? 'each-side' : 'per-set'),
  set: (value: string) => (perSide.value = value === 'each-side'),
})
</script>

<template>
  <SegmentedControl v-model="choice" label="Sides" :options="OPTIONS" />
</template>
