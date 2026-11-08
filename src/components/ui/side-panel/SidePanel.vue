<script setup lang="ts">
import { nextTick, useId, useTemplateRef, watch, type HTMLAttributes } from 'vue'
import { PanelLeft } from '@lucide/vue'
import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { useMediaQuery } from '@/composables/useMediaQuery'
import { readKey, writeKey } from '@/lib/storage'
import { cn } from '@/lib/utils'
import { scrimVariants } from '@/components/ui/dialog'
import { IconButton } from '@/components/ui/icon-button'
import { FOLDED } from '.'

const props = withDefaults(
  defineProps<{
    /** The panel's name, docked and as a drawer. */
    label?: string
    /** Where open or hidden is remembered on this device; nothing is kept without one. */
    storageKey?: string
    showLabel?: string
    hideLabel?: string
    /** Classes for the shell, for its height and place. */
    class?: HTMLAttributes['class']
  }>(),
  {
    label: 'Conversation history',
    storageKey: undefined,
    showLabel: 'Show history',
    hideLabel: 'Hide history',
    class: undefined,
  },
)

defineSlots<{
  /** The heading's words: "History". */
  title?: () => unknown
  /** The panel's body. */
  panel?: () => unknown
  /** Icons beside Show history while the panel is hidden. */
  strip?: () => unknown
  /** The page. Folded, it places its own toggle, beside "Back to the week". */
  default?: (props: { folded: boolean; open: boolean; panelId: string }) => unknown
}>()

/** Docked: open or hidden to the strip. Folded: the drawer open or closed. */
const open = defineModel<boolean>('open', { default: true })

const folded = useMediaQuery(FOLDED)
const panelId = useId()
const hideButton = useTemplateRef<InstanceType<typeof IconButton>>('hideButton')
const showButton = useTemplateRef<InstanceType<typeof IconButton>>('showButton')

function remembered(): boolean {
  return props.storageKey ? readKey(props.storageKey) !== 'false' : open.value
}

// Folded, the drawer starts closed; docked, as this device last left it.
open.value = folded.value ? false : remembered()

watch(folded, (isFolded) => {
  open.value = isFolded ? false : remembered()
})

watch(open, (isOpen) => {
  if (!folded.value && props.storageKey) writeKey(props.storageKey, isOpen)
})

/** Hide and Show swap places, so focus follows to the one that is left. */
async function setDocked(next: boolean): Promise<void> {
  open.value = next
  await nextTick()
  const to = next ? hideButton.value : showButton.value
  ;(to?.$el as HTMLElement | undefined)?.focus()
}

// The drawer is opened from the page's toggle, so focus goes back to whatever had it.
let opener: HTMLElement | null = null
watch(open, (isOpen) => {
  if (isOpen && folded.value) opener = document.activeElement as HTMLElement | null
})
function onCloseAutoFocus(event: Event): void {
  event.preventDefault()
  opener?.focus()
}

/** Closes the drawer, as picking a conversation does. Docked, the panel stays as it is. */
function close(): void {
  if (folded.value) open.value = false
}

defineExpose({ close })

const HEAD =
  'flex items-center justify-between gap-2 pt-[calc(var(--u)*20)] pr-[calc(var(--u)*12)] pb-[calc(var(--u)*8)] pl-[calc(var(--u)*20)]'
const TITLE = 'title-2 text-(length:--set-h2) leading-tight whitespace-nowrap text-ink'
const BODY =
  'flex min-h-0 flex-1 flex-col gap-[calc(var(--u)*12)] px-[calc(var(--u)*12)] pb-[calc(var(--u)*16)]'
</script>

<!--
  A full-height panel beside the page (brand/design-system/project/components/SidePanel), S1. Docked,
  it is 300u wide (260px at least; a page may set `--side-panel-w`, as Ask does, K83) on `panel` with the line on its right, and hides to a 64u strip,
  the width changing over 200ms (at once under reduced motion); each side scrolls on its own.
  Docked, it is a <section> named by `label`: a region, which may sit inside the page's <main>,
  where an <aside> may not. Folded, it is a drawer from the left over the scrim, built on Reka's Dialog like the Dialog card:
  focus moves in, stays, and returns to the page's toggle, and Escape or the scrim closes it.
-->
<template>
  <div
    data-slot="side-panel"
    :data-open="open"
    :class="
      cn(
        'grid h-dvh min-h-0 motion-safe:transition-[grid-template-columns] motion-safe:duration-200 motion-safe:ease-out',
        folded
          ? 'grid-cols-[minmax(0,1fr)]'
          : open
            ? 'grid-cols-[var(--side-panel-w,max(260px,calc(var(--u)*300)))_minmax(0,1fr)]'
            : 'grid-cols-[max(56px,calc(var(--u)*64))_minmax(0,1fr)]',
        props.class,
      )
    "
  >
    <section
      v-if="!folded"
      :id="panelId"
      data-slot="side-panel-panel"
      :aria-label="label"
      class="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-line bg-panel text-ink"
    >
      <div v-show="open" :class="HEAD">
        <h2 :class="TITLE"><slot name="title">History</slot></h2>
        <IconButton
          ref="hideButton"
          :label="hideLabel"
          aria-expanded="true"
          :aria-controls="panelId"
          class="aria-expanded:not-hover:bg-transparent"
          @click="setDocked(false)"
        >
          <PanelLeft />
        </IconButton>
      </div>
      <div v-show="open" :class="BODY">
        <slot name="panel" />
      </div>
      <div
        v-show="!open"
        data-slot="side-panel-strip"
        class="flex flex-col items-center gap-2 pt-[calc(var(--u)*20)]"
      >
        <IconButton
          ref="showButton"
          :label="showLabel"
          aria-expanded="false"
          :aria-controls="panelId"
          @click="setDocked(true)"
        >
          <PanelLeft />
        </IconButton>
        <slot name="strip" />
      </div>
    </section>

    <DialogRoot v-else v-model:open="open">
      <DialogPortal>
        <DialogOverlay data-slot="side-panel-scrim" :class="scrimVariants()" />
        <DialogContent
          :id="panelId"
          data-slot="side-panel-drawer"
          :aria-label="label"
          v-bind="{ 'aria-labelledby': undefined, 'aria-describedby': undefined }"
          class="fixed inset-y-0 left-0 z-50 flex w-[min(85%,320px)] flex-col border-r border-line bg-panel text-ink shadow-overlay motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out starting:-translate-x-full print:hidden"
          @close-auto-focus="onCloseAutoFocus"
        >
          <div :class="HEAD">
            <DialogTitle as="h2" :class="TITLE"><slot name="title">History</slot></DialogTitle>
            <DialogClose as-child>
              <IconButton :label="hideLabel"><PanelLeft /></IconButton>
            </DialogClose>
          </div>
          <div :class="BODY">
            <slot name="panel" />
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>

    <div data-slot="side-panel-main" class="min-h-0 min-w-0 overflow-y-auto">
      <slot :folded="folded" :open="open" :panel-id="panelId" />
    </div>
  </div>
</template>
