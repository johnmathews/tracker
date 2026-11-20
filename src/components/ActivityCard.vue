<script setup lang="ts">
import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Ellipsis,
  Trash2,
} from '@lucide/vue'
import {
  measureOf,
  renameActivity,
  ruleLine,
  setActivityField,
  setActivityKey,
  setMeasure,
  type Activity,
  type DraftSession,
  type Measure,
  type ProgrammeDoc,
  type Value,
} from '@/lib/programmeDraft'
import type { Field } from '@/lib/programmes'
import ValueField, { type ValueProblem } from '@/components/ValueField.vue'
import { IconButton } from '@/components/ui/icon-button'
import { InlineMessage } from '@/components/ui/inline-message'
import { Menu, MenuItem } from '@/components/ui/menu'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { TextArea } from '@/components/ui/text-area'
import { TextField } from '@/components/ui/text-field'
import { textLinkVariants } from '@/components/ui/text-link'

/** A problem inside the activity: `fieldId` is its path past the activity (`weight.add`), or null. */
export type ActivityProblem = { fieldId: string | null; message: string }

const props = defineProps<{
  /** The draft: the card reads and writes its activity there (spec F1). */
  doc: ProgrammeDoc
  /** Which keys follow their names (spec F5). */
  session: DraftSession
  index: number
  open: boolean
  problems: ActivityProblem[]
}>()

const emit = defineEmits<{
  /** The head was pressed: open the card, or close it. */
  toggle: []
  /** Move up (-1) or Move down (1). */
  move: [by: -1 | 1]
  remove: []
}>()

const id = useId()
const ids = { body: `${id}-body`, problem: `${id}-problem` }

const activity = computed<Activity>(() => props.doc.activities[props.index]!)
const cardio = computed(() => props.doc.kind === 'cardio')
const last = computed(() => props.index === props.doc.activities.length - 1)
const named = computed(() => activity.value.name || 'this activity')

/** The value lines, by kind and measure; and which of them the activity can go without (M2). */
const fields = computed<Field[]>(() => {
  if (cardio.value) return ['target', 'duration', 'distance']
  const measure = measureOf(activity.value)
  const per: Field[] = measure === 'reps' ? ['reps'] : measure === 'time' ? ['duration'] : []
  return [
    'target',
    'sets',
    ...per,
    ...(props.doc.kind === 'strength' ? (['weight'] as Field[]) : []),
  ]
})
const OPTIONAL: Field[] = ['sets', 'weight', 'distance']
const optional = (f: Field) => OPTIONAL.includes(f) || (cardio.value && f === 'duration')

// -- problems (spec F4) --

const head = (p: ActivityProblem) => p.fieldId?.split('.')[0] ?? null
const OWN = ['name', 'key', 'notes', 'link']
const MORE: (string | null)[] = ['key', 'notes', 'link']
const problemFor = (fieldId: string) => props.problems.find((p) => p.fieldId === fieldId)?.message
function valueProblems(field: Field): ValueProblem[] {
  return props.problems
    .filter((p) => head(p) === field)
    .map((p) => ({ sub: p.fieldId!.split('.')[1] ?? null, message: p.message }))
}
/** Problems with no field of their own in the open card: they show at its top. */
const general = computed(() =>
  props.problems.filter((p) => {
    const h = head(p)
    return h === null || (!OWN.includes(h) && !fields.value.includes(h as Field))
  }),
)
const describedBy = computed(() =>
  props.open || !props.problems.length
    ? undefined
    : props.problems.map((_, i) => `${ids.problem}-${i}`).join(' '),
)

// -- fields --

const name = computed({
  get: () => activity.value.name,
  set: (v: string) => renameActivity(props.doc, props.session, props.index, v),
})
const measure = computed({
  get: () => measureOf(activity.value),
  set: (v: string) => setMeasure(props.doc, activity.value, v as Measure),
})
const sides = computed({
  get: () => (activity.value.perSide ? 'each' : 'set'),
  set: (v: string) => setActivityField(activity.value, 'perSide', v === 'each' ? true : undefined),
})
const MEASURES = [
  { value: 'reps', label: 'Reps' },
  { value: 'time', label: 'Time' },
  { value: 'neither', label: 'Neither' },
]
const SIDES = [
  { value: 'set', label: 'Per set' },
  { value: 'each', label: 'Each side' },
]

