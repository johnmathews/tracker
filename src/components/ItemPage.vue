<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  useId,
  useTemplateRef,
  watch,
} from 'vue'
import { ArrowDown, ArrowUp, Check, ChevronLeft, List, Pencil, Trash2 } from '@lucide/vue'
import { usePlannerStore } from '@/stores/planner'
import { useCardioStore } from '@/stores/cardio'
import { useDietStore } from '@/stores/diet'
import { useDetailsStore } from '@/stores/details'
import { useItemSource } from '@/composables/itemSource'
import { useExerciseForm } from '@/composables/exerciseForm'
import { useCardioForm } from '@/composables/cardioForm'
import { useConfirm } from '@/composables/useConfirm'
import { cardioPlanErrors, exercisePlanErrors, hasPlanErrors } from '@/composables/planErrors'
import { dayMonth } from '@/lib/dates'
import { itemHistory, latestPlanWith, weekMonday } from '@/lib/history'
import { renderNote } from '@/lib/markdown'
import { detailsIdProblem } from '@/lib/problems'
import { backToWeek, leaveForWeek, webHost } from '@/lib/routes'
import {
  MAX_DETAILS_NOTES,
  MAX_FIELD,
  NOTES_COUNT_FROM,
  codePoints,
  type Cardio,
  type Exercise,
} from '@/lib/storage'
import { SECTIONS, type Section } from '@/lib/trackerTypes'
import { ARRANGE_ROW, BODY, FIELDS, H2, LEDE, MOVE, ROW } from '@/lib/itemPage'
import { moveSection, showSection, shownSections, type SectionKey } from '@/lib/itemSections'
import PlanFields, { type PlanErrors } from '@/components/PlanFields.vue'
import RecentWeeks from '@/components/RecentWeeks.vue'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { Switch } from '@/components/ui/switch'
import { TextArea } from '@/components/ui/text-area'
import { TextField } from '@/components/ui/text-field'
import { TextLink } from '@/components/ui/text-link'

const props = defineProps<{
  section: Section
  /** The item's id; App opens the page only for an item in the week or in some week's plan. */
  itemId: string
  /** A style-guide example: it doesn't take focus as it arrives. */
  example?: boolean
}>()

/** The notes' hint (ItemPage card). */
const NOTES_HINT = 'Markdown works: **bold**, *italic*, lists, links.'
/** Notes within 20,000 characters that the API still can't store (32 KB), as the dialogs say. */
const NOTES_TOO_BIG = 'These notes are too long to save. Shorten them, then save again.'
/** A field within 500 characters whose document the API can't store, beside long notes. */
const DETAILS_TOO_BIG =
  'These details are too long to save. Shorten them or the notes, then save again.'
const LINES = {
  same: 'Changes this week’s plan, and the weeks after it that have no plan of their own.',
  other: (week: string) =>
    `Changes the plan for the week of ${week}, and the weeks after it that have no plan of their own.`,
}

const planner = usePlannerStore()
const cardio = useCardioStore()
const diet = useDietStore()
const details = useDetailsStore()
const source = useItemSource()
const heading = useTemplateRef<HTMLHeadingElement>('heading')
const root = useTemplateRef<HTMLElement>('root')
const ids = {
  notes: useId(),
  plan: useId(),
  weeks: useId(),
  details: useId(),
  form: useId(),
  name: useId(),
  remove: useId(),
}

const type = computed(() => SECTIONS[props.section])
const isExercise = computed(() => type.value.id === 'exercise')
const isCardio = computed(() => type.value.id === 'cardio')
const src = computed(() => source(props.section))
/** The item in the week the page was opened from (the week the planner shows), if it's there. */
const inWeek = computed(() => src.value.items.find((it) => it.id === props.itemId) ?? null)
/** Its latest plan, shown read-only when it isn't in the week (an old address, or an item since
 * removed). */
const latest = computed(() => latestPlanWith(src.value.plans, props.itemId))
/**
 * The item as the page shows it: its name and chips. Null once no plan holds it (another tab
 * removed it): App goes back to the week then, and until it does the page shows nothing.
 */
