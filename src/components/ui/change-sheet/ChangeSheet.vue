<script setup lang="ts">
import { computed, nextTick, reactive, ref, useId, useTemplateRef } from 'vue'
import { ChevronDown, ChevronLeft, Pencil, X } from '@lucide/vue'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { Button } from '@/components/ui/button'
import { dialogPanelVariants, scrimVariants } from '@/components/ui/dialog'
import { IconButton } from '@/components/ui/icon-button'
import { InlineMessage } from '@/components/ui/inline-message'
import { Menu, MenuItem } from '@/components/ui/menu'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { TextField } from '@/components/ui/text-field'
import { TextLink } from '@/components/ui/text-link'
import {
  FIELD_WORDS,
  barSentence,
  calmLine,
  changeBody,
  changeWords,
  dayText,
  emptyForm,
  fieldsOf,
  increaseLabel,
  increaseOf,
  logSentence,
  madeOnText,
  optionLabel,
  programmeWeekOn,
  sentenceCase,
  summarySentence,
  valueText,
  weekDates,
  weekOf,
  type Blocking,
  type ChangeOption,
  type ChangePreview,
  type ChangeRequest,
  type ConfirmOutcome,
  type Field,
  type Outcome,
  type Problem,
  type Run,
  type SheetStart,
} from '@/lib/programmes'

const props = defineProps<{
  /** The run it changes: its grid, log, today and length come from the server. */
  run: Run
  /** What it opens on: the title, the changes offered, and the change, field, day and scope. */
  start: SheetStart
  /** Sends the change as a preview (spec §7.3): the server writes nothing. */
  preview: (request: ChangeRequest) => Promise<Outcome<ChangePreview>>
  /** Applies the change with the preview's rev. */
  confirm: (request: ChangeRequest, rev: string) => Promise<ConfirmOutcome>
}>()

const emit = defineEmits<{
  /** The change is made: the run as the server sent it back. */
  done: [run: Run]
  /** Show it in the plan (K148): the sheet goes away, and the plan shows the preview. */
  'show-in-plan': [preview: ChangePreview, sentence: string]
}>()

const open = defineModel<boolean>('open', { required: true })

const ids = { kind: useId(), kindValue: useId(), value: useId(), summary: useId(), list: useId() }

const form = reactive({
  ...emptyForm(props.start.kind, props.start.from),
  activity: props.start.activity,
  field: props.start.field,
  scope: props.start.scope,
  undo: props.start.undo,
})
const step = ref<1 | 2>(1)
/** The server's preview, shown on step 2. */
const shown = ref<ChangePreview | null>(null)
/** The hand-edits this change drops too (spec §7.2): Drop it too, and Keep it. */
const dropped = ref<Blocking[]>([])
/** The plan changed since the preview: the fresh one shows, with a line saying so. */
const stale = ref(false)
const busy = ref<'preview' | 'confirm' | null>(null)
/** The server's problems by field, and the rest, or why a request failed, as lines. */
const errors = reactive<Record<string, string>>({})
const general = ref<string[]>([])
/** The request the shown preview is of: Confirm sends it again, with the preview's rev. */
let previewed: ChangeRequest | null = null

const names = computed(() =>
  Object.fromEntries(props.run.grid.activities.map((a) => [a.key, a.name])),
)
/** Set increase is offered only for an activity whose values progress. */
const increase = computed(() => increaseOf(props.run.doc, props.run.log, form.activity!)!)
const kindLabel = computed(() => optionLabel({ kind: form.kind, field: form.field }))
const isValue = computed(() => form.kind === 'set-value' || form.kind === 'set-increase')
const valueLabel = computed(() =>
  form.kind === 'set-value' ? FIELD_WORDS[form.field!].input : increaseLabel(increase.value),
)
/** The value in force on the from day: "Week 5 is 40 kg now." */
const valueHint = computed(() => {
  if (form.kind === 'set-increase') return 'From the next programme week.'
  const value = weekOf(props.run.grid, form.from)?.cells[form.activity!]?.values?.[form.field!]
  const week = programmeWeekOn(props.run.grid, form.from)
  return value === undefined || week === null
    ? undefined
    : `Week ${week} is ${valueText(form.field!, value)} now.`
})
const fromHint = computed(() => `Today, ${dayText(props.run.today)}, or any later day.`)
const undoes = computed(() => {
  const entry = props.run.log.find((e) => e.seq === form.undo)
  return entry
    ? `Undoes “${logSentence(entry.change, entry.from, names.value, props.run.log)}”`
    : null
})