function setValue(field: Field, value: Value | undefined): void {
  setActivityField(activity.value, field, value)
}

/** The key as typed, and why it can't be used, while another activity has it. */
const keyTyped = ref<string | null>(null)
const keyError = ref<string | null>(null)
function setKey(v: string | number | undefined): void {
  const key = String(v)
  keyTyped.value = key
  keyError.value = setActivityKey(props.doc, props.session, props.index, key)
}
const text = (field: 'notes' | 'link') =>
  computed({
    get: () => activity.value[field] ?? '',
    set: (v: string) => setActivityField(activity.value, field, v === '' ? undefined : v),
  })
const notes = text('notes')
const link = text('link')

/** One value line open at a time (ValueField card). */
const openValue = ref<Field | null>(null)
const moreOpen = ref(false)
// Closed, the card forgets which value was open.
watch(
  () => props.open,
  (open) => {
    if (!open) openValue.value = null
  },
)
watch(
  () => [props.open, props.problems],
  () => {
    if (props.problems.some((p) => MORE.includes(head(p)))) moreOpen.value = true
  },
  { immediate: true },
)

// -- focus from the foot bar (spec F4) --

const root = useTemplateRef<HTMLElement>('root')
const values = ref<InstanceType<typeof ValueField>[]>([])

/** Focuses the field a problem names, opening its value line or More; else the head. */
async function focusField(fieldId: string | null): Promise<void> {
  const [field, sub] = fieldId?.split('.') ?? []
  if (field && MORE.includes(field)) moreOpen.value = true
  const isValue = fields.value.includes(field as Field)
  if (isValue) openValue.value = sub === undefined ? null : (field as Field)
  await nextTick()
  if (isValue) {
    const at = fields.value.indexOf(field as Field)
    return values.value[at]!.focus(sub ?? null)
  }
  const target =
    field && OWN.includes(field)
      ? root.value!.querySelector<HTMLElement>(`[data-testid="activity-${field}"]`)!
      : root.value!.querySelector<HTMLElement>('[data-slot="activity-toggle"]')!
  target.focus()
}
defineExpose({ focusField })

const LINK = textLinkVariants()
const ERROR_LINE = 'caption flex items-start gap-2 text-(length:--set-caption) text-error-ink'
</script>

<!--
  The ActivityCard card (brand/design-system/project/components/ActivityCard): one activity in the
  programme builder. Closed, its name and its rule in a line, with any problem under it; open in
  place in 2px ink (K147), its fields: Name, Measure, Sides, a ValueField line per value, then More
  (key, notes, link). The ⋯ Menu moves or removes it. It reads and writes the draft (spec F1).