const shown = computed(() => inWeek.value ?? latest.value?.item ?? null)
const chips = computed(() => type.value.details(shown.value!))

// Arriving here moves focus to the item's name, so a screen reader starts there (ItemPage card).
onMounted(() => {
  if (!props.example) heading.value?.focus()
})

/* ---- This week's plan: the Edit dialog's controls, each change applied at once (D4). ---- */

const isCurrent = computed(() => planner.weekKey === planner.currentWeekKey)
const weekName = computed(() => dayMonth(planner.monday))
const planHeading = computed(() => {
  if (!inWeek.value) return 'Latest plan'
  return isCurrent.value ? 'This week’s plan' : `Plan for the week of ${weekName.value}`
})
const planLine = computed(() => {
  if (inWeek.value) return isCurrent.value ? LINES.same : LINES.other(weekName.value)
  const where = isCurrent.value ? 'this week’s plan' : `the plan for the week of ${weekName.value}`
  const from = dayMonth(weekMonday(latest.value!.week))
  return `${shown.value!.name} isn’t in ${where}. This is its plan from the week of ${from}.`
})

const form = useExerciseForm()
/** A cardio item's time and distance (K90). */
const cardioForm = useCardioForm()
const planKind = computed(() =>
  isExercise.value ? 'exercise' : isCardio.value ? 'cardio' : ('food' as const),
)
const planErrors = reactive<PlanErrors>({})
/** The plan item as this page last left it: a change from anywhere else reloads the controls. */
let planSeen = ''
const planJson = () => JSON.stringify(inWeek.value)

function loadPlan(): void {
  if (inWeek.value && isCardio.value) cardioForm.load(inWeek.value as Cardio)
  else if (inWeek.value) form.load(inWeek.value as Exercise)
  planErrors.sets = planErrors.reps = planErrors.weight = undefined
  planErrors.minutes = planErrors.distance = undefined
  planSeen = planJson()
}
watch(planJson, (now) => {
  if (now !== planSeen) loadPlan()
})
loadPlan()

/** The cardio item's controls changed: this week's plan takes them, unless a number isn't valid. */
function applyCardio(): void {
  const item = inWeek.value!
  Object.assign(planErrors, cardioPlanErrors(cardioForm))
  if (hasPlanErrors(planErrors)) return
  cardio.updateCardio(item.id, { ...cardioForm.value(), name: item.name, target: item.target })
  planSeen = planJson()
}

/** The exercise's controls changed: this week's plan takes them, unless a number isn't valid. */
function applyPlan(): void {
  const item = inWeek.value!
  Object.assign(planErrors, exercisePlanErrors(form))
  if (hasPlanErrors(planErrors)) return
  planner.updateExercise(item.id, { ...form.value(), name: item.name, target: item.target })
  planSeen = planJson()
}

function onPlanChange(): void {
  if (isCardio.value) applyCardio()
  else applyPlan()
}
/** Times a week, through the dialog's goal action. */
function onTarget(value: number): void {
  src.value.changeTarget(props.itemId, value - inWeek.value!.target)
  planSeen = planJson()
}

/** The latest plan as words, for an item not in the week: each label over its value. */
const latestRows = computed<[string, string][]>(() => {
  const item = latest.value!.item
  const rows: [string, string][] = []
  if (isExercise.value) {
    const e = item as Exercise
    if (e.sets) rows.push(['Sets', String(e.sets)])
    rows.push(['Measure', e.duration ? 'Time' : 'Reps'])
    if (e.duration) rows.push(['Seconds', String(e.duration)])
    else if (e.reps) rows.push(['Reps', String(e.reps)])
    rows.push(['Weight in kg', e.weight ? String(e.weight) : 'Bodyweight'])
    rows.push([e.duration ? 'Timed' : 'Reps count', e.perSide ? 'Each side' : 'Per set'])
  }
  if (isCardio.value) {
    const c = item as Cardio
    if (c.duration) rows.push(['Minutes', String(Math.round((c.duration / 60) * 100) / 100)])
    if (c.distance) rows.push(['Distance in km', String(c.distance)])
  }
  rows.push(['Times a week', String(item.target)])
  return rows
})

