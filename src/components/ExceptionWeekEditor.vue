<script setup lang="ts">
import { computed, nextTick, reactive, ref, useId, useTemplateRef, watch } from 'vue'
import { ChevronDown, CircleAlert, Pencil, Plus, Trash2, X } from '@lucide/vue'
import {
  fieldLabel,
  formatWeeks,
  isRest,
  overrideMode,
  overrideNumber,
  overrideValue,
  parseWeeks,
  setOverrideField,
  setOverrideValue,
  setRest,
  switchShape,
  type OverrideMode,
  type OverrideValue,
  type ProgrammeDoc,
} from '@/lib/programmeDraft'
import type { Field } from '@/lib/programmes'
import { durationText } from '@/lib/words'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/ui/icon-button'
import { InlineMessage } from '@/components/ui/inline-message'
import { Menu, MenuItem } from '@/components/ui/menu'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { TextField, textFieldVariants } from '@/components/ui/text-field'
import { textLinkVariants } from '@/components/ui/text-link'

/**
 * A problem inside the exception week: `fieldId` is its path past the week (`weeks`, `label`,
 * `activities.deadlift.sets`, `activities.*`), or null.
 */
export type OverrideProblem = { fieldId: string | null; message: string }

const props = defineProps<{
  /** The draft: the editor reads and writes its exception week there (spec F1). */
  doc: ProgrammeDoc
  /** The exception week's place in `overrides`. */
  index: number
  open: boolean
  problems: OverrideProblem[]
}>()

const emit = defineEmits<{
  /** The pencil or the head was pressed: open the week, or close it. */
  toggle: []
  /** Remove exception week was pressed. */
  remove: []
}>()

const id = useId()
const ids = { body: `${id}-body`, problem: `${id}-problem`, rest: `${id}-rest` }

const override = computed(() => props.doc.overrides![props.index]!)
const kind = computed(() => props.doc.kind)
const EVERY = '*'

// -- words --