-->
<template>
  <li
    ref="root"
    class="rounded-lg bg-canvas"
    :class="
      open
        ? 'border-2 border-ink'
        : problems.length
          ? 'border border-error-ink'
          : 'border border-line'
    "
    data-testid="activity-card"
    :data-activity="activity.key"
  >
    <div class="flex items-start gap-2 py-3 pr-2 pl-3 folded:py-2 folded:pr-1 folded:pl-2">
      <button
        type="button"
        class="flex min-w-0 flex-auto cursor-pointer items-start gap-2.5 rounded-sm p-1 text-left text-ink hover:bg-tile"
        :aria-expanded="open ? 'true' : 'false'"
        :aria-controls="open ? ids.body : undefined"
        :aria-describedby="describedBy"
        data-slot="activity-toggle"
        @click="emit('toggle')"
      >
        <component
          :is="open ? ChevronDown : ChevronRight"
          :stroke-width="1.5"
          class="mt-px size-(--set-icon) shrink-0 text-ink-secondary"
          aria-hidden="true"
        />
        <span class="min-w-0">
          <span
            class="block text-[max(18px,calc(var(--u)*22))] leading-[1.3] font-semibold wrap-anywhere folded:text-[calc(var(--n)*18)]"
            :class="!activity.name && 'text-ink-secondary'"
            >{{ activity.name || 'No name yet' }}</span
          >
          <span class="block text-(length:--set-text) leading-[1.45] text-ink-secondary">{{
            ruleLine(doc, activity)
          }}</span>
          <template v-if="!open">
            <span
              v-for="(p, i) in problems"
              :id="`${ids.problem}-${i}`"
              :key="`${p.fieldId}:${p.message}`"
              :class="ERROR_LINE"
              class="mt-1"
              data-testid="activity-problem"
              ><CircleAlert
                :size="16"
                :stroke-width="1.5"
                class="mt-0.5 shrink-0"
                aria-hidden="true"
              /><span>{{ p.message }}</span></span
            >
          </template>
        </span>
      </button>
      <Menu>
        <template #trigger>
          <IconButton
            :label="`More for ${named}`"
            class="size-[max(44px,calc(var(--u)*52))] folded:h-12 folded:w-11"
            data-testid="activity-menu"
            ><Ellipsis
          /></IconButton>
        </template>
        <MenuItem v-if="index > 0" data-testid="activity-move-up" @select="emit('move', -1)"
          ><template #icon><ArrowUp /></template>Move up</MenuItem
        >
        <MenuItem v-if="!last" data-testid="activity-move-down" @select="emit('move', 1)"
          ><template #icon><ArrowDown /></template>Move down</MenuItem
        >
        <MenuItem data-testid="activity-remove" @select="emit('remove')"
          ><template #icon><Trash2 /></template>Remove</MenuItem
        >
      </Menu>
    </div>

    <div
      v-if="open"
      :id="ids.body"
      role="group"
      :aria-label="activity.name || 'This activity'"
      class="flex flex-col gap-[calc(var(--u)*22)] pt-1 pr-5 pb-5 pl-[calc(var(--u)*54)] folded:gap-[18px] folded:px-3 folded:pb-4"
    >
      <div v-if="general.length" class="flex flex-col gap-1" data-slot="activity-errors">
        <InlineMessage v-for="p in general" :key="`${p.fieldId}:${p.message}`" tone="error">{{
          p.message
        }}</InlineMessage>
      </div>
      <TextField
        v-model="name"
        label="Name"
        :error="problemFor('name')"
        data-testid="activity-name"
      />
      <template v-if="!cardio">
        <SegmentedControl
          v-model="measure"
          label="Measure"
          :options="MEASURES"
          data-testid="activity-measure"
        />
        <SegmentedControl
          v-model="sides"
          label="Sides"
          :options="SIDES"
          data-testid="activity-sides"
        />
      </template>
      <ul class="border-t border-line" :aria-label="`${activity.name || 'This activity'}’s values`">
        <ValueField
          v-for="f in fields"
          :key="f"
          ref="values"
          :doc="doc"
          :field="f"
          :value="activity[f]"
          :optional="optional(f)"
          :activity="activity.name"
          :open="openValue === f"
          :problems="valueProblems(f)"
          @toggle="openValue = openValue === f ? null : f"
          @update="(v) => setValue(f, v)"
        />
      </ul>
      <button
        type="button"
        :class="LINK"
        class="inline-flex items-center gap-1.5 self-start text-(length:--set-text) [&_svg]:size-5.5"
        :aria-expanded="moreOpen ? 'true' : 'false'"
        :aria-controls="moreOpen ? `${id}-more` : undefined"
        data-testid="activity-more"
        @click="moreOpen = !moreOpen"
      >
        <component :is="moreOpen ? ChevronDown : ChevronRight" :stroke-width="1.5" />More: key,
        notes, link
      </button>
      <div v-if="moreOpen" :id="`${id}-more`" class="flex flex-col gap-[calc(var(--u)*22)]">
        <TextField
          :model-value="keyTyped ?? activity.key"
          label="Key"
          hint="Runs started from now use it as the item’s id. Lowercase letters, numbers and dashes."
          :error="keyError ?? problemFor('key')"
          spellcheck="false"
          autocapitalize="none"
          data-testid="activity-key"
          @update:model-value="setKey"
        />
        <TextArea
          v-model="notes"
          label="Notes"
          hint="Markdown. Each run’s item shows it."
          :error="problemFor('notes')"
          rows="3"
          data-testid="activity-notes"
        />
        <TextField
          v-model="link"
          label="Link"
          :error="problemFor('link')"
          inputmode="url"
          spellcheck="false"
          autocapitalize="none"
          data-testid="activity-link"
        />
      </div>
    </div>
  </li>
</template>
