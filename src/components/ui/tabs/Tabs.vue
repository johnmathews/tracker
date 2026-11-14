<!-- eslint-disable vue/multi-word-component-names -- shadcn-vue's name; it lives in components/ui/ -->
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { TabsRoot } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<{
  /** Classes for the wrapper, for layout. */
  class?: HTMLAttributes['class']
}>()

/** The open tab's value. */
const model = defineModel<string>({ required: true })

defineSlots<{
  /** A TabsList of TabsTriggers, then a TabsContent per tab. */
  default: () => unknown
}>()
</script>

<!-- Tabs (brand/design-system/project/components/Tabs) on Reka UI's TabsRoot, with automatic
     activation: a tab opens as focus reaches it. Only the open tab's TabsContent renders. -->
<template>
  <TabsRoot
    v-model="model"
    activation-mode="automatic"
    data-slot="tabs"
    :class="cn('flex flex-col', props.class)"
  >
    <slot />
  </TabsRoot>
</template>