const SCOPES = [
  { value: 'on', label: 'From then on' },
  { value: 'once', label: 'That week only' },
]
const RESUME_AT = [
  { value: 'paused', label: 'The paused week' },
  { value: 'next', label: 'The week after' },
]
const scope = computed({
  get: () => form.scope,
  set: (value: string) => (form.scope = value as 'on' | 'once'),
})
const at = computed({
  get: () => form.at,
  set: (value: string) => (form.at = value as 'paused' | 'next'),
})

function choose(option: ChangeOption): void {
  form.kind = option.kind
  form.field = option.field
}

/** Where a problem's path belongs: a field's own error line, or the lines over the actions. */
function field(path: string): string | null {
  const own: Record<string, string> = {
    'change.value': 'value',
    'change.add': 'value',
    'change.rate': 'value',
    'change.weeks': 'weeks',
    'change.week': 'week',
    from: 'from',
    reason: 'reason',
  }
  if (own[path]) return own[path]
  const added = /^change\.activity\.(\w+)$/.exec(path)?.[1]
  return added ? `add-${added}` : null
}

function show(problems: Problem[], message: string | null): void {
  for (const key of Object.keys(errors)) delete errors[key]
  general.value = message ? [message] : []
  for (const p of problems) {
    const where = field(p.path)
    if (where && !errors[where]) errors[where] = sentenceCase(p.message)
    else general.value.push(sentenceCase(p.message))
  }
}

function request(): ChangeRequest {
  return changeBody(form, {
    grid: props.run.grid,
    doc: props.run.doc,
    log: props.run.log,
    kind: props.run.kind,
    drop: dropped.value.map((b) => b.change),
  })
}

const root = useTemplateRef<HTMLElement>('root')
/** Focus the first of `selectors` the sheet has. */
async function focus(...selectors: string[]): Promise<void> {
  await nextTick()
  for (const selector of selectors) {
    const el = root.value?.querySelector<HTMLElement>(selector)
    if (el) return el.focus()
  }
}

/** Preview change: the server says what it does; nothing is written (spec P2). */
async function previewChange(): Promise<void> {
  if (busy.value) return
  busy.value = 'preview'
  const sent = request()
  const res = await props.preview(sent)
  busy.value = null
  if (!res.ok) {
    show(res.problems, res.message)
    return
  }
  show([], null)
  previewed = sent
  shown.value = res.data
  stale.value = false
  step.value = 2
  await focus('[data-testid="change-summary"]')
}

/** Drop it too, or Keep it: a fresh preview each time, focus staying on the hand-edit's button. */
async function setDropped(blocking: Blocking, drop: boolean): Promise<void> {
  const before = dropped.value
  dropped.value = drop ? [...before, blocking] : before.filter((b) => b.change !== blocking.change)
  const sent = request()
  const res = await props.preview(sent)
  if (!res.ok) {
    dropped.value = before
    show(res.problems, res.message)
    return
  }
  show([], null)
  previewed = sent
  shown.value = res.data
  await focus(
    `[data-testid="${drop ? 'change-keep-hand-edit' : 'change-drop-hand-edit'}"][data-change="${blocking.change}"]`,
  )
}

/** Confirm change, from step 2 or from the plan's preview bar. */
async function confirmChange(): Promise<void> {
  if (busy.value || !shown.value || !previewed) return
  busy.value = 'confirm'
  const res = await props.confirm(previewed, shown.value.rev)
  busy.value = null
  if (res.ok) {
    emit('done', res.data)
    open.value = false
    return
  }
  step.value = 2
  open.value = true
  if ('stale' in res) {
    show([], null)
    shown.value = res.stale
    stale.value = true
    return
  }
  show(res.problems, res.message)
}

