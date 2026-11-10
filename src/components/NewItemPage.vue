<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, useId, useTemplateRef } from 'vue'
import { ChevronLeft, Pencil } from '@lucide/vue'
import { usePlannerStore } from '@/stores/planner'
import { useCardioStore } from '@/stores/cardio'
import { useDietStore } from '@/stores/diet'
import { useDetailsStore } from '@/stores/details'
import { useExerciseForm } from '@/composables/exerciseForm'
import { useCardioForm } from '@/composables/cardioForm'
import { cardioPlanErrors, exercisePlanErrors, hasPlanErrors } from '@/composables/planErrors'
import { dayMonth } from '@/lib/dates'
import { BODY, FIELDS, H2, LEDE, ROW } from '@/lib/itemPage'
import { shownSections } from '@/lib/itemSections'
import { backToWeek, leaveForWeek } from '@/lib/routes'
import {
  MAX_DETAILS_NOTES,
  MAX_FIELD,
  NEW_CARDIO_TARGET,
  NEW_EXERCISE_TARGET,
  NEW_FOOD_TARGET,
  NOTES_COUNT_FROM,
  codePoints,
} from '@/lib/storage'
import { SECTIONS, type Section } from '@/lib/trackerTypes'
import PlanFields, { type PlanErrors } from '@/components/PlanFields.vue'
import { Button } from '@/components/ui/button'
import { TextArea } from '@/components/ui/text-area'
import { TextField } from '@/components/ui/text-field'
import { TextLink } from '@/components/ui/text-link'

const props = defineProps<{
  section: Section
  /** A style-guide example: it doesn't take focus as it arrives. */
  example?: boolean
}>()

/** The notes' hint, as on an item's page. */
const NOTES_HINT = 'Markdown works: **bold**, *italic*, lists, links.'
/** Notes within 20,000 characters that the API still can't store (32 KB). */
const NOTES_TOO_BIG = 'These notes are too long to save. Shorten them, then add again.'
const TARGETS: Record<Section, number> = {
  exercise: NEW_EXERCISE_TARGET,
  cardio: NEW_CARDIO_TARGET,
  diet: NEW_FOOD_TARGET,
}

const planner = usePlannerStore()
const cardio = useCardioStore()
const diet = useDietStore()
const details = useDetailsStore()
const root = useTemplateRef<HTMLElement>('root')
const ids = { form: useId(), name: useId(), plan: useId(), notes: useId(), details: useId() }

const type = computed(() => SECTIONS[props.section])
const kind = computed(() =>
  props.section === 'exercise' ? 'exercise' : props.section === 'cardio' ? 'cardio' : 'food',
)
/** "Add exercise", "Add cardio", "Add food": the Add button's words, as Edit plan's. */
const addLabel = computed(() => `Add ${type.value.itemLabel.toLowerCase()}`)

/**
 * The sections the new item can fill: the plan always, first unless the type's arrangement moves
 * it, then notes and details where the arrangement shows them. Recent weeks has nothing yet.
 */
const sections = computed(() => {
  const arrangement = planner.arrangementFor(type.value.id)
  const shown = shownSections(arrangement)
  return arrangement.order.filter((k) => k === 'plan' || (k !== 'history' && shown.includes(k)))
})

const isCurrent = computed(() => planner.weekKey === planner.currentWeekKey)
const planHeading = computed(() =>
  isCurrent.value ? 'This week’s plan' : `Plan for the week of ${dayMonth(planner.monday)}`,
)
const planLine = computed(() =>
  isCurrent.value
    ? 'Adds it to this week’s plan, and the weeks after it that have no plan of their own.'
    : `Adds it to the plan for the week of ${dayMonth(planner.monday)}, and the weeks after it that have no plan of their own.`,
)

const name = ref('')
const nameError = ref<string | undefined>()
/** One set of one rep, three times a week (K104). */
const form = useExerciseForm()
form.load()
const cardioForm = useCardioForm()
const target = ref(TARGETS[props.section])
const planErrors = reactive<PlanErrors>({})

