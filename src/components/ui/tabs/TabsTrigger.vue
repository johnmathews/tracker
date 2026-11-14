<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { TabsTrigger } from 'reka-ui'
import { cn } from '@/lib/utils'
import { tabsTriggerVariants } from '.'

const props = defineProps<{
  /** The tab's value, the same as its TabsContent's. */
  value: string
  /** Classes for the tab: a page's own text size. */
  class?: HTMLAttributes['class']
}>()

defineSlots<{
  /** The tab's name, in sentence case: the same words as its part's heading. */
  default: () => unknown
}>()
</script>

<template>
  <TabsTrigger
    :value="value"
    data-slot="tabs-trigger"
    :class="cn(tabsTriggerVariants(), props.class)"
  >
    <slot />
  </TabsTrigger>
</template>
