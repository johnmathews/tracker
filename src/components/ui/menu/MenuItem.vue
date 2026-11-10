<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { DropdownMenuItem } from 'reka-ui'
import { setLucideProps } from '@lucide/vue'
import { cn } from '@/lib/utils'
import { menuItemVariants } from '.'

const props = defineProps<{
  /** Classes for the item. */
  class?: HTMLAttributes['class']
}>()

const emit = defineEmits<{
  /**
   * The item was chosen: a press, Enter or Space. The menu then closes and focus returns to its
   * trigger; call `event.preventDefault()` to keep it open.
   */
  select: [event: Event]
}>()

defineSlots<{
  /** The item's Lucide icon, drawn at 22px and the system's 1.5 stroke, hidden from readers. */
  icon?: () => unknown
  /** The item's name: a verb or a place, in sentence case ("Profile", "Sign out"). */
  default: () => unknown
}>()

// The slotted Lucide icon keeps the system's 1.5 stroke (foundations: Icons); its size comes from
// menuItemVariants.
setLucideProps({ strokeWidth: 1.5 })
</script>

<template>
  <DropdownMenuItem
    data-slot="menu-item"
    :class="cn(menuItemVariants(), props.class)"
    @select="emit('select', $event)"
  >
    <slot name="icon" />
    <slot />
  </DropdownMenuItem>
</template>
