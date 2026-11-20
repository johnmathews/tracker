<script setup lang="ts">
import { computed, nextTick, reactive, ref, toRaw, useId, watch } from 'vue'
import { Check, ChevronDown, ChevronRight, CircleAlert, Hash } from '@lucide/vue'
import {
  choiceOf,
  choose,
  fieldLabel,
  growsBy,
  paramText,
  setGrowsBy,
  setProgressionField,
  switchShape,
  valueLine,
  type Choice,
  type GrowsBy,
  type ProgrammeDoc,
  type Progression,
  type Scalar,
  type Value,
} from '@/lib/programmeDraft'
import type { Field } from '@/lib/programmes'
import { durationText } from '@/lib/words'
import { InlineMessage } from '@/components/ui/inline-message'
import { Menu, MenuItem } from '@/components/ui/menu'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Stepper } from '@/components/ui/stepper'
import { TextField } from '@/components/ui/text-field'
import { textLinkVariants } from '@/components/ui/text-link'

/** A problem inside the value: `sub` is the progression's key it names, or null for the whole. */
export type ValueProblem = { sub: string | null; message: string }

const props = defineProps<{
  /** The draft, for the words and the values chosen at start. */
  doc: ProgrammeDoc
  field: Field
  /** As the draft holds it: absent, a number, a `"$key"` or a progression (spec F2). */
  value: Value | undefined
  /** The activity can go without it: None is offered. */
  optional: boolean
  /** The activity's name, for None's hint. */
  activity: string
  open: boolean
  problems: ValueProblem[]
}>()

const emit = defineEmits<{
  /** The line was pressed: open it, or close it. */
  toggle: []
  /** The value to write at the field's path; undefined leaves the key out. */
  update: [value: Value | undefined]
}>()

const id = useId()
const ids = {
  group: `${id}-group`,
  error: `${id}-error`,
  line: `${id}-line`,
  limits: `${id}-limits`,
}

/** The unit a field's numbers are in, after the field and on Grows by's unit segment. */
const UNIT: Record<Field, string> = {
  target: 'times',
  sets: 'sets',
  reps: 'reps',
  duration: 's',
  weight: 'kg',
  distance: 'km',
}
/** What a field rounds to when its progression has no `step` (programmes.md §3). */
const STEP: Record<Field, number> = {
  target: 1,
  sets: 1,
  reps: 1,
  duration: 5,
  weight: 0.5,
  distance: 0.1,
}
const WHOLE: Field[] = ['target', 'sets', 'reps']
const MEASURES = ['kg', 'km', 's', 'min', '%']

const label = computed(() => fieldLabel(props.doc.kind, props.field))
/** A cardio session's time is typed in minutes; the document keeps seconds. */
const minutes = computed(() => props.doc.kind === 'cardio' && props.field === 'duration')
const scale = computed(() => (minutes.value ? 60 : 1))
const unit = computed(() => (minutes.value ? 'min' : UNIT[props.field]))
/** A field the activity can't go without, left out, shows the number the format gives it. */
const shown = computed<Value | undefined>(() =>
  props.value === undefined && !props.optional
    ? switchShape(props.doc, props.field, undefined, 'number')
    : props.value,
)
const choice = computed(() => choiceOf(shown.value))
const progression = computed(() =>
  typeof shown.value === 'object' ? (shown.value as Progression) : null,
)
/** Read only while the value grows. */
const by = computed<GrowsBy>(() => growsBy(progression.value!))
const words = computed(() => valueLine(props.doc, props.field, shown.value))

const choices = computed(() => [
  ...(props.optional ? [{ value: 'none', label: 'None' }] : []),
  { value: 'stays', label: 'Stays the same' },
  { value: 'grows', label: 'Grows' },
])
const byOptions = computed(() => [
  { value: 'add', label: unit.value },
  { value: 'rate', label: '%' },
])

// -- problems --

const whole = computed(() => props.problems.filter((p) => p.sub === null))
/** Each whole-value problem's id, for the line (closed) or the group (open) to name. */
const wholeIds = computed(
  () => whole.value.map((_, i) => `${ids.error}-${i}`).join(' ') || undefined,
)
const problemFor = (sub: string) => props.problems.find((p) => p.sub === sub)?.message

// -- typing --

/** What each number field holds as typed: kept while it isn't a number, so it can be fixed. */
const typed = reactive<Record<string, string>>({})
const bad = reactive<Record<string, string>>({})
watch(
  () => [props.open, choice.value],
  () => {
    for (const k of Object.keys(typed)) delete typed[k]
    for (const k of Object.keys(bad)) delete bad[k]
  },
)

