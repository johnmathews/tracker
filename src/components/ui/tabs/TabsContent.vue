<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { TabsContent } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<{
  /** The value of the tab that shows this part. */
  value: string
  /** Classes for the part, for layout. */
  class?: HTMLAttributes['class']
}>()

defineSlots<{
  /** The part: rendered only while its tab is open. */
  default: () => unknown
}>()
</script>

<!-- One tab's part: a role="tabpanel" labelled by its tab, rendered only while that tab is open. -->
<template>
  <TabsContent :value="value" data-slot="tabs-content" :class="cn('min-w-0', props.class)">
    <slot />
  </TabsContent>
</template>