function listText(items: string[]): string {
  if (items.length < 2) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

/** "Weeks 4 and 8 · Deload", "Week 4", "No weeks yet". */
const weeksWords = computed(() => {
  const weeks = override.value.weeks
  if (!weeks.length) return null
  return `${weeks.length === 1 ? 'Week' : 'Weeks'} ${listText(weeks.map(String))}`
})
const head = computed(() =>
  [weeksWords.value ?? 'No weeks yet', override.value.label].filter(Boolean).join(' · '),
)
const pencilLabel = computed(() =>
  weeksWords.value ? `Change ${weeksWords.value.toLowerCase()}` : 'Change this exception week',
)

const activityAt = (key: string) => props.doc.activities.findIndex((a) => a.key === key)
/** A group's name: Every activity, the activity's name, or the key no activity has. */
function groupName(key: string): string {
  if (key === EVERY) return 'Every activity'
  const i = activityAt(key)
  if (i < 0) return key
  return props.doc.activities[i]!.name || `Activity ${i + 1}`
}

const label = (field: Field) => fieldLabel(kind.value, field)
/** A cardio session's time is typed and read in minutes; the document keeps seconds. */
const minutes = (field: Field) => kind.value === 'cardio' && field === 'duration'

/** One value in words: "3 sets", "90% of the weight", "30 min". */
function valueWords(field: Field, v: OverrideValue): string {
  const n = overrideNumber(v)
  if (overrideMode(v) === 'percent') return `${n}% of the ${label(field).toLowerCase()}`
  const counted = (one: string, many: string) => `${n} ${n === 1 ? one : many}`
  switch (field) {
    case 'target':
      return `${counted('time', 'times')} a week`
    case 'sets':
      return counted('set', 'sets')
    case 'reps':
      return counted('rep', 'reps')
    case 'weight':
      return `${n} kg`
    case 'distance':
      return `${n} km`
    case 'duration':
      return minutes(field) ? durationText(n) : `${n} s`
  }
}

/** The groups in the order they show: Every activity, then the activities, then other keys. */
const ORDER = (key: string) =>
  key === EVERY ? -1 : activityAt(key) < 0 ? Infinity : activityAt(key)
const byOrder = (keys: string[]) => [...keys].sort((a, b) => ORDER(a) - ORDER(b))

/**
 * "Rest: Back squat, Deadlift." first (K191), then "Every activity: 3 sets, 90% of the weight.",
 * one per group with values other than its rest.
 */
const lines = computed(() => {
  const keys = byOrder(Object.keys(override.value.activities))
  const rested = keys.filter((key) => isRest(override.value, key))
  const rest = rested.includes(EVERY)
    ? ['Rest: every activity.']
    : rested.length
      ? [`Rest: ${rested.map(groupName).join(', ')}.`]
      : []
  const found = keys.flatMap((key) => {
    const entry = entryOf(key)
    const values = rowsOf(key).map((f) => valueWords(f, entry[f]!))
    return values.length ? [`${groupName(key)}: ${values.join(', ')}.`] : []
  })
  const all = [...rest, ...found]
  return all.length ? all : ['No values yet.']
})

// -- problems (spec F4) --

const parts = (p: OverrideProblem) => p.fieldId?.split('.') ?? []
const problemFor = (fieldId: string) => props.problems.find((p) => p.fieldId === fieldId)?.message
const hasRow = (key: string, field: string) =>
  groups.value.includes(key) && (rowsOf(key) as string[]).includes(field)
/** A rest's Times a week shows as a ticked row of the rest list, so its problem shows there. */
const onRestList = (key: string, field: string | undefined) =>
  field === 'target' && restRows.value.some((r) => r.key === key) && isRest(override.value, key)
/** A group's own problems, and its fields' that have no row. */
function groupProblems(key: string): OverrideProblem[] {
  return props.problems.filter((p) => {
    const [head, k, f] = parts(p)
    if (head !== 'activities' || k !== key) return false
    return f === undefined || (!hasRow(key, f) && !onRestList(key, f))
  })
}
/** Problems with no field, rest or group of their own: they show at the top. */
const general = computed(() =>
  props.problems.filter((p) => {
    const [head, k, f] = parts(p)
    if (head === 'weeks' || head === 'label') return false
    if (head !== 'activities' || k === undefined) return true
    return !groups.value.includes(k) && !onRestList(k, f)
  }),
)
const describedBy = computed(() =>
  props.open || !props.problems.length
    ? undefined
    : props.problems.map((_, i) => `${ids.problem}-${i}`).join(' '),
)

// -- the fields --

/** What was typed, kept while it can't be written, so it can be fixed. */
const typed = reactive<Record<string, string>>({})
const bad = reactive<Record<string, string>>({})
/** Activities pressed in Add values for one activity, waiting for their first value. */
const pending = ref<string[]>([])
watch(
  () => props.open,
  () => {
    for (const k of Object.keys(typed)) delete typed[k]
    for (const k of Object.keys(bad)) delete bad[k]
    pending.value = []
  },
)

const weeksText = computed(() => typed.weeks ?? formatWeeks(override.value.weeks))
function setWeeks(raw: string | number | undefined): void {
  const text = String(raw)
  typed.weeks = text
  const parsed = parseWeeks(text)
  if ('error' in parsed) {
    bad.weeks = parsed.error
    return
  }
  delete bad.weeks
  setOverrideField(override.value, 'weeks', parsed.weeks)
}

const labelText = computed({
  get: () => override.value.label ?? '',
  set: (v: string) => setOverrideField(override.value, 'label', v === '' ? undefined : v),
})

// -- the rest list (K191) --

/**
 * Every activity, then each activity. A row is ticked when its key rests, or when Every activity
 * rests and the activity has no Times a week of its own: then it is disabled, resting through
 * Every activity. An activity's own Times a week beats Every activity's (K153).
 */
const restRows = computed(() => {
  const every = isRest(override.value, EVERY)
  return [
    { key: EVERY, name: 'Every activity' },
    ...props.doc.activities.map((a, i) => ({ key: a.key, name: a.name || `Activity ${i + 1}` })),
  ].map((row) => {
    const through = row.key !== EVERY && every && !('target' in entryOf(row.key))
    return { ...row, checked: through || isRest(override.value, row.key), disabled: through }
  })
})
const restError = (key: string) =>
  onRestList(key, 'target') ? problemFor(`activities.${key}.target`) : undefined
const restErrorId = (i: number) => `${ids.rest}-${i}-error`

// -- the groups --

const entryOf = (key: string) => override.value.activities[key] ?? {}
/** A group's value rows: its fields, but a rest, which the rest list shows. */
const rowsOf = (key: string) =>
  (Object.keys(entryOf(key)) as Field[]).filter(
    (f) => !(f === 'target' && isRest(override.value, key)),
  )
/** Every activity, then each key with a value to show, then the groups waiting for one. */
const groups = computed(() => {
  const shown = Object.keys(override.value.activities).filter(
    (k) => k !== EVERY && rowsOf(k).length,
  )
  const waiting = pending.value.filter((k) => !shown.includes(k))
  return byOrder([EVERY, ...shown, ...waiting])
})

/** The value fields in the format's order, and each kind's. */
const FIELDS: Field[] = ['target', 'sets', 'reps', 'duration', 'weight', 'distance']
const KIND_FIELDS: Record<ProgrammeDoc['kind'], Field[]> = {
  strength: ['target', 'sets', 'reps', 'duration', 'weight'],
  mobility: ['target', 'sets', 'reps', 'duration'],
  cardio: ['target', 'duration', 'distance'],
}
/** The fields an activity has; every activity has Times a week. */
function activityFields(i: number): Field[] {
  const a = props.doc.activities[i]!
  return FIELDS.filter((f) => f === 'target' || f in a)
}
/** What Add a value offers: the fields the group's activities have that it doesn't set yet. */
function addable(key: string): Field[] {
  const has =
    key === EVERY
      ? new Set(props.doc.activities.flatMap((_, i) => activityFields(i)))
      : activityAt(key) < 0
        ? new Set(KIND_FIELDS[kind.value])
        : new Set(activityFields(activityAt(key)))
  return FIELDS.filter((f) => has.has(f) && !(f in entryOf(key)))
}
/** What Add values for one activity offers: the activities with no group yet. */
const ungrouped = computed(() =>
  props.doc.activities
    .map((a, i) => ({ key: a.key, name: a.name || `Activity ${i + 1}` }))
    .filter((a) => !groups.value.includes(a.key)),
)

/** A field's first value: Set to the number a new field starts at. */
const startOf = (field: Field) => switchShape(props.doc, field, undefined, 'number') as number

const root = useTemplateRef<HTMLElement>('root')
/**
 * Focus moves on once the Menu has closed: Reka returns it to the trigger a task after closing,
 * so this waits a task past that.
 */
function focusLater(find: () => HTMLElement | null | undefined): void {
  setTimeout(() => setTimeout(() => find()?.focus(), 0), 0)
}
const groupEl = (key: string) =>
  root.value?.querySelector<HTMLElement>(
    `[data-testid="exception-group"][data-activity="${CSS.escape(key)}"]`,
  )
const addValueLink = (key: string) =>
  groupEl(key)?.querySelector<HTMLElement>('[data-testid="exception-value-add"]')

function addValue(key: string, field: Field): void {
  setOverrideValue(override.value, key, field, startOf(field))
  // A group waiting for its first value has one now.
  pending.value = pending.value.filter((k) => k !== key)
  focusLater(() =>
    groupEl(key)?.querySelector<HTMLElement>(
      `[data-testid="exception-value"][data-field="${field}"] input`,
    ),
  )
}

function addGroup(key: string): void {
  pending.value.push(key)
  focusLater(() => addValueLink(key))
}

function removeValue(key: string, field: Field): void {
  setOverrideValue(override.value, key, field, undefined)
  focusLater(
    () =>
      addValueLink(key) ??
      root.value?.querySelector<HTMLElement>('[data-testid="exception-group-add"]'),
  )
}

const MODES = [
  { value: 'set', label: 'Set to' },
  { value: 'percent', label: '% of planned' },
]
/**
 * Switching mode starts afresh: Set to the field's first number, or 100% of planned. Pressing the
 * mode it has already does nothing (SegmentedControl).
 */
function setMode(key: string, field: Field, mode: string): void {
  delete typed[`${key}.${field}`]
  delete bad[`${key}.${field}`]
  setOverrideValue(
    override.value,
    key,
    field,
    mode === 'set' ? startOf(field) : overrideValue('percent', 100),
  )
}

const scaleOf = (field: Field, mode: OverrideMode) => (mode === 'set' && minutes(field) ? 60 : 1)
function numberText(key: string, field: Field): string {
  const v = entryOf(key)[field]!
  const at = `${key}.${field}`
  if (typed[at] !== undefined) return typed[at]
  const mode = overrideMode(v)
  return String(Math.round((overrideNumber(v) / scaleOf(field, mode)) * 1e6) / 1e6)
}
function unitOf(key: string, field: Field): string {
  if (overrideMode(entryOf(key)[field]!) === 'percent') return '%'
  if (minutes(field)) return 'min'
  return { target: 'a week', sets: '', reps: '', duration: 's', weight: 'kg', distance: 'km' }[
    field
  ]
}
function setNumber(key: string, field: Field, ev: Event): void {
  const text = (ev.target as HTMLInputElement).value
  const at = `${key}.${field}`
  typed[at] = text
  const t = text.trim().replace(',', '.')
  const mode = overrideMode(entryOf(key)[field]!)
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) {
    bad[at] = `Type a number, like ${mode === 'percent' ? 90 : startOf(field)}.`
    return
  }
  delete bad[at]
  const n = Math.round(Number(t) * scaleOf(field, mode) * 1e6) / 1e6
  setOverrideValue(override.value, key, field, overrideValue(mode, n))
}
const rowError = (key: string, field: Field) =>
  bad[`${key}.${field}`] ?? problemFor(`activities.${key}.${field}`)
