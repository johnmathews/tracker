<script setup lang="ts">
import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue'
import { Check, ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from '@lucide/vue'
import { usePlannerStore } from '@/stores/planner'
import { useTrackersStore } from '@/stores/trackers'
import { useDetailsStore } from '@/stores/details'
import { useConfirm } from '@/composables/useConfirm'
import { focusOnScreen, sprintToScreen } from '@/composables/screenSprint'
import { dayMonth } from '@/lib/dates'
import { metDays as daysMet } from '@/lib/tracker'
import { MAX_DAILY_PICK, MIN_DAILY_PICK, type Mark } from '@/lib/storage'
import { MAX_TRACKER_NAME, type TrackerInfo } from '@/lib/trackers'
import { TRACKER_TYPES } from '@/lib/trackerTypes'
import { SCREEN, SCREEN_GRID } from '@/lib/screens'
import { newItemHref } from '@/lib/routes'
import { SectionHeader } from '@/components/ui/section-header'
import { IconButton } from '@/components/ui/icon-button'
import { InlineMessage } from '@/components/ui/inline-message'
import { Button } from '@/components/ui/button'
import { Stepper } from '@/components/ui/stepper'
import TrackerGrid from '@/components/TrackerGrid.vue'

const props = defineProps<{
  /** The tracker this screen shows (K123). */
  tracker: TrackerInfo
  /** The tracker shown before it in the week, for the arrow back; null on the first screen. */
  prev: TrackerInfo | null
  /** The tracker shown after it, for the arrow on; null on the last screen. */
  next: TrackerInfo | null
}>()

const planner = usePlannerStore()
const trackers = useTrackersStore()
const details = useDetailsStore()

const id = computed(() => props.tracker.id)
/** The tracker's kind: its words, chips and marks (src/lib/trackerTypes.ts). */
const type = computed(() => TRACKER_TYPES[props.tracker.kind])
const first = computed(() => props.prev === null)

/** The heading's id, which the section, the arrows and the skip link point at. */
function headingId(t: TrackerInfo): string {
  return `tracker-${t.id}-heading`
}

/* ---- The week: marks, notes and the daily target (K30, K56, K57). ---- */

/** Items a day, set on the title line in Edit plan (K56); null for a kind with none (cardio). */
const dailyTarget = computed(() => trackers.dailyTarget(id.value))
const dayTarget = computed({
  get: () => dailyTarget.value!,
  set: (value: number) => trackers.setDailyTarget(id.value, value),
})
/**
 * The days whose marked items reach the daily target (K30, K57): their names turn green,
 * underlined (K60). None for a kind without a target, or while Daily goal is off (K85).
 */
const metDays = computed(() =>
  planner.dailyGoal && dailyTarget.value !== null
    ? daysMet(trackers.dayCounts(id.value), dailyTarget.value)
    : planner.days.map(() => false),
)

function marksFor(item: string): (Mark | null)[] {
  return planner.days.map((_, i) => trackers.markOf(id.value, item, i))
}

function toggle(item: string, day: number): void {
  trackers.toggle(id.value, item, day)
}

/** An item's notes, from its details: one copy for every week (D2). */
function noteFor(item: { id: string }): string {
  return details.notesOf(id.value, item.id)
}

/** Edit plan's Add opens the new item page (K104), not a dialog. */
function add(): void {
  location.hash = newItemHref(id.value)
}

/* ---- The title's pen: renaming in the title's own type (K121, K124). ---- */

const nameId = useId()
const pen = useTemplateRef<InstanceType<typeof IconButton>>('pen')
const nameInput = useTemplateRef<HTMLInputElement>('nameInput')
const renaming = ref(false)
const nameDraft = ref('')
const nameError = ref<string | undefined>()
/** The name renaming started from: a change from elsewhere replaces a draft still the same. */
let nameFrom = ''
watch(
  () => props.tracker.name,
  (now) => {
    if (!renaming.value) return
    if (nameDraft.value === nameFrom) nameDraft.value = now
    nameFrom = now
  },
)
// Leaving Edit plan leaves renaming, with the name as it was.
watch(
  () => planner.configMode,
  (on) => {
    if (!on) {
      renaming.value = false
      nameError.value = undefined
    }
  },
)

/** The pen: the title becomes the field, with the name selected. */
async function rename(): Promise<void> {
  nameDraft.value = nameFrom = props.tracker.name
  nameError.value = undefined
  renaming.value = true
  await nextTick()
  nameInput.value!.focus()
  nameInput.value!.select()
}

/** Leaves renaming with focus back on the pen. */
async function stopRenaming(): Promise<void> {
  renaming.value = false
  nameError.value = undefined
  await nextTick()
  ;(pen.value?.$el as HTMLElement | undefined)?.focus()
}

/** Enter or Done: saves the name; an empty name shows an error and waits. */
function commitName(): void {
  const name = nameDraft.value.trim()
  if (!name) {
    nameError.value = 'Enter a name.'
    nameInput.value!.focus()
    return
  }
  if (name !== props.tracker.name) trackers.renameTracker(id.value, name)
  void stopRenaming()
}

/** Enter in the field saves, unless it ends an input method's composition. */
function onNameEnter(ev: KeyboardEvent): void {
  if (ev.isComposing) return
  ev.preventDefault()
  commitName()
}

/** Escape: the old name back, and the title again. Edit plan stays on (the bar's Escape). */
function cancelName(ev: KeyboardEvent): void {
  ev.preventDefault()
  ev.stopPropagation()
  void stopRenaming()
}

/* ---- Delete tracker (K122). ---- */

const { confirm } = useConfirm()

/**
 * Where focus goes once the tracker has gone from the week: the Add button of the tracker that
 * takes its screen, the next or else the one before, or the bar's Add tracker when none is left.
 */
function focusAfterDelete(): HTMLElement | null {
  const near = props.next ?? props.prev
  const target = near
    ? document.querySelector<HTMLElement>(`[aria-labelledby="${headingId(near)}"] [data-add]`)
    : document.querySelector<HTMLElement>('[data-testid="add-tracker-button"]')
  if (target) focusOnScreen(target)
  return target
}

/**
 * Delete tracker asks first, then ends the tracker from the week on screen: it comes off this
 * week and the weeks after, and earlier weeks keep it with its marks and notes (K122). The week is
 * pinned when asking: past midnight on Sunday the question no longer applies, and nothing ends.
 */
async function remove(ev: MouseEvent): Promise<void> {
  const button = ev.currentTarget as HTMLElement
  const week = planner.weekKey
  const name = props.tracker.name
  let after: HTMLElement | null = null
  const yes = await confirm({
    title: `Delete ${name}?`,
    message: 'It comes off this week and the weeks after. Earlier weeks keep it.',
    confirmLabel: 'Delete',
    returnFocus: () => (button.isConnected ? button : after),
  })
  if (!yes || planner.weekKey !== week) return
  trackers.endTracker(id.value)
  await nextTick()
  after = focusAfterDelete()
}
</script>

<!--
  One tracker's screen (PlannerScreen card, K123): its SectionHeader over its WeekGrid, the same
  for every kind, which decides the grid's chips and marks, the daily target and the Add button's
  words. The week shows one per tracker shown in it, in position order (App.vue). The first screen
  holds the slot's messages at its top, under the fixed week (K88); each screen after it is set
  apart as Cardio and Food were (56u on screen, a rule elsewhere) and starts a page of its own on
  paper (K97). In Edit plan the title line holds the pen that renames the tracker (K124), the daily
  target centred while Daily goal is on (K56, K62, K63), then Add (K113) and Delete tracker (K122)
  at its end. The arrows go to the trackers before and after it (K42).
-->
<template>
  <section
    class="relative"
    :class="[
      SCREEN,
      first
        ? 'pt-8 print:pt-0'
        : 'mt-8 border-t border-line pt-8 print:mt-0 print:break-before-page print:border-0 print:pt-0 screen:mt-[calc(var(--u)*56)] screen:border-0 screen:pt-0 full:mt-0 full:border-0',
    ]"
    :aria-labelledby="headingId(tracker)"
    :data-tracker="tracker.id"
    :data-kind="tracker.kind"
    data-planner-screen
  >
    <!-- The screen's top as a snap point of its own (K118): used on a touch screen only while the
         screen is freed for a swipe up onto it, so the swipe can't rest at its foot. -->
    <div
      aria-hidden="true"
      data-snap-top
      data-noprint
      class="pointer-events-none absolute top-0 left-0 size-px"
    />
    <slot />
    <!-- The way back (PlannerScreen card, K42): on the title's line just under the fixed week,
         sprinting to the top of the tracker before. -->
    <IconButton
      v-if="prev"
      :label="`Back to ${prev.name}`"
      class="absolute top-(--screen-gap-top) left-1/2 hidden -translate-x-1/2 text-ink-secondary hover:text-ink full:inline-flex edit:top-0.5 edit:inline-flex short:hidden"
      data-noprint
      :data-testid="`back-to-${prev.id}`"
      @click="sprintToScreen(headingId(prev))"
      ><ChevronUp :size="24"
    /></IconButton>
    <!-- The heading and its grid: after the first screen, kept on one page on paper (F20). -->
    <div
      class="full:flex full:min-h-0 full:flex-1 full:flex-col folded:flex-none"
      :class="!first && 'print:break-inside-avoid'"
      :data-print-keep="first ? undefined : ''"
    >
      <SectionHeader
        :title="tracker.name"
        :heading-id="headingId(tracker)"
        :week="planner.label"
        :title-hidden="renaming"
      >
        <template v-if="planner.configMode" #title>
          <!-- Renaming (K121, K124): a field in the title's own type where the name was, with
               Done. The <h2> stays, visually hidden. -->
          <template v-if="renaming">
            <div
              class="flex w-[min(100%,max(16rem,calc(var(--u)*420)))] min-w-0 flex-col gap-1"
              data-noprint
            >
              <input
                :id="nameId"
                ref="nameInput"
                v-model="nameDraft"
                type="text"
                aria-label="Name"
                autocomplete="off"
                :maxlength="MAX_TRACKER_NAME"
                :aria-invalid="nameError ? 'true' : undefined"
                :aria-describedby="nameError ? `${nameId}-error` : undefined"
                class="title-1 w-full min-w-0 rounded-sm border border-control-border bg-panel px-[max(10px,calc(var(--u)*14))] py-[calc(var(--u)*6)] text-(length:--fs-section) leading-tight text-ink hover:not-aria-invalid:border-ink aria-invalid:border-error-ink motion-safe:transition-[border-color] motion-safe:duration-120 motion-safe:ease-out"
                :data-testid="`name-field-${tracker.id}`"
                @keydown.enter="onNameEnter"
                @keydown.esc="cancelName"
              />
              <InlineMessage
                v-if="nameError"
                :id="`${nameId}-error`"
                tone="error"
                class="mt-1 text-(length:--set-caption)"
                >{{ nameError }}</InlineMessage
              >
            </div>
            <Button
              class="h-(--set-control) px-(--set-control-pad) text-(length:--set-label) [&_svg]:size-(--set-icon)"
              data-noprint
              :data-testid="`rename-done-${tracker.id}`"
              @click="commitName"
              ><Check :stroke-width="1.5" />Done</Button
            >
          </template>
          <!-- The pen, right after the name, as an item's (K121). -->
          <IconButton
            v-else
            ref="pen"
            :label="`Rename ${tracker.name}`"
            class="size-(--edit-ib) text-ink-secondary hover:text-ink [&_svg]:size-(--edit-ib-icon)"
            data-noprint
            :data-testid="`rename-${tracker.id}`"
            @click="rename"
            ><Pencil
          /></IconButton>
        </template>
        <template v-if="planner.configMode && planner.dailyGoal && dailyTarget !== null" #actions>
          <!-- Centred on the title line (K62), the Stepper alone, reading "− 3 per day +" (K63): its
               label, "Exercises a day", is for a screen reader. -->
          <div data-slot="day-target" data-noprint>
            <Stepper
              v-model="dayTarget"
              :label="`${type.itemsLabel} a day`"
              :lower-label="`Fewer ${type.itemsLabel.toLowerCase()} a day`"
              :raise-label="`More ${type.itemsLabel.toLowerCase()} a day`"
              :min="MIN_DAILY_PICK"
              :max="MAX_DAILY_PICK"
              hide-label
              suffix="per day"
              :data-testid="`${tracker.id}-a-day`"
            />
          </div>
        </template>
        <!-- Add, at the end of the title line (K113), opens the new item page (K104); Delete
             tracker, bordered like it, follows (K122). Both at the page's control size. -->
        <template v-if="planner.configMode" #end>
          <div class="flex flex-wrap items-center justify-end gap-[calc(var(--u)*12)]">
            <Button
              class="h-(--set-control) px-(--set-control-pad) text-(length:--set-label) [&_svg]:size-(--set-icon)"
              data-add
              aria-keyshortcuts="A"
              :data-testid="`add-${tracker.id}`"
              @click="add"
              ><Plus :stroke-width="1.5" />{{ type.addLabel }}</Button
            >
            <Button
              class="h-(--set-control) px-(--set-control-pad) text-(length:--set-label) [&_svg]:size-(--set-icon)"
              :data-testid="`delete-${tracker.id}`"
              @click="remove"
              ><Trash2 :stroke-width="1.5" />Delete tracker</Button
            >
          </div>
        </template>
      </SectionHeader>
      <TrackerGrid
        :class="SCREEN_GRID"
        :label="type.itemLabel"
        :mark-set="planner.markSet"
        :section="tracker.id"
        :table-label="`${tracker.name}, week of ${dayMonth(planner.monday)}`"
        :items="trackers.itemsOf(tracker.id)"
        :days="planner.days"
        :marks-for="marksFor"
        :details-for="type.details"
        :note-for="noteFor"
        :met-days="metDays"
        :data-testid="`${tracker.id}-grid`"
        @toggle="toggle"
      >
        <template #corner>
          <span class="title-1 text-[24px] leading-7 text-ink">{{ tracker.name }}</span>
        </template>
      </TrackerGrid>
    </div>
    <!-- The way on (PlannerScreen card, K42): an arrow, no words, at the screen's foot (K114),
         sprinting to the next tracker. -->
    <div
      v-if="next"
      class="grid grid-cols-[1fr_auto_1fr] items-center full:mt-auto full:pt-[calc(var(--u)*10)] edit:mt-auto edit:pt-[calc(var(--u)*24)]"
      data-noprint
    >
      <IconButton
        :label="`Go to ${next.name}`"
        class="col-start-2 hidden text-ink-secondary hover:text-ink full:inline-flex edit:inline-flex short:hidden"
        :data-testid="`to-${next.id}`"
        @click="sprintToScreen(headingId(next))"
        ><ChevronDown :size="24"
      /></IconButton>
    </div>
  </section>
</template>
