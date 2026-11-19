<script setup lang="ts">
import { watch } from 'vue'
import { CircleAlert } from '@lucide/vue'
import {
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
} from 'reka-ui'
import { Button } from '@/components/ui/button'
import { dialogPanelVariants, scrimVariants } from '@/components/ui/dialog'

const props = withDefaults(
  defineProps<{
    /** The question, naming the thing: "Remove Push-ups?". */
    title: string
    /** The facts, briefly, then what stays. */
    message: string
    /** The verb from the title; the primary (ink) button, never red. */
    confirmLabel: string
    cancelLabel?: string
    /** The confirmed action is running: the verb keeps its label and gets aria-busy. */
    busy?: boolean
    /** What went wrong and what to do, shown above the buttons. */
    error?: string
    /**
     * Where focus goes on closing, asked a moment after the answer so the confirmed action has
     * happened: removing a row removes the button that asked, so the row's owner names a
     * neighbour and focus never drops to the page. Defaults to the control focused on opening.
     */
    returnFocus?: () => HTMLElement | null
  }>(),
  { cancelLabel: 'Cancel', busy: false, error: undefined, returnFocus: undefined },
)

const emit = defineEmits<{
  /** The verb was pressed. The owner closes the dialog (at once, or when the work is done). */
  confirm: []
  /** Cancel or Escape; the dialog closes itself. */
  cancel: []
}>()

const open = defineModel<boolean>('open', { default: false })

// Opened from code, so focus returns to the control that asked.
let opener: HTMLElement = document.body
watch(
  open,
  (isOpen) => {
    if (isOpen) opener = document.activeElement as HTMLElement
  },
  { immediate: true },
)

// With no trigger, Reka only ever asks to close: from Cancel or Escape.
function onDismiss(): void {
  open.value = false
  emit('cancel')
}

function onCloseAutoFocus(event: Event): void {
  event.preventDefault()
  // Reka closes before the answer's work renders, so wait a task before choosing the target.
  // Without scrolling: the answer's work may be scrolling the page to what it made (K174).
  setTimeout(() => (props.returnFocus?.() ?? opener).focus({ preventScroll: true }), 0)
}
</script>

<template>
  <AlertDialogRoot :open="open" @update:open="onDismiss">
    <AlertDialogPortal>
      <AlertDialogOverlay data-slot="confirm-dialog-scrim" :class="scrimVariants()" />
      <AlertDialogContent
        data-slot="confirm-dialog"
        aria-modal="true"
        :class="dialogPanelVariants({ size: 'sm' })"
        @close-auto-focus="onCloseAutoFocus"
      >
        <AlertDialogTitle as="h2" class="title-2 text-(length:--set-h2) leading-tight text-ink">{{
          title
        }}</AlertDialogTitle>
        <AlertDialogDescription
          class="body mt-[max(8px,calc(var(--u)*16))] text-(length:--set-text) leading-normal whitespace-pre-line text-ink"
          data-slot="confirm-message"
          >{{ message }}</AlertDialogDescription
        >
        <p v-if="error" role="alert" class="caption mt-4 flex items-start gap-1 text-error-ink">
          <CircleAlert :size="16" :stroke-width="1.5" class="mt-0.5 shrink-0" />
          <span>{{ error }}</span>
        </p>
        <div class="mt-[max(24px,calc(var(--u)*28))] flex flex-wrap justify-end gap-3">
          <AlertDialogCancel as-child>
            <Button variant="secondary">{{ cancelLabel }}</Button>
          </AlertDialogCancel>
          <Button variant="primary" :busy="busy" @click="emit('confirm')">{{
            confirmLabel
          }}</Button>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