const rowId = (key: string, field: Field) => `${id}-${key === EVERY ? 'every' : key}-${field}`

// -- focus (the card's accessibility) --

const weeksField = () =>
  root.value?.querySelector<HTMLElement>('input[data-testid="exception-weeks"]')
watch(
  () => props.open,
  async (open) => {
    await nextTick()
    if (open) return weeksField()?.focus()
    const at = document.activeElement
    if (at === document.body || root.value!.contains(at)) {
      root.value!.querySelector<HTMLElement>('[data-testid="exception-open"]')!.focus()
    }
  },
  { flush: 'post' },
)

/** Focuses the field a problem names: Label, a value's number, a group's Add a value; else Weeks. */
async function focusField(fieldId: string | null): Promise<void> {
  await nextTick()
  const [head, key, field] = fieldId?.split('.') ?? []
  const target =
    (head === 'label' &&
      root.value!.querySelector<HTMLElement>('input[data-testid="exception-label"]')) ||
    (head === 'activities' &&
      key !== undefined &&
      onRestList(key, field) &&
      root.value!.querySelector<HTMLElement>(
        `[data-testid="exception-rest-row"][data-rest="${CSS.escape(key)}"]`,
      )) ||
    (head === 'activities' &&
      key !== undefined &&
      (field === undefined
        ? addValueLink(key)
        : groupEl(key)?.querySelector<HTMLElement>(
            `[data-testid="exception-value"][data-field="${field}"] input`,
          ))) ||
    weeksField()!
  target.focus()
}
defineExpose({ focusField })

