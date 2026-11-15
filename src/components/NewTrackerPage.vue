<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, useTemplateRef } from 'vue'
import { ChevronLeft } from '@lucide/vue'
import { useTrackersStore } from '@/stores/trackers'
import { BODY, H2, ROW } from '@/lib/itemPage'
import { backToWeek, leaveForWeek } from '@/lib/routes'
import { MAX_TRACKERS, MAX_TRACKER_NAME } from '@/lib/trackers'
import { TRACKER_KINDS, TRACKER_TYPES, type TrackerTypeId } from '@/lib/trackerTypes'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { TextField } from '@/components/ui/text-field'
import { TextLink } from '@/components/ui/text-link'

const props = defineProps<{
  /** A style-guide example: it doesn't take focus as it arrives. */
  example?: boolean
}>()

const emit = defineEmits<{
  /** The tracker was added, with its id, just before the page goes back to the week. */
  added: [id: string]
}>()

const trackers = useTrackersStore()
const root = useTemplateRef<HTMLElement>('root')
const ids = { name: useId(), kind: useId() }

/** The kinds the registry has, in its order: adding one there adds it here. */
const KIND_OPTIONS = TRACKER_KINDS.map((k) => ({ value: k, label: TRACKER_TYPES[k].label }))

const name = ref('')
const nameError = ref<string | undefined>()
const kind = ref<TrackerTypeId>('strength')
/** The chosen kind's line under the control: what you log (K128). */
const kindInfo = computed(() => TRACKER_TYPES[kind.value])

// Arriving here opens at the top, where Add tracker is, with the cursor in Name.
onMounted(() => {
  if (props.example) return
  document.documentElement.scrollTop = 0
  root.value!.querySelector<HTMLInputElement>(`#${CSS.escape(ids.name)}`)!.focus()
})

function onName(value: string | number | undefined): void {
  name.value = String(value ?? '')
  if (name.value.trim()) nameError.value = undefined
}

/** The control's options are the registry's kinds, so its value is one. */
function onKind(value: string): void {
  kind.value = value as TrackerTypeId
}

/**
 * Adds the tracker, empty, after every other, starting in the week on screen (K124), then goes
 * back to the week. Nothing is added while Name shows a message; focus goes to it.
 */
/** Set once the tracker is added: the page stays up until the week opens, and a second press of
 * Add tracker (or Enter) must not add a second tracker. */
let added = false

async function add(): Promise<void> {
  if (added) return
  const id = name.value.trim()
    ? trackers.createTracker({ name: name.value, kind: kind.value })
    : null
  if (id === null) {
    nameError.value = name.value.trim()
      ? `An account holds at most ${MAX_TRACKERS} trackers, deleted ones included.`
      : 'Enter a name.'
    await nextTick()
    root.value!.querySelector<HTMLInputElement>(`#${CSS.escape(ids.name)}`)!.focus()
    return
  }
  added = true
  emit('added', id)
  leaveForWeek()
}
</script>

<!--
  The new tracker page (K124), at #/new-tracker: Edit plan's Add tracker opens it. It is framed
  like the new item page (K104), and shares the item page's slot and control sizes (main.css):
  Back to the week at the head's start, Cancel and Add tracker at its end, then "New tracker"
  over the Name field. A Kind row holds a SegmentedControl of the registry's kinds (the row's
  heading names it, so it has no label of its own), then one plain sentence for the chosen kind:
  what you log (K128). Nothing is saved until Add tracker, which adds it, empty, last and in the
  week on screen, and goes back to the week.
-->
<template>
  <div
    ref="root"
    class="flex flex-col pt-[calc(var(--u)*28)] pb-[calc(var(--u)*64)]"
    data-slot="item-page"
    data-testid="new-tracker-page"
  >
    <form novalidate @submit.prevent="add">
      <div class="flex flex-wrap items-center justify-between gap-x-[calc(var(--u)*16)] gap-y-2">
        <TextLink
          href="#/"
          class="inline-flex items-center gap-1.5 self-center text-(length:--set-text) [&_svg]:size-(--set-icon)"
          data-testid="back-to-week"
          @click="backToWeek"
          ><ChevronLeft :stroke-width="1.5" aria-hidden="true" />Back to the week</TextLink
        >
        <div class="flex items-center gap-[calc(var(--u)*12)]">
          <Button variant="quiet" data-testid="new-tracker-cancel" @click="leaveForWeek"
            >Cancel</Button
          >
          <Button type="submit" variant="primary" data-testid="new-tracker-add">Add tracker</Button>
        </div>
      </div>
      <h1
        class="label mt-[calc(var(--u)*16)] text-(length:--set-label) leading-snug text-ink-secondary"
      >
        New tracker
      </h1>
      <TextField
        :id="ids.name"
        :model-value="name"
        label="Name"
        :error="nameError"
        :maxlength="MAX_TRACKER_NAME"
        autocomplete="off"
        class="mt-[calc(var(--u)*12)] mb-[calc(var(--u)*28)] w-full max-w-[max(20rem,calc(var(--u)*560))]"
        data-testid="new-tracker-name"
        @update:model-value="onName"
      />

      <section :aria-labelledby="ids.kind" :class="ROW" data-testid="new-tracker-kind">
        <h2 :id="ids.kind" :class="H2">Kind</h2>
        <div :class="BODY">
          <div class="flex flex-col items-start gap-[calc(var(--u)*16)]">
            <SegmentedControl
              :model-value="kind"
              ariaLabel="Kind"
              :options="KIND_OPTIONS"
              @update:model-value="onKind"
            />
            <div
              class="body flex max-w-[60ch] flex-col gap-1 text-(length:--set-text) leading-normal text-ink"
              aria-live="polite"
              data-testid="new-tracker-kind-line"
            >
              <p>{{ kindInfo.settings }}</p>
            </div>
          </div>
        </div>
      </section>
    </form>
  </div>
</template>