/* ---- Edit plan: the name and Remove, on the page rather than in a dialog (K104). ---- */

/** In Edit plan, for an item in the week: the title is the Name field and Remove ends the page. */
const editable = computed(() => planner.configMode && inWeek.value !== null)
const nameDraft = ref(shown.value!.name)
const nameError = ref<string | undefined>()
/** The name as this page last left it: a change from elsewhere replaces the draft. */
let nameSeen = nameDraft.value
watch(
  () => inWeek.value?.name,
  (now) => {
    if (now === undefined || now === nameSeen) return
    nameSeen = nameDraft.value = now
    nameError.value = undefined
  },
)

/** Renames the item in this week's plan as you type; an empty name shows an error and waits. */
function onName(value: string | number | undefined): void {
  const text = String(value ?? '')
  nameDraft.value = text
  const name = text.trim()
  if (!name) {
    nameError.value = 'Enter a name.'
    return
  }
  nameError.value = undefined
  const item = inWeek.value!
  if (isExercise.value) {
    const e = item as Exercise
    planner.updateExercise(item.id, { ...e, perSide: e.perSide ?? false, name })
  } else if (isCardio.value) cardio.updateCardio(item.id, { ...(item as Cardio), name })
  else diet.updateFood(item.id, { name, target: item.target })
  nameSeen = name
}

const { confirm } = useConfirm()
const removeLine = computed(
  () =>
    `Takes ${shown.value!.name} off this week’s plan. Weeks with their own plan keep it, and its marks stay.`,
)

/**
 * Remove asks first, as the row's Remove does (TrackerRow), then takes the item off the week the
 * page shows and goes back to it. The week is pinned when asking: past midnight on Sunday the
 * question no longer applies, and nothing is removed.
 */
async function remove(ev: MouseEvent): Promise<void> {
  const button = ev.currentTarget as HTMLElement
  const week = planner.weekKey
  const yes = await confirm({
    title: `Remove ${shown.value!.name}?`,
    message:
      'It comes off this week’s plan. Weeks with their own plan keep it, and its marks stay.',
    confirmLabel: 'Remove',
    returnFocus: () => (button.isConnected ? button : null),
  })
  if (!yes || planner.weekKey !== week || !inWeek.value) return
  leaveForWeek()
  if (isExercise.value) planner.removeExercise(props.itemId)
  else if (isCardio.value) cardio.removeCardio(props.itemId)
  else diet.removeFood(props.itemId)
}

/* ---- Recent weeks ---- */

const weeks = computed(() =>
  itemHistory({
    plans: src.value.plans,
    log: src.value.log,
    id: props.itemId,
    week: planner.weekKey,
    currentWeek: planner.currentWeekKey,
    fallback: src.value.fallback,
  }),
)

/* ---- Notes: one copy for every week, saved as you type (details store). ---- */

const storedNotes = computed(() => details.notesOf(props.section, props.itemId))
const editing = ref(false)
/** The text being typed: kept here, so a trailing space stays while the stored copy is trimmed. */
const draft = ref('')
const notesError = ref<string | undefined>()
/** The stored notes as this page last left them: any other change came from elsewhere. */
let notesSeen = storedNotes.value
const notesHtml = computed(() => renderNote(storedNotes.value))
const notesCount = computed(() =>
  draft.value.length >= NOTES_COUNT_FROM ? MAX_DETAILS_NOTES : undefined,
)

// Another tab, or the server's copy after a conflict (adoptItem): the field shows that version,
// rather than this draft overwriting it on the next keystroke. SyncStatus says what happened.
watch(storedNotes, (now) => {
  if (now === notesSeen) return
  notesSeen = now
  draft.value = now
  notesError.value = undefined
})