const notesOpen = ref(false)
const notes = ref('')
const notesError = ref<string | undefined>()
const notesCount = computed(() =>
  notes.value.length >= NOTES_COUNT_FROM ? MAX_DETAILS_NOTES : undefined,
)
const fieldDrafts = reactive<Record<string, string>>(
  Object.fromEntries(type.value.fields.map((f) => [f.key, ''])),
)
const fieldErrors = reactive<Record<string, string | undefined>>({})

// Arriving here opens at the top, where Add is, with the cursor in Name, the one field a new item
// needs. The week it came from may have been scrolled to its Add button.
onMounted(() => {
  if (props.example) return
  document.documentElement.scrollTop = 0
  focusName()
})
function focusName(): void {
  root.value!.querySelector<HTMLInputElement>(`#${CSS.escape(ids.name)}`)!.focus()
}

function onName(value: string | number | undefined): void {
  name.value = String(value ?? '')
  if (name.value.trim()) nameError.value = undefined
}
function onPlanChange(): void {
  Object.assign(planErrors, { sets: undefined, reps: undefined, weight: undefined })
  Object.assign(planErrors, { minutes: undefined, distance: undefined })
}
async function openNotes(): Promise<void> {
  notesOpen.value = true
  await nextTick()
  root.value!.querySelector<HTMLTextAreaElement>('textarea[data-testid="new-notes-field"]')!.focus()
}
function onNotes(text: string | undefined): void {
  notes.value = text ?? ''
  notesError.value = undefined
}
function onField(key: string, value: string | number | undefined): void {
  fieldDrafts[key] = String(value ?? '')
  fieldErrors[key] = undefined
}

/** Every message the fields would show on Add; true when there are none. */
function check(): boolean {
  nameError.value = name.value.trim() ? undefined : 'Enter a name.'
  Object.assign(
    planErrors,
    kind.value === 'exercise'
      ? exercisePlanErrors(form)
      : kind.value === 'cardio'
        ? cardioPlanErrors(cardioForm)
        : {},
  )
  const n = codePoints(notes.value.trim())
  notesError.value =
    n > MAX_DETAILS_NOTES
      ? `These notes are ${n.toLocaleString('en-US')} characters. Shorten them to ${MAX_DETAILS_NOTES.toLocaleString('en-US')} or fewer to add them.`
      : details.canSetNotes(props.section, null, notes.value)
        ? undefined
        : NOTES_TOO_BIG
  for (const f of type.value.fields) {
    const m = codePoints(fieldDrafts[f.key]!.trim())
    fieldErrors[f.key] =
      m > MAX_FIELD
        ? `This is ${m.toLocaleString('en-US')} characters. Shorten it to ${MAX_FIELD} or fewer to add it.`
        : undefined
  }
  return (
    !nameError.value &&
    !hasPlanErrors(planErrors) &&
    !notesError.value &&
    !Object.values(fieldErrors).some(Boolean)
  )
}

/**
 * Adds the item to the week the planner shows, with its notes and details, then goes back to the
 * week. Nothing is added while a field shows a message; focus goes to the first of them.
 */
async function add(): Promise<void> {
  if (!check()) {
    await nextTick()
    root.value!.querySelector<HTMLElement>('[aria-invalid="true"]')!.focus()
    return
  }
  // check() has made sure of a name, so the store adds it and gives its id.
  const title = name.value.trim()
  const id = (
    kind.value === 'exercise'
      ? planner.addExercise({ ...form.value(), name: title, target: target.value })
      : kind.value === 'cardio'
        ? cardio.addCardio({ ...cardioForm.value(), name: title, target: target.value })
        : diet.addFood({ name: title, target: target.value })
  )!
  if (notes.value.trim()) details.setNotes(props.section, id, notes.value)
  for (const f of type.value.fields) {
    if (fieldDrafts[f.key]!.trim()) details.setField(props.section, id, f.key, fieldDrafts[f.key]!)
  }
  leaveForWeek()
}
</script>