const LINK = textLinkVariants()
const ERROR_LINE = 'caption flex items-start gap-2 text-(length:--set-caption) text-error-ink'
const NAME = 'block text-(length:--set-label) leading-[1.3] font-semibold'
const LINE = 'block text-(length:--set-text) leading-[1.45]'
const SECTION_BUTTON = 'h-[max(44px,calc(var(--u)*52))] text-(length:--set-label) folded:h-12'
</script>

<!--
  The ExceptionWeekEditor card (brand/design-system/project/components/ExceptionWeekEditor): one
  exception week in the programme builder, such as a deload. Closed, a row that says what it
  changes, with a pencil; open in place in 2px ink (K147), its weeks typed as "4, 8", its label,
  a group of values for every activity and one per activity, each value Set to a number or a
  percentage of the planned value (spec §5.4). It reads and writes the draft (spec F1).
-->
<template>
  <li
    v-if="!open"
    ref="root"
    class="flex items-start gap-3 border-b border-line py-3.5"
    data-testid="exception-week"
  >
    <span class="min-w-0 flex-auto">
      <span
        :class="[NAME, !weeksWords && 'text-ink-secondary']"
        class="wrap-anywhere"
        data-slot="exception-head"
        >{{ head }}</span
      >
      <span v-for="line in lines" :key="line" :class="LINE" data-slot="exception-line">{{
        line
      }}</span>
      <span
        v-for="(p, i) in problems"
        :id="`${ids.problem}-${i}`"
        :key="`${p.fieldId}:${p.message}`"
        :class="ERROR_LINE"
        class="mt-1"
        data-testid="exception-problem"
        ><CircleAlert
          :size="16"
          :stroke-width="1.5"
          class="mt-0.5 shrink-0"
          aria-hidden="true"
        /><span>{{ p.message }}</span></span
      >
    </span>
    <IconButton
      :label="pencilLabel"
      aria-expanded="false"
      :aria-describedby="describedBy"
      class="size-[max(44px,calc(var(--u)*52))] folded:h-12 folded:w-11"
      data-testid="exception-open"
      @click="emit('toggle')"
      ><Pencil
    /></IconButton>
  </li>

  <li
    v-else
    ref="root"
    class="my-3 rounded-lg border-2 border-ink bg-canvas"
    data-testid="exception-week"
  >
    <div class="flex items-start gap-2 py-3 pr-2 pl-3 folded:py-2 folded:pr-1 folded:pl-2">
      <button
        type="button"
        class="flex min-w-0 flex-auto cursor-pointer items-start gap-2.5 rounded-sm p-1 text-left text-ink hover:bg-tile"
        aria-expanded="true"
        :aria-controls="ids.body"
        data-slot="exception-toggle"
        @click="emit('toggle')"
      >
        <ChevronDown
          :stroke-width="1.5"
          class="mt-px size-(--set-icon) shrink-0 text-ink-secondary"
          aria-hidden="true"
        />
        <span class="min-w-0">
          <span
            class="block text-[max(18px,calc(var(--u)*22))] leading-[1.3] font-semibold wrap-anywhere folded:text-[calc(var(--n)*18)]"
            :class="!weeksWords && 'text-ink-secondary'"
            data-slot="exception-head"
            >{{ head }}</span
          >
          <span class="block text-(length:--set-text) leading-[1.45] text-ink-secondary">{{
            lines.join(' ')
          }}</span>
        </span>
      </button>
    </div>

    <div
      :id="ids.body"
      role="group"
      aria-label="Exception week"
      class="flex flex-col gap-[calc(var(--u)*22)] pt-1 pr-5 pb-5 pl-[calc(var(--u)*54)] folded:gap-[18px] folded:px-3 folded:pb-4"
    >
      <div v-if="general.length" class="flex flex-col gap-1" data-slot="exception-errors">
        <InlineMessage v-for="p in general" :key="`${p.fieldId}:${p.message}`" tone="error">{{
          p.message
        }}</InlineMessage>
      </div>
      <TextField
        :model-value="weeksText"
        label="Weeks"
        :hint="`Week numbers from 1 to ${doc.weeks}, with commas.`"
        :error="bad.weeks ?? problemFor('weeks')"
        inputmode="numeric"
        data-testid="exception-weeks"
        @update:model-value="setWeeks"
      />
      <TextField
        v-model="labelText"
        label="Label"
        hint="Optional. The grid shows it over each of these weeks."
        :error="problemFor('label')"
        data-testid="exception-label"
      />

      <div
        role="group"
        :aria-labelledby="ids.rest"
        class="flex flex-col gap-3 rounded-md bg-tile p-4 folded:p-3"
        data-testid="exception-rest"
      >
        <span :id="ids.rest" :class="NAME">Rest these activities</span>
        <ul class="flex flex-col">
          <li
            v-for="(row, i) in restRows"
            :key="`${i}:${row.key}`"
            class="border-control-border not-first:border-t"
          >
            <Checkbox
              :model-value="row.checked"
              :label="row.name"
              :disabled="row.disabled"
              class="w-full text-(length:--set-text) leading-[1.3]"
              data-testid="exception-rest-row"
              :data-rest="row.key"
              :aria-invalid="restError(row.key) ? 'true' : undefined"
              :aria-describedby="restError(row.key) ? restErrorId(i) : undefined"
              @update:model-value="(on: boolean) => setRest(override, row.key, on)"
            />
            <InlineMessage
              v-if="restError(row.key)"
              :id="restErrorId(i)"
              tone="error"
              class="pb-3"
              data-testid="exception-rest-problem"
              >{{ restError(row.key) }}</InlineMessage
            >
          </li>
        </ul>
        <p class="caption text-(length:--set-caption) leading-[1.35] text-ink-secondary">
          A rested activity has no sessions in these weeks.
        </p>
      </div>

      <div
        v-for="key in groups"
        :key="key"
        role="group"
        :aria-label="groupName(key)"
        class="flex flex-col gap-4 rounded-md bg-tile p-4 folded:gap-3 folded:p-3"
        data-testid="exception-group"
        :data-activity="key"
      >
        <span :class="NAME">{{ groupName(key) }}</span>
        <div
          v-for="(field, j) in rowsOf(key)"
          :key="field"
          class="flex flex-wrap items-center gap-x-3 gap-y-2.5"
          :class="j > 0 && 'border-t border-control-border pt-3'"
          data-testid="exception-value"
          :data-field="field"
        >
          <div class="-my-1.5 flex basis-full items-center justify-between gap-3">
            <span :id="rowId(key, field)" :class="NAME" data-slot="exception-value-name">{{
              label(field)
            }}</span>
            <IconButton
              :label="`Remove ${label(field).toLowerCase()} from this group`"
              class="size-11"
              data-testid="exception-value-remove"
              @click="removeValue(key, field)"
              ><X
            /></IconButton>
          </div>
          <SegmentedControl
            :model-value="overrideMode(entryOf(key)[field]!)"
            :ariaLabel="label(field)"
            :options="MODES"
            data-testid="exception-value-mode"
            @update:model-value="(m) => setMode(key, field, m)"
          />
          <span class="flex items-center gap-2.5">
            <input
              :value="numberText(key, field)"
              :class="textFieldVariants()"
              class="w-[calc(var(--u)*110)] min-w-[96px]"
              data-slot="text-field-input"
              inputmode="decimal"
              :aria-labelledby="rowId(key, field)"
              :aria-invalid="rowError(key, field) ? 'true' : undefined"
              :aria-describedby="rowError(key, field) ? `${rowId(key, field)}-error` : undefined"
              @input="(ev) => setNumber(key, field, ev)"
            />
            <span class="text-(length:--set-text) text-ink-secondary">{{
              unitOf(key, field)
            }}</span>
          </span>
          <InlineMessage
            v-if="rowError(key, field)"
            :id="`${rowId(key, field)}-error`"
            tone="error"
            class="basis-full"
            >{{ rowError(key, field) }}</InlineMessage
          >
        </div>
        <div
          v-if="groupProblems(key).length"
          class="flex flex-col gap-1"
          data-slot="exception-group-errors"
        >
          <InlineMessage
            v-for="p in groupProblems(key)"
            :key="`${p.fieldId}:${p.message}`"
            tone="error"
            >{{ p.message }}</InlineMessage
          >
        </div>
        <Menu v-if="addable(key).length" align="start">
          <template #trigger>
            <button
              type="button"
              :class="LINK"
              class="self-start text-(length:--set-caption)"
              data-testid="exception-value-add"
            >
              Add a value
            </button>
          </template>
          <MenuItem v-for="f in addable(key)" :key="f" @select="addValue(key, f)">{{
            label(f)
          }}</MenuItem>
        </Menu>
        <p
          v-if="key !== EVERY"
          class="caption text-(length:--set-caption) leading-[1.35] text-ink-secondary"
        >
          {{ groupName(key) }}’s own value beats the value for every activity.
        </p>
      </div>

      <div v-if="ungrouped.length">
        <Menu align="start">
          <template #trigger>
            <Button :class="SECTION_BUTTON" data-testid="exception-group-add"
              ><Plus :stroke-width="1.5" />Add values for one activity</Button
            >
          </template>
          <MenuItem v-for="a in ungrouped" :key="a.key" @select="addGroup(a.key)">{{
            a.name
          }}</MenuItem>
        </Menu>
      </div>
      <div>
        <Button
          variant="quiet"
          :class="SECTION_BUTTON"
          data-testid="exception-remove"
          @click="emit('remove')"
          ><Trash2 :stroke-width="1.5" />Remove exception week</Button
        >
      </div>
    </div>
  </li>
</template>