function onNotes(text: string): void {
  draft.value = text
  if (details.setNotes(props.section, props.itemId, text)) {
    notesError.value = undefined
    notesSeen = storedNotes.value
    return
  }
  const n = codePoints(text.trim())
  notesError.value =
    detailsIdProblem(props.itemId, 'notes') ??
    (n > MAX_DETAILS_NOTES
      ? `These notes are ${n.toLocaleString('en-US')} characters. Shorten them to ${MAX_DETAILS_NOTES.toLocaleString('en-US')} or fewer to save them.`
      : NOTES_TOO_BIG)
}

async function editNotes(): Promise<void> {
  draft.value = notesSeen = storedNotes.value
  notesError.value = undefined
  editing.value = true
  await nextTick()
  const area = root.value!.querySelector<HTMLTextAreaElement>(
    'textarea[data-testid="item-notes-field"]',
  )!
  area.focus()
  area.setSelectionRange(area.value.length, area.value.length)
}

async function doneNotes(): Promise<void> {
  editing.value = false
  notesError.value = undefined
  await nextTick()
  root.value!.querySelector<HTMLElement>('[data-testid="item-notes-button"]')!.focus()
}

/* ---- Details: the type's fields, one copy for every week, saved as you type. ---- */

const fieldDrafts = reactive<Record<string, string>>({})
const fieldErrors = reactive<Record<string, string | undefined>>({})
const fieldsSeen: Record<string, string> = {}
const storedFields = computed(() =>
  type.value.fields.map((f) => details.fieldOf(props.section, props.itemId, f.key)),
)
for (const [i, f] of type.value.fields.entries()) {
  fieldDrafts[f.key] = fieldsSeen[f.key] = storedFields.value[i]!
}
watch(storedFields, (now) => {
  for (const [i, f] of type.value.fields.entries()) {
    if (now[i] === fieldsSeen[f.key]) continue
    fieldDrafts[f.key] = fieldsSeen[f.key] = now[i]!
    fieldErrors[f.key] = undefined
  }
})

function onField(key: string, value: string | number | undefined): void {
  const text = String(value)
  fieldDrafts[key] = text
  if (details.setField(props.section, props.itemId, key, text)) {
    fieldErrors[key] = undefined
    fieldsSeen[key] = details.fieldOf(props.section, props.itemId, key)
    return
  }
  const n = codePoints(text.trim())
  fieldErrors[key] =
    detailsIdProblem(props.itemId, 'details') ??
    (n > MAX_FIELD
      ? `This is ${n.toLocaleString('en-US')} characters. Shorten it to ${MAX_FIELD} or fewer to save it.`
      : DETAILS_TOO_BIG)
}

/* ---- Arranging: which sections every page of the type shows, and their order (K66). ---- */

const arrangeButton = useTemplateRef<InstanceType<typeof Button>>('arrangeButton')
const arranging = ref(false)
const arrangement = computed(() => planner.arrangementFor(type.value.id))
/** The sections the page shows outside arranging, in order. */
const visible = computed(() => shownSections(arrangement.value))
/** Each section's heading, which also names its controls ("Show Notes", "Move Notes up"). */
const titles = computed<Record<SectionKey, string>>(() => ({
  notes: 'Notes',
  details: 'Details',
  plan: planHeading.value,
  history: 'Recent weeks',
}))
const headingIds: Record<SectionKey, string> = {
  notes: ids.notes,
  details: ids.details,
  plan: ids.plan,
  history: ids.weeks,
}
/** Each section's test id, as the page always had them. */
const TEST_IDS: Record<SectionKey, string> = {
  notes: 'item-notes',
  details: 'item-details',
  plan: 'item-plan',
  history: 'item-weeks',
}
const arrangeLine = computed(
  () =>
    `Choose which sections every ${type.value.itemLabel.toLowerCase()} page shows, and their order. Changes apply at once.`,
)

function focusArrange(): void {
  ;(arrangeButton.value!.$el as HTMLElement).focus()
}

/** Pressing the button keeps focus on it: the same button reads "Done" while arranging. */
function toggleArranging(): void {
  arranging.value = !arranging.value
}

/** Escape anywhere on the page leaves arranging, with focus on the button. Listening only while
 * arranging. */
