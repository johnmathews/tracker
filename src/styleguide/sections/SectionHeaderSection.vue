<script setup lang="ts">
import { SectionHeader } from '@/components/ui/section-header'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'
</script>

<!-- The card's headers (components/SectionHeader/preview.html), in its copy. The week is the
     page's title, fixed above the planner's screens (K88), so a header has none. -->
<template>
  <ExampleGroup layout="grid">
    <StateExample state="Exercises" class="w-full">
      <SectionHeader
        id="sg-section-header-exercises"
        class="w-full"
        title="Exercises"
        heading-id="sg-section-header-exercises-title"
      />
    </StateExample>
    <StateExample state="With a hint" class="w-full">
      <SectionHeader
        id="sg-section-header-hint"
        class="w-full"
        title="Food"
        heading-id="sg-section-header-hint-title"
        hint="Mark each day you ate it."
      />
    </StateExample>
  </ExampleGroup>
</template>