function numberText(n: number | undefined, scaled = true): string {
  if (n === undefined) return ''
  return String(scaled ? Math.round((n / scale.value) * 1e6) / 1e6 : n)
}
function parse(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (t === '' || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null
  return Number(t)
}
const text = (key: string, n: Scalar | undefined, scaled = true) =>
  typed[key] ?? numberText(typeof n === 'number' ? n : undefined, scaled)

/** Writes a typed number, or keeps the text and says what to type. Empty leaves `optional` out. */
function onType(
  key: string,
  raw: string | number | undefined,
  write: (n: number | undefined) => void,
  example: string,
  { optional = false, scaled = true } = {},
): void {
  const t = String(raw)
  typed[key] = t
  const n = parse(t)
  if (n === null && !(optional && t.trim() === '')) {
    bad[key] = optional
      ? `Type a number, like ${example}, or leave it empty.`
      : `Type a number, like ${example}.`
    return
  }
  delete bad[key]
  write(n === null ? undefined : scaled ? Math.round(n * scale.value * 1e6) / 1e6 : n)
}

// -- writing --

function setChoice(next: string): void {
  emit('update', choose(props.doc, props.field, shown.value, next as Choice))
}

/** A progression's copy, changed and written: keys keep their places (B3). */
function edit(change: (p: Progression) => void): void {
  const p = structuredClone(toRaw(progression.value!))
  change(p)
  emit('update', p)
}

function setBy(next: string): void {
  edit((p) => setGrowsBy(p, next as GrowsBy))
}

const every = computed({
  get: () => progression.value?.every ?? 1,
  set: (n: number) => edit((p) => setProgressionField(p, 'every', n === 1 ? undefined : n)),
})

/** The most and the rounding: closed on opening, unless a problem names one of them. */
const limitsOpen = ref(false)
watch(
  () => [props.open, props.problems],
  () => (limitsOpen.value = props.problems.some((p) => p.sub === 'max' || p.sub === 'step')),
  { immediate: true },
)

/** "Up to 90 s. Rounds to 5 s.", "No most. Rounds to 0.5 kg." */
const limitsHint = computed(() => {
  const p = progression.value!
  const say = (n: number) =>
    minutes.value ? durationText(n) : WHOLE.includes(props.field) ? String(n) : `${n} ${unit.value}`
  const most = p.max === undefined ? 'No most.' : `Up to ${say(p.max)}.`
  return `${most} Rounds to ${say(p.step ?? STEP[props.field])}.`
})

// -- values chosen at start --

/** The values chosen at start whose unit fits: a measure's own, `%` for a rate, else a count's. */
function fitting(rate: boolean): string[] {
  const want = rate ? '%' : unit.value
  return Object.entries(props.doc.params ?? {})
    .filter(([, p]) =>
      rate || !WHOLE.includes(props.field)
        ? p.unit === want || (minutes.value && p.unit === 's')
        : !MEASURES.includes(p.unit),
    )
    .map(([key]) => key)
}

/** Where a parameter can go: the value itself (Stays the same), its start, or its amount. */
type Slot = 'value' | 'start' | 'amount'
const slotValue = (slot: Slot): Scalar | undefined => {
  if (slot === 'value') return shown.value as Scalar
  const p = progression.value!
  return slot === 'start' ? p.start : p[by.value]
}
const isParam = (slot: Slot) => typeof slotValue(slot) === 'string'
const options = (slot: Slot) => fitting(slot === 'amount' && by.value === 'rate')

function setSlot(slot: Slot, v: Scalar): void {
  if (slot === 'value') emit('update', v)
  else if (slot === 'start') edit((p) => setProgressionField(p, 'start', v))
  else edit((p) => setProgressionField(p, by.value, v))
}

function useParam(slot: Slot): void {
  setSlot(slot, `$${options(slot)[0]!}`)
}

/** Use a number: the parameter's default, so nothing jumps. */
function useNumber(slot: Slot): void {
  const v = slotValue(slot) as string
  setSlot(slot, props.doc.params?.[v.slice(1)]?.default ?? 0)
}

function pickWords(slot: Slot): { label: string; rest: string } {
  const key = (slotValue(slot) as string).slice(1)
  const label = props.doc.params?.[key]?.label ?? `$${key}`
  return { label, rest: paramText(props.doc, key).slice(label.length + 3) }
}

// -- focus from the foot bar (spec F4) --

const root = ref<HTMLElement | null>(null)
const SUB_FIELD: Record<string, string> = {
  start: 'value-start',
  add: 'value-amount',
  rate: 'value-amount',
  every: 'value-every',
  max: 'value-max',
  step: 'value-step',
}

/** Focuses the field a problem names (opened), or the line itself. The card opens the line. */
async function focus(sub: string | null): Promise<void> {
  if (sub === 'max' || sub === 'step') limitsOpen.value = true
  await nextTick()
  const testid = sub === null ? undefined : SUB_FIELD[sub]
  const target =
    (testid &&
      root.value?.querySelector<HTMLElement>(
        `[data-testid="${testid}"] input, input[data-testid="${testid}"], [data-testid="${testid}"]`,
      )) ||
    root.value!.querySelector<HTMLElement>('button')!
  target.focus()
}
defineExpose({ focus })

const LINK = textLinkVariants()
const FIELD_ERROR = 'mt-1'
/** A problem's line, as InlineMessage's error draws it, inline where a `p` can't go. */
const ERROR_LINE = 'caption flex items-start gap-2 text-(length:--set-caption) text-error-ink'
</script>

<!--
  The ValueField card (brand/design-system/project/components/ValueField): one of an activity's
  numbers as a line that says its shape in words, opening on a press into None, Stays the same or
  Grows (spec F2). Each field reads and writes one path of the draft; a problem shows under the
  field its path names (spec F4).
-->
<template>
  <li
    ref="root"
    class="border-b border-line"
    data-testid="value-line"
    :data-field="field"
    :data-open="open ? '' : undefined"
  >
    <button
      :id="ids.line"
      type="button"
      class="flex min-h-[max(44px,calc(var(--u)*60))] w-full cursor-pointer items-center gap-3 px-1 py-2.5 text-left text-ink hover:bg-tile folded:min-h-[52px] folded:px-0.5 folded:py-2"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="open ? ids.group : undefined"
      :aria-describedby="open ? undefined : wholeIds"
      @click="emit('toggle')"
    >
      <span class="flex min-w-0 flex-auto flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span
          class="flex-[0_0_calc(var(--u)*132)] text-(length:--set-label) leading-[1.3] font-semibold folded:basis-full"
          >{{ label }}</span
        >
        <span
          class="min-w-0 flex-[1_1_180px] text-(length:--set-text) leading-[1.45]"
          :class="shown === undefined && 'text-ink-secondary'"
          data-slot="value-words"
          >{{ shown === undefined ? 'None' : words }}</span
        >
        <span
          v-for="(p, i) in open ? [] : whole"
          :id="`${ids.error}-${i}`"
          :key="p.message"
          :class="ERROR_LINE"
          class="basis-full"
          data-testid="value-error"
          ><CircleAlert
            :size="16"
            :stroke-width="1.5"
            class="mt-0.5 shrink-0"
            aria-hidden="true"
          /><span>{{ p.message }}</span></span
        >
      </span>
      <component
        :is="open ? ChevronDown : ChevronRight"
        :stroke-width="1.5"
        class="size-5.5 shrink-0 text-ink-secondary"
        aria-hidden="true"
      />
    </button>

    <div
      v-if="open"
      :id="ids.group"
      role="group"
      :aria-label="label"
      :aria-describedby="wholeIds"
      class="mb-3.5 flex flex-col gap-4 rounded-md bg-tile p-4 folded:gap-3 folded:p-3"
    >
      <SegmentedControl
        :model-value="choice"
        :ariaLabel="label"
        :options="choices"
        data-testid="value-shape"
        @update:model-value="setChoice"
      />

      <p v-if="choice === 'none'" class="caption text-(length:--set-caption) text-ink-secondary">
        {{ activity || 'This activity' }} has no {{ label.toLowerCase() }}. Pick Stays the same to
        give it one.
      </p>

      <template
        v-for="slot in choice === 'stays' ? ['value'] : choice === 'grows' ? ['start'] : []"
        :key="slot"
      >
        <div v-if="isParam(slot as Slot)" class="flex flex-col gap-1">
          <span :id="`${id}-${slot}-label`" class="label text-(length:--set-label) text-ink">{{
            slot === 'value' ? 'Value' : 'Starts at'
          }}</span>
          <Menu align="start">
            <template #trigger>
              <button
                type="button"
                class="flex h-(--set-control) w-full items-center justify-between gap-2.5 rounded-sm border border-control-border bg-panel px-3 text-left text-(length:--set-text) text-ink hover:border-ink"
                :aria-labelledby="`${id}-${slot}-label ${id}-${slot}-pick`"
                :aria-describedby="`${id}-${slot}-hint`"
                data-testid="value-param-pick"
              >
                <span :id="`${id}-${slot}-pick`"
                  ><b class="font-semibold">{{ pickWords(slot as Slot).label }}</b> ·
                  {{ pickWords(slot as Slot).rest }}</span
                >
                <ChevronDown :stroke-width="1.5" class="size-5.5 text-ink-secondary" />
              </button>
            </template>
            <MenuItem
              v-for="key in options(slot as Slot)"
              :key="key"
              @select="setSlot(slot as Slot, `$${key}`)"
              ><template #icon
                ><Check
                  v-if="slotValue(slot as Slot) === `$${key}`"
                  data-slot="param-chosen" /><span v-else class="w-5.5 shrink-0" /></template
              >{{ paramText(doc, key) }}</MenuItem
            >
            <MenuItem @select="useNumber(slot as Slot)"
              ><template #icon><Hash /></template>Use a number</MenuItem
            >
          </Menu>
          <p
            :id="`${id}-${slot}-hint`"
            class="caption text-(length:--set-caption) text-ink-secondary"
          >
            Chosen when the programme starts. A number works too.
          </p>
          <InlineMessage
            v-if="slot === 'start' && problemFor('start')"
            tone="error"
            :class="FIELD_ERROR"
            >{{ problemFor('start') }}</InlineMessage
          >
        </div>
        <template v-else>
          <div class="flex items-end gap-2.5">
            <TextField
              :label="slot === 'value' ? 'Value' : 'Starts at'"
              :model-value="text(slot, slotValue(slot as Slot))"
              :inputmode="WHOLE.includes(field) ? 'numeric' : 'decimal'"
              :error="bad[slot] ?? (slot === 'start' ? problemFor('start') : undefined)"
              class="w-[calc(var(--u)*140)] min-w-[120px]"
              data-testid="value-start"
              @update:model-value="
                (t) =>
                  onType(
                    slot,
                    t,
                    (n) => setSlot(slot as Slot, n!),
                    numberText(switchShape(doc, field, undefined, 'number') as number),
                  )
              "
            />
            <span
              class="pb-[calc((var(--set-control)-1.45em)/2)] text-(length:--set-text) text-ink-secondary"
              >{{ slot === 'value' && field === 'target' ? 'a week' : unit }}</span
            >
          </div>
          <button
            v-if="options(slot as Slot).length"
            type="button"
            :class="LINK"
            class="self-start text-(length:--set-caption)"
            data-testid="value-use-param"
            @click="useParam(slot as Slot)"
          >
            Use a value chosen at start
          </button>
        </template>
      </template>

      <template v-if="progression">
        <div class="flex flex-wrap items-start gap-x-6 gap-y-5 folded:gap-4">
          <SegmentedControl
            label="Grows by"
            :model-value="by"
            :options="byOptions"
            data-testid="value-by"
            @update:model-value="setBy"
          />
          <div v-if="isParam('amount')" class="flex min-w-0 flex-col gap-1">
            <span :id="`${id}-amount-label`" class="label text-(length:--set-label) text-ink"
              >Amount</span
            >
            <Menu align="start">
              <template #trigger>
                <button
                  type="button"
                  class="flex h-(--set-control) items-center justify-between gap-2.5 rounded-sm border border-control-border bg-panel px-3 text-left text-(length:--set-text) text-ink hover:border-ink"
                  :aria-labelledby="`${id}-amount-label ${id}-amount-pick`"
                  data-testid="value-param-pick"
                >
                  <span :id="`${id}-amount-pick`"
                    ><b class="font-semibold">{{ pickWords('amount').label }}</b> ·
                    {{ pickWords('amount').rest }}</span
                  >
                  <ChevronDown :stroke-width="1.5" class="size-5.5 text-ink-secondary" />
                </button>
              </template>
              <MenuItem
                v-for="key in options('amount')"
                :key="key"
                @select="setSlot('amount', `$${key}`)"
                ><template #icon
                  ><Check v-if="slotValue('amount') === `$${key}`" data-slot="param-chosen" /><span
                    v-else
                    class="w-5.5 shrink-0" /></template
                >{{ paramText(doc, key) }}</MenuItem
              >
              <MenuItem @select="useNumber('amount')"
                ><template #icon><Hash /></template>Use a number</MenuItem
              >
            </Menu>
          </div>
          <div v-else class="flex items-end gap-2.5">
            <TextField
              label="Amount"
              :model-value="text('amount', slotValue('amount'), by === 'add')"
              inputmode="decimal"
              :error="bad.amount ?? problemFor(by)"
              class="w-[calc(var(--u)*140)] min-w-[120px]"
              data-testid="value-amount"
              @update:model-value="
                (t) =>
                  onType(
                    'amount',
                    t,
                    (n) => setSlot('amount', n!),
                    numberText(slotValue('amount') as number, by === 'add'),
                    { scaled: by === 'add' },
                  )
              "
            />
            <span
              class="pb-[calc((var(--set-control)-1.45em)/2)] text-(length:--set-text) text-ink-secondary"
              >{{ by === 'rate' ? '%' : unit }}</span
            >
          </div>
          <Stepper
            v-model="every"
            label="Every"
            lower-label="Fewer weeks between increases"
            raise-label="More weeks between increases"
            :min="1"
            :max="52"
            :suffix="every === 1 ? 'week' : 'weeks'"
            data-testid="value-every"
          />
        </div>
        <button
          v-if="options('amount').length && !isParam('amount')"
          type="button"
          :class="LINK"
          class="self-start text-(length:--set-caption)"
          data-testid="value-use-param"
          @click="useParam('amount')"
        >
          Use a value chosen at start
        </button>
        <InlineMessage v-if="problemFor('every')" tone="error">{{
          problemFor('every')
        }}</InlineMessage>
        <p
          v-if="!limitsOpen"
          class="caption text-(length:--set-caption) text-ink-secondary"
          data-slot="value-limits-hint"
        >
          {{ limitsHint }}
        </p>
        <button
          type="button"
          :class="LINK"
          class="inline-flex items-center gap-1.5 self-start text-(length:--set-text) [&_svg]:size-5.5"
          :aria-expanded="limitsOpen ? 'true' : 'false'"
          :aria-controls="limitsOpen ? ids.limits : undefined"
          data-testid="value-limits"
          @click="limitsOpen = !limitsOpen"
        >
          <component :is="limitsOpen ? ChevronDown : ChevronRight" :stroke-width="1.5" />Change the
          most and the rounding
        </button>
        <div
          v-if="limitsOpen"
          :id="ids.limits"
          class="flex flex-wrap items-start gap-x-6 gap-y-5 folded:gap-4"
        >
          <div class="flex items-end gap-2.5">
            <TextField
              label="Most"
              hint="Left empty, no most."
              :model-value="text('max', progression.max)"
              inputmode="decimal"
              :error="bad.max ?? problemFor('max')"
              class="w-[calc(var(--u)*140)] min-w-[120px]"
              data-testid="value-max"
              @update:model-value="
                (t) =>
                  onType(
                    'max',
                    t,
                    (n) => edit((p) => setProgressionField(p, 'max', n)),
                    numberText(
                      typeof progression?.start === 'number' ? progression.start * 2 : 100,
                    ),
                    { optional: true },
                  )
              "
            />
            <span
              class="pb-[calc((var(--set-control)-1.45em)/2+1.35*var(--set-caption)+4px)] text-(length:--set-text) text-ink-secondary"
              >{{ unit }}</span
            >
          </div>
          <div class="flex items-end gap-2.5">
            <TextField
              label="Round to"
              :model-value="text('step', progression.step)"
              inputmode="decimal"
              :error="bad.step ?? problemFor('step')"
              class="w-[calc(var(--u)*140)] min-w-[120px]"
              data-testid="value-step"
              @update:model-value="
                (t) =>
                  onType(
                    'step',
                    t,
                    (n) => edit((p) => setProgressionField(p, 'step', n)),
                    numberText(STEP[field]),
                    { optional: true },
                  )
              "
            />
            <span
              class="pb-[calc((var(--set-control)-1.45em)/2)] text-(length:--set-text) text-ink-secondary"
              >{{ unit }}</span
            >
          </div>
        </div>
      </template>

      <p
        v-for="(p, i) in whole"
        :id="`${ids.error}-${i}`"
        :key="p.message"
        :class="ERROR_LINE"
        data-testid="value-error"
      >
        <CircleAlert
          :size="16"
          :stroke-width="1.5"
          class="mt-0.5 shrink-0"
          aria-hidden="true"
        /><span>{{ p.message }}</span>
      </p>
    </div>
  </li>
</template>