function onEscape(ev: KeyboardEvent): void {
  if (ev.key !== 'Escape') return
  ev.preventDefault()
  arranging.value = false
  focusArrange()
}
watch(arranging, (on) => {
  if (on) document.addEventListener('keydown', onEscape)
  else document.removeEventListener('keydown', onEscape)
})
onBeforeUnmount(() => document.removeEventListener('keydown', onEscape))

function onShow(key: SectionKey, shown: boolean): void {
  planner.setArrangement(type.value.id, showSection(arrangement.value, key, shown))
}

function atEnd(key: SectionKey, delta: -1 | 1): boolean {
  const i = arrangement.value.order.indexOf(key)
  return delta < 0 ? i === 0 : i === arrangement.value.order.length - 1
}

/**
 * Moves a section one place; at an end the press does nothing (its button is aria-disabled, so
 * focus stays on it). Focus stays on the moved section's same button, or goes to its other one
 * when the move took it to an end.
 */
async function onMove(key: SectionKey, delta: -1 | 1): Promise<void> {
  if (atEnd(key, delta)) return
  planner.setArrangement(type.value.id, moveSection(arrangement.value, key, delta))
  await nextTick()
  const button = (d: number) =>
    root.value!.querySelector<HTMLElement>(`[data-move-key="${key}"][data-move="${d}"]`)!
  ;(atEnd(key, delta) ? button(-delta) : button(delta)).focus()
}

/** The Link field's site, when its value is a web address: "Open youtube.com in a new tab". */
const linkHost = computed(() => webHost(fieldDrafts.link!))
/** The fields that have text, for paper: each label over its value. */
const filled = computed(() =>
  type.value.fields.map((f, i) => ({ ...f, value: storedFields.value[i]! })).filter((f) => f.value),
)
</script>

<!--
  An item's own page (brand/design-system/project/components/ItemPage), at #/item/<section>/<id>,
  one of the Settings page's family: no Header (K52), Settings' sizes (K51). The head (Back to the
  week, the type, the name with its chips), then layout A (K65), rows like Settings: Notes,
  Details, This week's plan and Recent weeks, each heading in the week's name column and its
  content beside it, a line rule above each row. Folded, one column in the same order. On paper:
  the head, the notes and the details.
