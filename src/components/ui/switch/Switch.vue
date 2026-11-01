<!-- eslint-disable vue/multi-word-component-names -- shadcn-vue's name; it lives in components/ui/ -->
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { SwitchRoot, SwitchThumb } from 'reka-ui'
import { cn } from '@/lib/utils'
import { switchThumbVariants, switchTrackVariants, switchVariants } from '.'

const props = withDefaults(
  defineProps<{
    /** Names the thing that is on ("Edit plan"), visibly and as the accessible name. */
    label: string
    /** A shorter visible label below 640px ("Edit"); the accessible name stays `label`. */
    shortLabel?: string
    /**
     * Words after the label for screen readers only, naming the row it belongs to: label "Show",
     * context "Notes" reads "Show Notes" (the item page's arranging, K66).
     */
    context?: string
    /** Only when the setting truly cannot change. */
    disabled?: boolean
    class?: HTMLAttributes['class']
  }>(),
  { shortLabel: undefined, context: undefined, disabled: false, class: undefined },
)

const model = defineModel<boolean>({ required: true })
</script>

<template>
  <SwitchRoot
    v-model="model"
    data-slot="switch"
    :disabled="disabled"
    :aria-label="shortLabel ? label : undefined"
    :class="cn(switchVariants(), props.class)"
  >
    <template v-if="shortLabel">
      <span data-slot="switch-short-label" aria-hidden="true" class="sm:hidden">
        {{ shortLabel }}
      </span>
      <span data-slot="switch-label" class="max-sm:hidden">{{ label }}</span>
    </template>
    <span v-else data-slot="switch-label"
      >{{ label
      }}<span v-if="context" data-slot="switch-context" class="sr-only">{{
        ` ${context}`
      }}</span></span
    >
    <span data-slot="switch-track" aria-hidden="true" :class="switchTrackVariants()">
      <SwitchThumb data-slot="switch-thumb" :class="switchThumbVariants()" />
    </span>
  </SwitchRoot>
</template>
