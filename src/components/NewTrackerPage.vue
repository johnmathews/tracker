<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, useTemplateRef } from 'vue'
import { ChevronLeft } from '@lucide/vue'
import { useTrackersStore } from '@/stores/trackers'
import { BODY, H2, LEDE, ROW } from '@/lib/itemPage'
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
const ids = { name: useId(), kind: useId(), starts: useId() }

/** The kinds the registry has, in its order: adding one there adds it here. */
const KIND_OPTIONS = TRACKER_KINDS.map((k) => ({ value: k, label: TRACKER_TYPES[k].label }))

const name = ref('')
const nameError = ref<string | undefined>()
const kind = ref<TrackerTypeId>('strength')
/** The line under the Kind control: what each item of the chosen kind records. */
const kindLine = computed(
  () => `${TRACKER_TYPES[kind.value].label}: ${TRACKER_TYPES[kind.value].records}`,
)

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
async function add(): Promise<void> {
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
  emit('added', id)
  leaveForWeek()
}
</script>

<!--
  The new tracker page (K124), at #/new-tracker: Edit plan's Add tracker opens it. It is framed
  like the new item page (K104), and shares the item page's slot and control sizes (main.css):
  Back to the week at the head's start, Cancel and Add tracker at its end, then "New tracker"
  over the Name field. A Kind row holds a SegmentedControl of the registry's kinds, with a line
  saying what the chosen kind records, and a Starts row says the tracker starts in the week on
  screen, empty. Nothing is saved until Add tracker, which adds it last and goes back to the week.
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
          <p :class="LEDE">What each item in it records. The kind is set once.</p>
          <div class="flex flex-col gap-[calc(var(--u)*16)]">
            <SegmentedControl
              :model-value="kind"
              label="Kind"
              :options="KIND_OPTIONS"
              @update:model-value="onKind"
            />
            <p
              class="body max-w-[60ch] text-(length:--set-text) leading-normal text-ink"
              aria-live="polite"
              data-testid="new-tracker-kind-line"
            >
              {{ kindLine }}
            </p>
          </div>
        </div>
      </section>

      <section :aria-labelledby="ids.starts" :class="ROW" data-testid="new-tracker-starts">
        <h2 :id="ids.starts" :class="H2">Starts</h2>
        <div :class="BODY">
          <p :class="LEDE">This week, empty. Add items to it in Edit plan.</p>
        </div>
      </section>
    </form>
  </div>
</template>
