<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { setLucideProps } from '@lucide/vue'
import { cn } from '@/lib/utils'
import { barActionVariants } from '.'

const props = withDefaults(
  defineProps<{
    /** The action's name, shown under the icon and its accessible name: "Settings". */
    label: string
    /** A toggle sets this; an ordinary action leaves it out, so it has no aria-pressed. */
    pressed?: boolean
    class?: HTMLAttributes['class']
  }>(),
  { pressed: undefined, class: undefined },
)

// The slotted Lucide icon keeps the system's 1.5 stroke (foundations: Icons); its size comes from
// the Header's --bar-icon, which CSS sets over Lucide's width and height.
setLucideProps({ strokeWidth: 1.5 })
</script>

<!-- The BarAction card: the slotted Lucide icon (aria-hidden by default) over the visible name,
     which names the button. -->
<template>
  <button
    type="button"
    data-slot="bar-action"
    :aria-pressed="pressed === undefined ? undefined : pressed"
    :class="cn(barActionVariants(), props.class)"
  >
    <slot />
    <span class="text-(length:--bar-name) leading-[1.3] font-semibold whitespace-nowrap">
      {{ label }}
    </span>
  </button>
</template>
