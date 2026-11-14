<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { TabsList } from 'reka-ui'
import { cn } from '@/lib/utils'
import { tabsListVariants } from '.'

const props = defineProps<{
  /** Classes for the bar: a page's own sizes (the gap between tabs). */
  class?: HTMLAttributes['class']
}>()

defineSlots<{
  /** The TabsTriggers, in order. */
  default: () => unknown
}>()
</script>

<!-- The bar: a role="tablist". Give it a name, the page's <h1> by aria-labelledby or an
     aria-label; it falls through to the list. Arrow keys, Home and End move between the tabs. -->
<template>
  <TabsList data-slot="tabs-list" :class="cn(tabsListVariants(), props.class)">
    <slot />
  </TabsList>
</template>
