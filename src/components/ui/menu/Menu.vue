<!-- eslint-disable vue/multi-word-component-names -- shadcn-vue's name; it lives in components/ui/ -->
<script setup lang="ts">
import { defineComponent, useId, type HTMLAttributes } from 'vue'
import {
  injectDropdownMenuRootContext,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from 'reka-ui'
import { cn } from '@/lib/utils'
import { menuVariants } from '.'

const props = withDefaults(
  defineProps<{
    /** The header's value, in label type: the signed-in email. No header when left out. */
    header?: string
    /** The header's caption over the value, in caption type: "Signed in as". */
    headerCaption?: string
    /** Which edges of the trigger and panel line up; the account menu aligns right edges. */
    align?: 'start' | 'center' | 'end'
    /** Classes for the panel. */
    class?: HTMLAttributes['class']
  }>(),
  { header: undefined, headerCaption: undefined, align: 'end', class: undefined },
)

defineSlots<{
  /**
   * The control that opens the menu, usually a BarAction; it gets aria-haspopup, aria-expanded,
   * a tile fill while open, and its id. Give it no id of its own: the panel is named by that id.
   */
  trigger: () => unknown
  /** The MenuItems. */
  default?: () => unknown
}>()

const open = defineModel<boolean>('open', { default: false })

const headerId = useId()

// Reka gives the panel its id only when the panel mounts, after the trigger has drawn its open
// state, so on the first open the trigger's aria-controls would be empty. Rendered before the
// trigger, this names the panel first; Reka keeps an id once it has one.
const PanelId = defineComponent({
  setup() {
    const root = injectDropdownMenuRootContext()
    root.contentId ||= useId()
    return () => null
  },
})
</script>

<!--
  The Menu card on Reka UI's DropdownMenu (K1, K106). The trigger opens it on a press, or on
  Enter, Space or Down Arrow with the first item focused; the arrow keys move between the items and
  wrap, passing over the header; an item's select, Escape or a press outside closes it, and Reka
  returns focus to the trigger. It is not modal (K106): Tab or a press elsewhere closes it, and the
  page behind stays readable, as for the Popover card. It renders in place, not in a portal: inside
  the Header it stays within the banner landmark, and focus inside it keeps the Header's
  focus-within, so the bar the keyboard floated over the week doesn't slide away under it.
-->
<template>
  <DropdownMenuRoot v-model:open="open" :modal="false">
    <PanelId />
    <DropdownMenuTrigger as-child class="aria-expanded:bg-tile">
      <slot name="trigger" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal disabled>
      <DropdownMenuContent
        data-slot="menu"
        side="bottom"
        :align="align"
        :side-offset="8"
        :collision-padding="16"
        loop
        :aria-describedby="header === undefined ? undefined : headerId"
        :class="cn(menuVariants(), props.class)"
      >
        <DropdownMenuLabel
          v-if="header !== undefined"
          :id="headerId"
          data-slot="menu-header"
          class="mb-2 border-b border-line px-3 pt-2 pb-3"
        >
          <span class="caption block text-ink-secondary">{{ headerCaption }}</span>
          <span class="label block wrap-anywhere text-ink">{{ header }}</span>
        </DropdownMenuLabel>
        <div class="grid gap-0.5">
          <slot />
        </div>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