async function back(): Promise<void> {
  step.value = 1
  await focus('[data-testid="change-value"]', '[data-testid="change-kind"]')
}

function showInPlan(): void {
  const preview = shown.value!
  const sentence = barSentence(
    preview.change.change,
    preview.change.from,
    names.value,
    props.run.log,
  )
  emit('show-in-plan', preview, sentence)
  open.value = false
}

defineExpose({ confirmChange })

/** Step 2's lines: the weeks that change, each with its dates, before → after. */
const weeks = computed(() => {
  const preview = shown.value!
  const several = new Set(preview.cells.map((c) => c.key)).size > 1
  return preview.cells.map((cell, i) => {
    const label = preview.grid.weeks.find((w) => w.monday === cell.monday)?.label
    const name = several ? `, ${names.value[cell.key] ?? cell.key}` : ''
    return {
      id: `${i}`,
      week: cell.programmeWeek,
      name: `${cell.programmeWeek === null ? 'Not started' : `Week ${cell.programmeWeek}`}${name}`,
      dates: `${weekDates(cell.monday)}${label ? `, ${label.toLowerCase()}` : ''}`,
      ...changeWords(cell),
    }
  })
})
const blocking = computed(() =>
  shown.value!.blocking.filter((b) => !dropped.value.some((d) => d.change === b.change)),
)
function droppedLine(b: Blocking): string {
  return `The ${valueText(b.field, b.value)} set by hand on ${madeOnText(b.madeOn)} goes too.`
}
const summary = computed(() => {
  const change = shown.value!.change
  return summarySentence(change.change, change.from, names.value, props.run.log)
})

/** On open, focus goes to the first field, as the Dialog card has it. */
function onOpenAutoFocus(event: Event): void {
  event.preventDefault()
  void focus('[data-testid="change-kind"]', '[data-testid="change-summary"]')
}

const ADD_FIELDS = computed<Field[]>(() => fieldsOf(props.run.kind))
const LABEL = 'label text-(length:--set-label) leading-[1.3] text-ink'
const HINT = 'caption text-(length:--set-caption) leading-[1.35] text-ink-secondary'
const TWO =
  'grid grid-cols-[repeat(auto-fill,minmax(min(100%,calc(var(--u)*260)),1fr))] items-start gap-x-6 gap-y-5'
</script>

<!--
  The ChangeSheet card (brand/design-system/project/components/ChangeSheet, K144, K148): a change
  to a running programme in two steps on the Dialog card's panel. Step 1 is the change: what to
  change, its value, from which day, for how long and why, then Preview change. Step 2 is what the
  server says it does: the change in a sentence, each week it changes before → after, a hand-edit
  it would meet with Drop it too, what stays, and Show it in the plan; then Back and Confirm
  change. Nothing is written until Confirm change (spec P2), which sends the preview's rev; a
  stale rev brings the fresh preview with a line saying so. Closing at either step changes
  nothing. It is the Dialog card's panel, scrim and focus rules, with the step line above the
  title, which the Dialog component has no place for.
