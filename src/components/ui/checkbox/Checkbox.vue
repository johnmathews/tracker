<!-- eslint-disable vue/multi-word-component-names -- shadcn-vue's name; it lives in components/ui/ -->
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { CheckboxIndicator, CheckboxRoot } from 'reka-ui'
import { Check } from '@lucide/vue'
import { cn } from '@/lib/utils'
import { checkboxBoxVariants, checkboxVariants } from '.'

const props = withDefaults(
  defineProps<{
    /** Names the thing that is ticked ("Back squat"), visibly and as the accessible name. */
    label: string
    /** Only when the choice truly cannot change here. */
    disabled?: boolean
    class?: HTMLAttributes['class']
  }>(),
  { disabled: false, class: undefined },
)

const model = defineModel<boolean>({ required: true })

// Reka's checkbox can also be 'indeterminate'; this one is ticked or not.
function onChecked(value: boolean | 'indeterminate'): void {
  model.value = value === true
}
</script>

<!--
  A box to tick with its label in one row (brand/design-system/project/components/Checkbox), for a
  choice inside a form with a Save. Built on Reka UI's Checkbox: the row is a role="checkbox"
  button with aria-checked, named by its label; Space ticks it.
-->
<template>
  <CheckboxRoot
    :model-value="model"
    data-slot="checkbox"
    :disabled="disabled"
    :class="cn(checkboxVariants(), props.class)"
    @update:model-value="onChecked"
  >
    <span data-slot="checkbox-box" aria-hidden="true" :class="checkboxBoxVariants()">
      <CheckboxIndicator data-slot="checkbox-tick" class="flex text-on-ink">
        <Check :size="16" :stroke-width="3" />
      </CheckboxIndicator>
    </span>
    <span data-slot="checkbox-label">{{ label }}</span>
  </CheckboxRoot>
</template>
