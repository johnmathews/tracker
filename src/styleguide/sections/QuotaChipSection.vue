<script setup lang="ts">
import { QuotaChip } from '@/components/ui/quota-chip'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'

/** Every count the card shows (components/QuotaChip/preview.html), out of the default 30. */
const COUNTS = [27, 4, 3, 2, 1, 0]
</script>

<!-- The card's counts: figures above three, words from three down, ink at none left. -->
<template>
  <ExampleGroup title="Every count">
    <StateExample v-for="n in COUNTS" :key="n" :state="n === 0 ? 'None left' : `${n} left`">
      <QuotaChip :id="`sg-quota-chip-${n}`" :remaining="n" :limit="30" />
    </StateExample>
  </ExampleGroup>
</template>