-->
<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay data-slot="dialog-scrim" :class="scrimVariants()" />
      <DialogContent
        data-slot="dialog"
        aria-modal="true"
        :class="dialogPanelVariants({ size: 'md' })"
        data-testid="change-sheet"
        :data-step="step"
        @open-auto-focus="onOpenAutoFocus"
      >
        <div ref="root" class="flex flex-col gap-[max(16px,calc(var(--u)*20))]">
          <div>
            <DialogDescription
              as="p"
              class="label text-(length:--set-caption) leading-[1.35] text-ink-secondary"
              data-testid="change-step"
              >Step {{ step }} of 2</DialogDescription
            >
            <div class="flex items-start justify-between gap-2">
              <DialogTitle
                as="h2"
                class="title-2 pt-2 text-(length:--set-h2) leading-tight text-ink"
                >{{ start.title }}</DialogTitle
              >
              <DialogClose as-child>
                <IconButton
                  label="Close"
                  class="-mr-2 size-(--edit-ib) [&_svg]:size-(--edit-ib-icon)"
                  data-testid="change-close"
                  ><X
                /></IconButton>
              </DialogClose>
            </div>
          </div>

          <template v-if="step === 1">
            <div class="flex flex-col gap-1">
              <span :id="ids.kind" :class="LABEL">Change</span>
              <Menu align="start">
                <template #trigger>
                  <button
                    type="button"
                    class="flex h-(--set-control) w-full items-center justify-between gap-2.5 rounded-sm border border-control-border bg-panel px-[calc(var(--set-control)*0.25)] text-left text-(length:--set-text) text-ink hover:border-ink"
                    :aria-labelledby="`${ids.kind} ${ids.kindValue}`"
                    data-testid="change-kind"
                  >
                    <span :id="ids.kindValue">{{ kindLabel }}</span>
                    <ChevronDown :size="22" :stroke-width="1.5" class="text-ink-secondary" />
                  </button>
                </template>
                <MenuItem
                  v-for="option in start.options"
                  :key="`${option.kind}-${option.field}`"
                  @select="choose(option)"
                  >{{ optionLabel(option) }}</MenuItem
                >
              </Menu>
            </div>

            <p
              v-if="form.kind === 'undo' && undoes"
              class="body text-(length:--set-text)"
              data-testid="change-undoes"
            >
              {{ undoes }}
            </p>

            <div v-if="form.kind === 'add-activity'" class="flex flex-col gap-5">
              <TextField
                v-model="form.add.name"
                label="Name"
                hint="It starts at its own week 1."
                :error="errors['add-name']"
                autocomplete="off"
                data-testid="change-add-name"
              />
              <div :class="TWO">
                <TextField
                  v-for="f in ADD_FIELDS"
                  :key="f"
                  v-model="form.add[f]"
                  :label="FIELD_WORDS[f].input"
                  :error="errors[`add-${f}`]"
                  inputmode="decimal"
                  autocomplete="off"
                  :data-testid="`change-add-${f}`"
                />
              </div>
            </div>

            <div :class="TWO">
              <TextField
                v-if="isValue"
                :id="ids.value"
                v-model="form.value"
                :label="valueLabel"
                :hint="valueHint"
                :error="errors.value"
                inputmode="decimal"
                autocomplete="off"
                data-testid="change-value"
              />
              <TextField
                v-if="form.kind === 'pause-activity' || form.kind === 'pause-programme'"
                v-model="form.weeks"
                label="Weeks"
                hint="Leave it empty to pause until you resume it."
                :error="errors.weeks"
                inputmode="numeric"
                autocomplete="off"
                data-testid="change-weeks"
              />
              <TextField
                v-if="form.kind === 'go-to-week'"
                v-model="form.week"
                label="Week"
                :hint="`From week 1 to week ${run.weeks}.`"
                :error="errors.week"
                inputmode="numeric"
                autocomplete="off"
                data-testid="change-week"
              />
              <TextField
                v-if="form.kind !== 'undo'"
                v-model="form.from"
                type="date"
                label="From"
                :min="run.today"
                :hint="fromHint"
                :error="errors.from"
                data-testid="change-from"
              />
            </div>

            <SegmentedControl
              v-if="form.kind === 'set-value'"
              v-model="scope"
              label="For"
              :options="SCOPES"
              data-testid="change-scope"
            />
            <SegmentedControl
              v-if="form.kind === 'resume-programme'"
              v-model="at"
              label="Resume at"
              :options="RESUME_AT"
              data-testid="change-at"
            />

            <TextField
              v-model="form.reason"
              label="Reason"
              hint="It shows in Changes."
              :error="errors.reason"
              autocomplete="off"
              data-testid="change-reason"
            />
          </template>

          <template v-else-if="shown">
            <p
              tabindex="-1"
              class="rounded-sm bg-tile px-3.5 py-3 text-(length:--set-text) leading-[1.45] text-ink focus:outline-none focus-visible:outline-2"
              data-testid="change-summary"
            >
              {{ summary
              }}<i v-if="shown.change.reason" class="note">{{ ` ${shown.change.reason}` }}</i>
            </p>
            <section
              :aria-labelledby="ids.list"
              class="flex flex-col gap-2 border-t border-line pt-5"
            >
              <h3 :id="ids.list" :class="LABEL">What changes</h3>
              <ol class="flex flex-col" data-testid="change-preview">
                <li
                  v-for="w in weeks"
                  :key="w.id"
                  class="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 border-b border-line py-2.5 text-(length:--set-text) leading-[1.4] first:border-t"
                  data-testid="change-preview-week"
                  :data-week="w.week ?? undefined"
                >
                  <span class="font-semibold"
                    >{{ w.name
                    }}<span :class="HINT" class="block font-normal">{{ w.dates }}</span></span
                  >
                  <span class="font-semibold whitespace-nowrap"
                    ><span class="font-normal text-ink-secondary">{{ w.was }}</span
                    >{{ w.now }}</span
                  >
                </li>
              </ol>
              <p v-if="weeks.length === 0" :class="HINT">No week changes.</p>
              <div
                v-for="b in blocking"
                :key="`keep-${b.change}`"
                class="flex flex-col items-start gap-2 pt-3"
                data-testid="change-hand-edit"
              >
                <p class="flex items-start gap-2 text-(length:--set-text) leading-[1.45]">
                  <Pencil :size="18" :stroke-width="1.5" class="mt-1 shrink-0 text-ink-secondary" />
                  <span>{{ b.message }}</span>
                </p>
                <Button
                  size="sm"
                  :data-change="b.change"
                  data-testid="change-drop-hand-edit"
                  @click="setDropped(b, true)"
                  >Drop it too</Button
                >
              </div>
              <div
                v-for="b in dropped"
                :key="`drop-${b.change}`"
                class="flex flex-col items-start gap-2 pt-3"
                data-testid="change-hand-edit"
              >
                <p class="flex items-start gap-2 text-(length:--set-text) leading-[1.45]">
                  <Pencil :size="18" :stroke-width="1.5" class="mt-1 shrink-0 text-ink-secondary" />
                  <span>{{ droppedLine(b) }}</span>
                </p>
                <Button
                  size="sm"
                  :data-change="b.change"
                  data-testid="change-keep-hand-edit"
                  @click="setDropped(b, false)"
                  >Keep it</Button
                >
              </div>
              <InlineMessage
                v-for="e in shown.endsShort"
                :key="e.key"
                tone="info"
                data-testid="change-ends-short"
                >{{ e.message }}</InlineMessage
              >
              <p :class="HINT" data-testid="change-unchanged">
                {{ calmLine(shown.change.change, shown.change.from, run.weeks) }}
              </p>
            </section>
            <p class="text-(length:--set-text)">
              <TextLink href="#" data-testid="change-show-in-plan" @click.prevent="showInPlan"
                >Show it in the plan</TextLink
              >
            </p>
            <InlineMessage v-if="stale" tone="info" data-testid="change-stale"
              >The plan changed since this preview. Check it, then confirm.</InlineMessage
            >
          </template>

          <div v-if="general.length" class="flex flex-col gap-1" data-testid="change-error">
            <InlineMessage v-for="line in general" :key="line" tone="error">{{
              line
            }}</InlineMessage>
          </div>

          <div class="flex flex-wrap justify-end gap-3 pt-1 folded:[&>*]:flex-1">
            <template v-if="step === 1">
              <Button data-testid="change-cancel" @click="open = false">Cancel</Button>
              <Button
                variant="primary"
                :busy="busy === 'preview'"
                data-testid="change-preview-button"
                @click="previewChange"
                >Preview change</Button
              >
            </template>
            <template v-else>
              <Button data-testid="change-back" @click="back"
                ><ChevronLeft :stroke-width="1.5" />Back</Button
              >
              <Button
                variant="primary"
                :busy="busy === 'confirm'"
                data-testid="change-confirm"
                @click="confirmChange"
                >Confirm change</Button
              >
            </template>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