-->
<template>
  <div
    v-if="shown"
    ref="root"
    class="flex flex-col pt-[calc(var(--u)*28)] pb-[calc(var(--u)*64)] print:pt-0"
    data-slot="item-page"
    data-testid="item-page"
  >
    <div class="flex flex-wrap items-center justify-between gap-x-[calc(var(--u)*16)] gap-y-2">
      <TextLink
        href="#/"
        class="inline-flex items-center gap-1.5 self-center text-(length:--set-text) [&_svg]:size-(--set-icon)"
        data-noprint
        data-testid="back-to-week"
        @click="backToWeek"
        ><ChevronLeft :stroke-width="1.5" aria-hidden="true" />Back to the week</TextLink
      >
      <Button
        ref="arrangeButton"
        variant="quiet"
        :class="arranging && 'border-control-border'"
        data-noprint
        data-testid="item-arrange"
        @click="toggleArranging"
      >
        <template v-if="arranging"><Check :stroke-width="1.5" />Done</template>
        <template v-else><List :stroke-width="1.5" />Arrange sections</template>
      </Button>
    </div>
    <p
      class="label mt-[calc(var(--u)*16)] text-(length:--set-label) leading-snug text-ink-secondary print:mt-0"
      data-testid="item-type"
    >
      {{ type.itemLabel }}
    </p>
    <div
      class="mt-[calc(var(--u)*4)] mb-[calc(var(--u)*28)] flex flex-wrap items-center gap-x-[calc(var(--u)*14)] gap-y-2"
    >
      <h1
        ref="heading"
        tabindex="-1"
        class="title-1 min-w-0 text-(length:--fs-title) leading-tight break-words text-ink focus:outline-none"
        :class="editable && 'sr-only'"
      >
        {{ shown!.name }}
      </h1>
      <!-- In Edit plan the title is the Name field, where the name was (K104). -->
      <TextField
        v-if="editable"
        :id="ids.name"
        :model-value="nameDraft"
        label="Name"
        :error="nameError"
        class="w-full max-w-[max(20rem,calc(var(--u)*560))]"
        data-noprint
        data-testid="item-name-field"
        @update:model-value="onName"
      />
      <Chip
        v-for="chip in editable ? [] : chips"
        :key="chip"
        class="text-(length:--set-label) leading-normal"
        data-testid="item-chip"
        >{{ chip }}</Chip
      >
    </div>

    <!-- Arranging (K66): every section, hidden ones too, as its heading over Show and the moves. -->
    <template v-if="arranging">
      <p :class="LEDE" class="mb-[calc(var(--u)*16)]" data-testid="item-arrange-line">
        {{ arrangeLine }}
      </p>
      <section
        v-for="key in arrangement.order"
        :key="key"
        :aria-labelledby="headingIds[key]"
        :class="ARRANGE_ROW"
        :data-testid="TEST_IDS[key]"
      >
        <div
          class="flex flex-col items-start gap-[calc(var(--u)*6)] folded:flex-row folded:items-center folded:justify-between folded:gap-2"
        >
          <h2 :id="headingIds[key]" :class="H2" class="folded:min-w-0 folded:flex-1">
            {{ titles[key] }}
          </h2>
          <div class="flex items-center gap-[calc(var(--u)*8)] folded:gap-0">
            <Switch
              :model-value="!arrangement.hidden.includes(key)"
              label="Show"
              :context="titles[key]"
              @update:model-value="onShow(key, $event)"
            />
            <IconButton
              :label="`Move ${titles[key]} up`"
              :aria-disabled="atEnd(key, -1) ? 'true' : undefined"
              :class="MOVE"
              :data-move-key="key"
              data-move="-1"
              @click="onMove(key, -1)"
              ><ArrowUp
            /></IconButton>
            <IconButton
              :label="`Move ${titles[key]} down`"
              :aria-disabled="atEnd(key, 1) ? 'true' : undefined"
              :class="MOVE"
              :data-move-key="key"
              data-move="1"
              @click="onMove(key, 1)"
              ><ArrowDown
            /></IconButton>
          </div>
        </div>
        <!-- One word, so the order reads at a glance; folded, the Switch says it. -->
        <p
          class="body text-(length:--set-text) leading-normal folded:hidden"
          :class="arrangement.hidden.includes(key) ? 'text-ink-secondary' : 'text-ink'"
          data-testid="item-arrange-state"
        >
          {{ arrangement.hidden.includes(key) ? 'Hidden' : 'Shown' }}
        </p>
      </section>
    </template>
    <p v-else-if="!visible.length" :class="LEDE" data-testid="item-all-hidden">
      Every section is hidden. Arrange sections to show one.
    </p>
    <!-- The shown sections, in the type's order. -->
    <template v-for="key in arranging ? [] : visible" :key="key">
      <!-- Notes: the person's own words, read by default. -->
      <section
        v-if="key === 'notes'"
        :aria-labelledby="ids.notes"
        :class="ROW"
        data-testid="item-notes"
      >
        <h2 :id="ids.notes" :class="H2">Notes</h2>
        <div :class="BODY">
          <!-- eslint-disable vue/no-v-html -- markdown-it with raw HTML off (lib/markdown) -->
          <div
            v-if="storedNotes"
            :class="editing && 'hidden print:block'"
            class="note-body max-w-[66ch] font-serif text-(length:--set-text) leading-[1.55] text-ink italic"
            data-testid="item-notes-body"
            v-html="notesHtml"
          ></div>
          <!-- eslint-enable vue/no-v-html -->
          <div v-if="editing" data-noprint>
            <TextArea
              :id="`${ids.notes}-field`"
              :model-value="draft"
              label="Notes"
              :aria-labelledby="ids.notes"
              :hint="NOTES_HINT"
              :error="notesError"
              :max-length="notesCount"
              rows="8"
              class="[&>label]:sr-only"
              data-testid="item-notes-field"
              @update:model-value="onNotes($event!)"
              @keydown.esc.prevent="doneNotes"
            />
          </div>
          <Button
            class="self-start"
            data-noprint
            data-testid="item-notes-button"
            @click="editing ? doneNotes() : editNotes()"
          >
            <template v-if="editing"><Check :stroke-width="1.5" />Done</template>
            <template v-else
              ><Pencil :stroke-width="1.5" />{{
                storedNotes ? 'Edit notes' : 'Add notes'
              }}</template
            >
          </Button>
        </div>
      </section>

      <section
        v-else-if="key === 'details'"
        :aria-labelledby="ids.details"
        :class="ROW"
        data-testid="item-details"
      >
        <h2 :id="ids.details" :class="H2">Details</h2>
        <div :class="BODY">
          <div :class="FIELDS" class="print:hidden">
            <div
              v-for="f in type.fields"
              :key="f.key"
              class="flex min-w-0 flex-col gap-2"
              :class="f.key === 'link' && 'col-span-full'"
            >
              <TextField
                :id="`${ids.details}-${f.key}`"
                :model-value="fieldDrafts[f.key]"
                :label="f.label"
                :error="fieldErrors[f.key]"
                :data-field="f.key"
                @update:model-value="onField(f.key, $event)"
              />
              <TextLink
                v-if="f.key === 'link' && linkHost"
                :href="fieldDrafts.link!.trim()"
                target="_blank"
                rel="noopener noreferrer"
                class="self-start text-(length:--set-text) break-all"
                data-testid="item-link-open"
                >Open {{ linkHost }} in a new tab</TextLink
              >
            </div>
          </div>
          <!-- On paper, each detail as its label over its value, with no box. -->
          <dl class="hidden flex-col gap-3 print:flex">
            <div v-for="f in filled" :key="f.key">
              <dt class="label text-ink">{{ f.label }}</dt>
              <dd class="body text-ink">{{ f.value }}</dd>
            </div>
          </dl>
        </div>
      </section>

      <!-- This week's plan, or the latest one read-only. -->
      <section
        v-else-if="key === 'plan'"
        :aria-labelledby="ids.plan"
        :class="ROW"
        data-noprint
        data-testid="item-plan"
      >
        <h2 :id="ids.plan" :class="H2">{{ planHeading }}</h2>
        <div :class="BODY">
          <p :class="LEDE" data-testid="item-plan-line">{{ planLine }}</p>
          <PlanFields
            v-if="inWeek"
            :kind="planKind"
            :form="form"
            :cardio-form="cardioForm"
            :target="inWeek.target"
            :errors="planErrors"
            :id-base="ids.form"
            @change="onPlanChange"
            @update:target="onTarget"
          />
          <dl v-else :class="FIELDS" data-testid="item-latest-plan">
            <div v-for="[label, value] in latestRows" :key="label" class="flex flex-col gap-1">
              <dt class="label text-(length:--set-label) leading-snug text-ink">{{ label }}</dt>
              <dd class="body text-(length:--set-text) leading-normal text-ink">{{ value }}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section
        v-else
        :aria-labelledby="ids.weeks"
        :class="ROW"
        data-noprint
        data-testid="item-weeks"
      >
        <h2 :id="ids.weeks" :class="H2">Recent weeks</h2>
        <div :class="BODY">
          <RecentWeeks :weeks="weeks" :mark-set="planner.markSet" :labelledby="ids.weeks" />
        </div>
      </section>
    </template>
    <!-- Edit plan's Remove, last on the page in a section of its own (K104). Not one of the
         sections a type arranges. -->
    <section
      v-if="editable && !arranging"
      :aria-labelledby="ids.remove"
      :class="ROW"
      data-noprint
      data-testid="item-remove"
    >
      <h2 :id="ids.remove" :class="H2">Remove</h2>
      <div :class="BODY">
        <p :class="LEDE">{{ removeLine }}</p>
        <Button class="self-start" data-testid="item-remove-button" @click="remove"
          ><Trash2 :stroke-width="1.5" />Remove from this week</Button
        >
      </div>
    </section>
  </div>
</template>