<!--
  The new item page (K104), at #/new/<section>: Edit plan's Add opens it in place of a dialog. It
  is an item's page (ItemPage card) for an item that doesn't exist yet, so it shares the item
  page's slot and with it the page's control sizes (main.css). The head's first line has
  Back to the week at its left and Cancel and Add exercise at its right, so Add is in view while
  the page fills. Then the type and the Name field, where an item's page has its name. The
  sections follow the type's arrangement, the plan always shown, Recent weeks never. Nothing is
  saved until Add, which adds the item with its notes and details and goes back to the week.
-->
<template>
  <div
    ref="root"
    class="flex flex-col pt-[calc(var(--u)*28)] pb-[calc(var(--u)*64)]"
    data-slot="item-page"
    data-testid="new-item-page"
  >
    <form :id="ids.form" novalidate @submit.prevent="add">
      <div class="flex flex-wrap items-center justify-between gap-x-[calc(var(--u)*16)] gap-y-2">
        <TextLink
          href="#/"
          class="inline-flex items-center gap-1.5 self-center text-(length:--set-text) [&_svg]:size-(--set-icon)"
          data-testid="back-to-week"
          @click="backToWeek"
          ><ChevronLeft :stroke-width="1.5" aria-hidden="true" />Back to the week</TextLink
        >
        <div class="flex items-center gap-[calc(var(--u)*12)]">
          <Button variant="quiet" data-testid="new-cancel" @click="leaveForWeek">Cancel</Button>
          <Button type="submit" variant="primary" data-testid="new-add">{{ addLabel }}</Button>
        </div>
      </div>
      <h1
        class="label mt-[calc(var(--u)*16)] text-(length:--set-label) leading-snug text-ink-secondary"
        data-testid="item-type"
      >
        New {{ type.itemLabel.toLowerCase() }}
      </h1>
      <TextField
        :id="ids.name"
        :model-value="name"
        label="Name"
        :error="nameError"
        class="mt-[calc(var(--u)*12)] mb-[calc(var(--u)*28)] w-full max-w-[max(20rem,calc(var(--u)*560))]"
        data-testid="new-name-field"
        @update:model-value="onName"
      />

      <template v-for="key in sections" :key="key">
        <section
          v-if="key === 'plan'"
          :aria-labelledby="ids.plan"
          :class="ROW"
          data-testid="item-plan"
        >
          <h2 :id="ids.plan" :class="H2">{{ planHeading }}</h2>
          <div :class="BODY">
            <p :class="LEDE" data-testid="item-plan-line">{{ planLine }}</p>
            <PlanFields
              :kind="kind"
              :form="form"
              :cardio-form="cardioForm"
              :target="target"
              :errors="planErrors"
              :id-base="ids.plan"
              @change="onPlanChange"
              @update:target="target = $event"
            />
          </div>
        </section>

        <section
          v-else-if="key === 'notes'"
          :aria-labelledby="ids.notes"
          :class="ROW"
          data-testid="item-notes"
        >
          <h2 :id="ids.notes" :class="H2">Notes</h2>
          <div :class="BODY">
            <TextArea
              v-if="notesOpen"
              :id="`${ids.notes}-field`"
              :model-value="notes"
              label="Notes"
              :aria-labelledby="ids.notes"
              :hint="NOTES_HINT"
              :error="notesError"
              :max-length="notesCount"
              rows="8"
              class="[&>label]:sr-only"
              data-testid="new-notes-field"
              @update:model-value="onNotes"
            />
            <Button v-else class="self-start" data-testid="new-notes-button" @click="openNotes"
              ><Pencil :stroke-width="1.5" />Add notes</Button
            >
          </div>
        </section>

        <section v-else :aria-labelledby="ids.details" :class="ROW" data-testid="item-details">
          <h2 :id="ids.details" :class="H2">Details</h2>
          <div :class="BODY">
            <div :class="FIELDS">
              <TextField
                v-for="f in type.fields"
                :id="`${ids.details}-${f.key}`"
                :key="f.key"
                :model-value="fieldDrafts[f.key]"
                :label="f.label"
                :error="fieldErrors[f.key]"
                :data-field="f.key"
                :class="f.key === 'link' && 'col-span-full'"
                @update:model-value="onField(f.key, $event)"
              />
            </div>
          </div>
        </section>
      </template>
    </form>
  </div>
</template>
