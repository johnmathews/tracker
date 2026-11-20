<script lang="ts">
/** How long after the last change the page checks the draft (spec F3). */
export const CHECK_DELAY = 400

/**
 * The open builder's guard on the address (spec F9). App asks it before a hash change moves away:
 * true means the builder kept the page, and asks whether to leave. Null while no builder is open.
 */
export const leaveGuard: { blocks: ((hash: string) => boolean) | null } = { blocks: null }
</script>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  toRaw,
  useId,
  useTemplateRef,
  watch,
} from 'vue'
import { Check, ChevronLeft, CircleAlert, CloudOff, LoaderCircle, Plus } from '@lucide/vue'
import { useConfirm } from '@/composables/useConfirm'
import type { Problem } from '@/lib/api'
import {
  addActivity,
  addParam,
  applyKind,
  kindChangeLines,
  loadDraft,
  moveActivity,
  newProgramme,
  newSession,
  problemPlace,
  removeActivity,
  setDocField,
  toDocument,
  type ProblemPlace,
  type ProgrammeDoc,
} from '@/lib/programmeDraft'
import {
  sentenceCase,
  type ProgrammeKind,
  type ProgrammeRecord,
  type StartPreview,
} from '@/lib/programmes'
import { NEW_PROGRAMME_HREF, PROGRAMMES_HREF, editProgrammeHref } from '@/lib/routes'
import { numberWord } from '@/lib/words'
import { useProgrammesStore } from '@/stores/programmes'
import ActivityCard, { type ActivityProblem } from '@/components/ActivityCard.vue'
import ExceptionWeekEditor from '@/components/ExceptionWeekEditor.vue'
import StartValueEditor from '@/components/StartValueEditor.vue'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { InlineMessage } from '@/components/ui/inline-message'
import { ProgrammeGrid } from '@/components/ui/programme-grid'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Stepper } from '@/components/ui/stepper'
import { TextArea } from '@/components/ui/text-area'
import { TextField } from '@/components/ui/text-field'
import { TextLink } from '@/components/ui/text-link'

const props = defineProps<{
  /** The library programme to change (`#/programmes/<id>/edit`), or null for a new one. */
  programmeId: string | null
}>()

const store = useProgrammesStore()
const { confirm } = useConfirm()
const id = useId()
const ids = {
  title: `${id}-title`,
  programme: `${id}-programme`,
  activities: `${id}-activities`,
  exceptions: `${id}-exceptions`,
  params: `${id}-params`,
  weeks: `${id}-weeks`,
}

// -- the draft (spec F1) --

/** The document itself; the only state beside it is the session's keys and what is open. */
const doc = ref<ProgrammeDoc>(newProgramme())
const session = newSession()
/** The rev the programme was read at, for Save changes. */
let rev = 0
/** The name as loaded, for the head and the questions. */
const loadedName = ref('')
const loaded = ref(props.programmeId === null)
const loadError = ref<string | null>(null)
/** The document as last saved or loaded: a change from it is unsaved. */
const saved = ref(JSON.stringify(doc.value))
const dirty = computed(() => JSON.stringify(doc.value) !== saved.value)
const ownHash =
  props.programmeId === null ? NEW_PROGRAMME_HREF : editProgrammeHref(props.programmeId)

/** Edit, with a run started from this programme (spec F10). */
const hasRun = computed(
  () =>
    props.programmeId !== null &&
    Object.values(store.runs).some((r) => r.programmeId === props.programmeId),
)

function take(record: ProgrammeRecord): void {
  doc.value = loadDraft(record.doc)
  rev = record.rev
  loadedName.value = record.doc.name
  saved.value = JSON.stringify(doc.value)
  loaded.value = true
}

onMounted(async () => {
  window.addEventListener('beforeunload', onBeforeUnload)
  leaveGuard.blocks = blocks
  if (props.programmeId === null) return void check()
  if (store.library === null) void store.loadPage()
  const res = await store.readProgramme(props.programmeId)
  if (!res.ok) {
    loadError.value = `The programme couldn’t open. ${res.message}`
    return
  }
  take(res.data)
  void check()
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  leaveGuard.blocks = null
  clearTimeout(timer)
})

// -- the check (spec F3) --

type CheckState = 'checking' | 'ok' | 'problems' | 'failed'
const state = ref<CheckState>('checking')
const problems = ref<Problem[]>([])
const failure = ref('')
/** The last plan with no problems but limits, kept while the draft can't be expanded (spec S2). */
const plan = ref<{ preview: StartPreview; kind: ProgrammeKind } | null>(null)
/**
 * The problems are in sight. A new programme's wait for the check after the first change, or for a
 * press of Save: an empty form isn't wrong yet. A Library programme's show from the start.
 */
const revealed = ref(props.programmeId !== null)
/** The draft has changed since the page opened. */
let touched = props.programmeId !== null
/** The latest check came back with no plan. */
const kept = ref(false)
/** The document the latest check was sent with; its answer counts only if nothing changed since. */
let sent: string | null = null
let timer: ReturnType<typeof setTimeout> | undefined

async function check(): Promise<void> {
  clearTimeout(timer)
  state.value = 'checking'
  if (store.offline) {
    sent = null
    return
  }
  const text = JSON.stringify(doc.value)
  sent = text
  const res = await store.draft(toDocument(doc.value))
  if (sent !== text || JSON.stringify(doc.value) !== text) return
  if (!res.ok) {
    if ('superseded' in res) return
    if (res.problems.length) return found(res.problems)
    failure.value = `The check didn’t run. ${res.message}`
    state.value = 'failed'
    return
  }
  if (res.data.plan) plan.value = { preview: res.data.plan, kind: doc.value.kind }
  kept.value = res.data.plan === null
  found(res.data.errors)
}

function found(list: Problem[]): void {
  if (touched) revealed.value = true
  problems.value = list
  state.value = list.length ? 'problems' : 'ok'
}

watch(
  () => JSON.stringify(doc.value),
  (now) => {
    // The fields show only once the draft is loaded, so any change is the person's.
    touched = true
    if (now === sent) return
    state.value = 'checking'
    clearTimeout(timer)
    timer = setTimeout(check, CHECK_DELAY)
  },
)
// Back online, the check that waited runs.
watch(
  () => store.offline,
  (offline) => {
    if (!offline && loaded.value && sent === null) void check()
  },
)

// -- problems by path (spec F4) --

type Placed = { text: string; place: ProblemPlace }
const placed = computed<Placed[]>(() =>
  revealed.value
    ? problems.value.map((p) => ({
        text: sentenceCase(p.message),
        place: problemPlace(doc.value, p.path),
      }))
    : [],
)
const at = (card: ProblemPlace['card'], index: number | null = null) =>
  placed.value.filter((p) => p.place.card === card && p.place.index === index)

/** A programme field's problem, under it. */
const fieldError = (field: string) => at('programme').find((p) => p.place.fieldId === field)?.text
/** The programme's fields, each with its problem under it. */
const PROGRAMME_FIELDS = ['name', 'description', 'kind', 'weeks']
/**
 * Programme problems with no field of their own, at the section's top: a loaded document's
 * `dailyTarget`, which the builder has no field for (K190), or its `format`.
 */
const programmeErrors = computed(() =>
  at('programme').filter((p) => !PROGRAMME_FIELDS.includes(p.place.fieldId!)),
)
function activityProblems(index: number): ActivityProblem[] {
  return at('activity', index).map((p) => ({ fieldId: p.place.fieldId, message: p.text }))
}
/** Problems with the activities as a whole, or with one that isn't there. */
const activitiesErrors = computed(() =>
  placed.value.filter(
    (p) =>
      p.place.card === 'activity' &&
      (p.place.index === null || doc.value.activities[p.place.index] === undefined),
  ),
)
/** An exception week's or a value's problems, by the editor's place in its list. */
const editorProblems = (card: 'override' | 'param', index: number) =>
  at(card, index).map((p) => ({ fieldId: p.place.fieldId, message: p.text }))
const paramKeys = computed(() => Object.keys(doc.value.params ?? {}))
/** Problems with the section as a whole, or with an exception week or a value that isn't there. */
const sectionErrors = (card: 'override' | 'param') =>
  placed.value.filter(
    (p) =>
      p.place.card === card &&
      (p.place.index === null ||
        (card === 'override'
          ? doc.value.overrides?.[p.place.index] === undefined
          : paramKeys.value[p.place.index] === undefined)),
  )

const PROGRAMME_FIELD: Record<string, string> = {
  name: 'the programme’s name',
  description: 'the description',
  kind: 'the kind',
  weeks: 'the number of weeks',
  dailyTarget: 'the daily target',
}

/** Where a problem is, in the foot bar's words: "Deadlift", "the programme’s name". */
function where({ card, index, fieldId }: ProblemPlace): string {
  switch (card) {
    case 'activity': {
      const a = index === null ? undefined : doc.value.activities[index]
      if (!a) return 'the activities'
      return a.name || `activity ${index! + 1}`
    }
    case 'override':
      return 'the exception weeks'
    case 'param': {
      // An index means the key is among the document's values chosen at start (problemPlace).
      const key = index === null ? undefined : Object.keys(doc.value.params!)[index]
      return key ? doc.value.params![key]!.label : 'the values chosen at start'
    }
    case 'programme':
      return PROGRAMME_FIELD[fieldId!] ?? 'the programme'
    default:
      return 'the programme'
  }
}

const problemLine = computed(() => {
  const n = placed.value.length
  const first = where(placed.value[0]!.place)
  return n === 1
    ? `One problem, in ${first}. Fix it to save.`
    : `${numberWord(n, true)} problems, the first in ${first}. Fix them to save.`
})

const PROGRAMME_FOCUS: Record<string, string> = {
  name: 'input[data-testid="builder-name"]',
  description: 'textarea[data-testid="builder-description"]',
  kind: '[data-testid="builder-kind"] button[aria-pressed="true"]',
  weeks: '[data-testid="builder-weeks"] input',
}

const page = useTemplateRef<HTMLElement>('page')
const cardRefs = new Map<number, InstanceType<typeof ActivityCard>>()
const exceptionRefs = new Map<number, InstanceType<typeof ExceptionWeekEditor>>()
const paramRefs = new Map<number, InstanceType<typeof StartValueEditor>>()

/** What the first problem's place focuses, other than inside a card; null when it has no field. */
function focusTarget({ card, fieldId }: ProblemPlace): string | null {
  if (card === 'activity') return '[data-testid="activity-add"]'
  if (card === 'override') return `#${ids.exceptions}`
  if (card === 'param') return `#${ids.params}`
  return (card === 'programme' && PROGRAMME_FOCUS[fieldId!]) || null
}
/** The first problem has a field to go to: the foot bar's line is a button. */
const hasPlace = computed(() => focusTarget(placed.value[0]!.place) !== null)

/** The foot bar's problem, pressed: its card opens and its field takes focus (spec F4). */
async function goToProblem(): Promise<void> {
  const place = placed.value[0]!.place
  const { card, index, fieldId } = place
  if (card === 'activity' && index !== null && doc.value.activities[index]) {
    openCard.value = index
    await nextTick()
    return cardRefs.get(index)!.focusField(fieldId)
  }
  if (card === 'override' && index !== null && doc.value.overrides?.[index]) {
    openException.value = index
    await nextTick()
    return exceptionRefs.get(index)!.focusField(fieldId)
  }
  if (card === 'param' && index !== null) {
    openParam.value = index
    await nextTick()
    return paramRefs.get(index)!.focusField(fieldId)
  }
  page.value!.querySelector<HTMLElement>(focusTarget(place)!)!.focus()
}

// -- the programme's fields --

const name = computed({
  get: () => doc.value.name,
  set: (v: string) => (doc.value.name = v),
})
const description = computed({
  get: () => doc.value.description ?? '',
  set: (v: string) => setDocField(doc.value, 'description', v === '' ? undefined : v),
})
const weeks = computed({
  get: () => doc.value.weeks,
  set: (v: number) => (doc.value.weeks = v),
})
const KINDS: { value: ProgrammeKind; label: string }[] = [
  { value: 'strength', label: 'Strength' },
  { value: 'mobility', label: 'Mobility' },
  { value: 'cardio', label: 'Cardio' },
]

/** A kind change that drops fields asks first (spec F6). */
async function setKind(next: string): Promise<void> {
  const kind = next as ProgrammeKind
  const lines = kindChangeLines(doc.value, kind)
  if (lines.length) {
    const label = KINDS.find((k) => k.value === kind)!.label
    const yes = await confirm({
      title: `Change to ${label}?`,
      message: lines.join('\n'),
      confirmLabel: 'Change kind',
    })
    if (!yes) return
  }
  applyKind(doc.value, kind)
}

// -- activities --

/** The open activity card's index. One card is open at a time across the page. */
const openCard = ref<number | null>(null)
/** The open exception week's index in `overrides`. */
const openException = ref<number | null>(null)
/** The open value's index among the `params` keys. */
const openParam = ref<number | null>(null)
const OPENS = [openCard, openException, openParam]
for (const opened of OPENS) {
  watch(opened, (now) => {
    if (now === null) return
    for (const other of OPENS) if (other !== opened) other.value = null
  })
}
const uids = new WeakMap<object, number>()
let nextUid = 0
/** A card's key that stays with its activity, exception week or value through moves and key changes. */
function uid(a: object): number {
  const raw = toRaw(a)
  if (!uids.has(raw)) uids.set(raw, nextUid++)
  return uids.get(raw)!
}
const countLine = computed(() => {
  const n = doc.value.activities.length
  return `${numberWord(n, true)} of at most 30. Press one to change it.`
})

function toggle(index: number): void {
  openCard.value = openCard.value === index ? null : index
}

async function add(): Promise<void> {
  addActivity(doc.value, session)
  const index = doc.value.activities.length - 1
  openCard.value = index
  await nextTick()
  cardRefs.get(index)!.focusField('name')
}

/** After the Menu closes, focus moves on (the Menu returns it to its trigger first). */
function focusLater(find: () => HTMLElement | null | undefined): void {
  setTimeout(() => find()?.focus(), 0)
}
const cardAt = (index: number) =>
  page.value!.querySelectorAll<HTMLElement>('[data-testid="activity-card"]')[index]

function move(index: number, by: -1 | 1): void {
  moveActivity(doc.value, index, by)
  if (openCard.value === index) openCard.value = index + by
  else if (openCard.value === index + by) openCard.value = index
  focusLater(() => cardAt(index + by)!.querySelector<HTMLElement>('[data-testid="activity-menu"]'))
}

function remove(index: number): void {
  removeActivity(doc.value, session, index)
  if (openCard.value === index) openCard.value = null
  else if (openCard.value !== null && openCard.value > index) openCard.value--
  focusLater(
    () =>
      cardAt(index)?.querySelector<HTMLElement>('[data-slot="activity-toggle"]') ??
      page.value!.querySelector<HTMLElement>('[data-testid="activity-add"]'),
  )
}

// -- exception weeks (spec §5.4) --

// A change elsewhere can take exception weeks away (an activity's last entry, a kind change): the
// open one stays open at its new place, or closes when it went.
watch(
  () => (doc.value.overrides ?? []).map((o) => toRaw(o)),
  (now, before) => {
    const was = openException.value === null ? undefined : before[openException.value]
    // An index past the old list is a week just added.
    if (!was) return
    const at = now.indexOf(was)
    openException.value = at < 0 ? null : at
  },
)

function toggleException(index: number): void {
  openException.value = openException.value === index ? null : index
}

/** Adds an exception week with every field empty, open, its Weeks focused. */
async function addException(): Promise<void> {
  const overrides = doc.value.overrides ?? []
  overrides.push({ weeks: [], activities: {} })
  setDocField(doc.value, 'overrides', overrides)
  const index = overrides.length - 1
  openException.value = index
  await nextTick()
  return exceptionRefs.get(index)!.focusField(null)
}

function removeException(index: number): void {
  const overrides = doc.value.overrides!
  overrides.splice(index, 1)
  if (!overrides.length) setDocField(doc.value, 'overrides', undefined)
  // Only the open week has Remove, so it is the one that went.
  openException.value = null
  focusLater(() => page.value!.querySelector<HTMLElement>('[data-testid="exception-add"]'))
}

// -- values chosen at start (spec §5.5) --

function toggleParam(index: number): void {
  openParam.value = openParam.value === index ? null : index
}

/** Adds a value chosen at start, its key following its label, open, its Label focused. */
async function addStartValue(): Promise<void> {
  addParam(doc.value, session)
  const index = paramKeys.value.length - 1
  openParam.value = index
  await nextTick()
  return paramRefs.get(index)!.focusField(null)
}

/** A value went (StartValueEditor removes it): it was the open one. */
function paramRemoved(): void {
  openParam.value = null
  focusLater(() => page.value!.querySelector<HTMLElement>('[data-testid="start-value-add"]'))
}

// -- saving (spec F8) --

const saving = ref(false)
const saveError = ref<string | null>(null)
const canSave = computed(
  () =>
    loaded.value &&
    (state.value === 'ok' || (state.value === 'problems' && !revealed.value)) &&
    !store.offline &&
    !saving.value,
)

async function save(): Promise<void> {
  // An untouched new programme's problems wait for this press: it shows them, and saves nothing.
  if (state.value === 'problems') {
    revealed.value = true
    return
  }
  saving.value = true
  saveError.value = null
  const sentDoc = toDocument(doc.value)
  // A new programme goes through Add's own call, as pasted JSON does; the text is the document.
  const res =
    props.programmeId === null
      ? await store.addProgramme(JSON.stringify(sentDoc))
      : await store.replace(props.programmeId, sentDoc, rev)
  saving.value = false
  if (res.ok) {
    saved.value = JSON.stringify(sentDoc)
    store.landing = res.data.id
    leaving = true
    location.hash = PROGRAMMES_HREF
    return
  }
  if ('conflict' in res) return conflict(res.conflict)
  if (res.problems.length) return found(res.problems)
  saveError.value = res.message
}

/**
 * A 409: the programme changed elsewhere since it was opened. The Dialog offers the two ways on;
 * closing it (Escape, Close, a press outside) keeps the person's draft and the page.
 */
const conflictOpen = ref(false)
let server: ProgrammeRecord | null = null

function conflict(record: ProgrammeRecord): void {
  server = record
  conflictOpen.value = true
}

function saveMine(): Promise<void> {
  conflictOpen.value = false
  rev = server!.rev
  return save()
}

function loadSaved(): void {
  conflictOpen.value = false
  for (const opened of OPENS) opened.value = null
  take(server!)
  void check()
}

// -- leaving (spec F9) --

/** Set once the person chose to leave, or saved: the guards let the page go. */
let leaving = false

function askLeave(): Promise<boolean> {
  const named = doc.value.name.trim()
  return confirm({
    title: 'Leave without saving?',
    message: named
      ? `Your changes to ${named} are not saved anywhere.`
      : 'This programme is not saved anywhere.',
    confirmLabel: 'Leave',
  })
}

async function leave(to: string): Promise<void> {
  if (dirty.value && !(await askLeave())) return
  leaving = true
  location.hash = to
}

function onBack(ev: MouseEvent): void {
  if (ev.ctrlKey || ev.metaKey || ev.shiftKey) return
  ev.preventDefault()
  void leave(PROGRAMMES_HREF)
}

/** App's hash change, away from this page with changes: keep the page and ask. */
function blocks(hash: string): boolean {
  if (leaving || !dirty.value || hash === ownHash) return false
  history.replaceState(history.state, '', ownHash)
  void leave(hash)
  return true
}

function onBeforeUnload(ev: BeforeUnloadEvent): void {
  if (leaving || !dirty.value) return
  ev.preventDefault()
}

const SECTION =
  'flex flex-col gap-[calc(var(--u)*20)] pt-[calc(var(--u)*28)] folded:gap-4 folded:pt-[22px]'
const H2 =
  'font-sans text-(length:--set-h2) leading-tight font-semibold text-ink focus:outline-none'
const LEAD =
  'body -mt-[calc(var(--u)*12)] text-(length:--set-text) leading-[1.45] text-ink-secondary'
const HINT = 'caption text-(length:--set-caption) leading-[1.35] text-ink-secondary'
const ROWS = 'border-t border-line'
const SECTION_BUTTON = 'h-[max(44px,calc(var(--u)*52))] text-(length:--set-label) folded:h-12'
</script>

<!--
  The ProgrammeBuilder card (brand/design-system/project/components/ProgrammeBuilder, spec §5): a
  page that builds a programme, or changes one in the Library, in a form with the weeks beside it.
  The form edits the document itself (F1); about 400 ms after a change the server checks it and
  sends its weeks (F3, S1); each problem shows beside the field its path names (F4). The foot bar
  holds the check's result, Cancel and Save. On a laptop (1024px up) the form and the weeks sit
  side by side in the page's 1184u column, the weeks in view while the form scrolls; below that the
  weeks follow the form as Preview.
-->
<template>
  <div
    ref="page"
    class="flex flex-col pt-[calc(var(--u)*28)] pb-56"
    data-slot="item-page"
    data-testid="programme-builder"
    :aria-labelledby="ids.title"
  >
    <TextLink
      :href="PROGRAMMES_HREF"
      class="inline-flex items-center gap-1.5 self-start text-(length:--set-text) [&_svg]:size-(--set-icon)"
      data-testid="builder-back"
      @click="onBack"
      ><ChevronLeft :stroke-width="1.5" aria-hidden="true" />Back to programmes</TextLink
    >
    <p
      class="label mt-[calc(var(--u)*16)] text-(length:--set-label) leading-snug text-ink-secondary"
    >
      {{ programmeId === null || !loaded ? 'Programmes' : 'Edit programme' }}
    </p>
    <h1
      :id="ids.title"
      class="title-1 mt-[calc(var(--u)*4)] min-w-0 text-(length:--fs-title) leading-tight break-words text-ink"
    >
      {{ programmeId === null ? 'New programme' : loaded ? loadedName : 'Edit programme' }}
    </h1>
    <p
      v-if="hasRun"
      class="body mt-1 text-(length:--set-text) leading-[1.45] text-ink-secondary"
      data-testid="builder-runs"
    >
      Runs already started keep their own copy.
    </p>
    <InlineMessage v-if="loadError" tone="error" class="mt-4">{{ loadError }}</InlineMessage>

    <div
      v-if="loaded"
      class="mt-2 lg:grid lg:grid-cols-[minmax(0,calc(var(--u)*520))_minmax(0,1fr)] lg:items-start lg:gap-x-[calc(var(--u)*48)]"
    >
      <div class="flex min-w-0 flex-col">
        <section :class="SECTION" :aria-labelledby="ids.programme" data-testid="builder-programme">
          <h2 :id="ids.programme" :class="H2">The programme</h2>
          <InlineMessage v-for="p in programmeErrors" :key="p.text" tone="error">{{
            p.text
          }}</InlineMessage>
          <TextField
            v-model="name"
            label="Name"
            :error="fieldError('name')"
            data-testid="builder-name"
          />
          <TextArea
            v-model="description"
            label="Description"
            hint="Markdown. Anyone who copies the programme sees it."
            :error="fieldError('description')"
            rows="3"
            data-testid="builder-description"
          />
          <div class="flex flex-col gap-1">
            <SegmentedControl
              :model-value="doc.kind"
              label="Kind"
              :options="KINDS"
              data-testid="builder-kind"
              @update:model-value="setKind"
            />
            <InlineMessage v-if="fieldError('kind')" tone="error">{{
              fieldError('kind')
            }}</InlineMessage>
          </div>
          <div class="flex flex-col gap-1">
            <Stepper
              v-model="weeks"
              label="Weeks"
              lower-label="Fewer weeks"
              raise-label="More weeks"
              :min="1"
              :max="156"
              data-testid="builder-weeks"
            />
            <InlineMessage v-if="fieldError('weeks')" tone="error">{{
              fieldError('weeks')
            }}</InlineMessage>
          </div>
        </section>

        <section
          :class="SECTION"
          class="mt-3 border-t border-line"
          :aria-labelledby="ids.activities"
          data-testid="builder-activities"
        >
          <h2 :id="ids.activities" :class="H2" tabindex="-1">Activities</h2>
          <p :class="LEAD">{{ countLine }}</p>
          <InlineMessage v-for="p in activitiesErrors" :key="p.text" tone="error">{{
            p.text
          }}</InlineMessage>
          <ul
            v-if="doc.activities.length"
            class="flex flex-col gap-3"
            :aria-labelledby="ids.activities"
          >
            <ActivityCard
              v-for="(a, i) in doc.activities"
              :key="uid(a)"
              :ref="
                (c) =>
                  c ? cardRefs.set(i, c as InstanceType<typeof ActivityCard>) : cardRefs.delete(i)
              "
              :doc="doc"
              :session="session"
              :index="i"
              :open="openCard === i"
              :problems="activityProblems(i)"
              @toggle="toggle(i)"
              @move="(by) => move(i, by)"
              @remove="remove(i)"
            />
          </ul>
          <div>
            <Button data-testid="activity-add" @click="add"
              ><Plus :stroke-width="1.5" />Add activity</Button
            >
          </div>
        </section>

        <section
          :class="SECTION"
          class="mt-3 border-t border-line"
          :aria-labelledby="ids.exceptions"
          data-testid="builder-exceptions"
        >
          <h2 :id="ids.exceptions" :class="H2" tabindex="-1">Exception weeks</h2>
          <p :class="LEAD">
            A week whose values differ, such as a deload or a rest. After a deload the plan carries
            on as planned. After a rest, an activity picks up where it stopped.
          </p>
          <InlineMessage v-for="p in sectionErrors('override')" :key="p.text" tone="error">{{
            p.text
          }}</InlineMessage>
          <ul v-if="doc.overrides?.length" :class="ROWS" :aria-labelledby="ids.exceptions">
            <ExceptionWeekEditor
              v-for="(o, i) in doc.overrides"
              :key="uid(o)"
              :ref="
                (c) =>
                  c
                    ? exceptionRefs.set(i, c as InstanceType<typeof ExceptionWeekEditor>)
                    : exceptionRefs.delete(i)
              "
              :doc="doc"
              :index="i"
              :open="openException === i"
              :problems="editorProblems('override', i)"
              @toggle="toggleException(i)"
              @remove="removeException(i)"
            />
          </ul>
          <div>
            <Button :class="SECTION_BUTTON" data-testid="exception-add" @click="addException"
              ><Plus :stroke-width="1.5" />Add exception week</Button
            >
          </div>
        </section>

        <section
          :class="SECTION"
          class="mt-3 border-t border-line"
          :aria-labelledby="ids.params"
          data-testid="builder-params"
        >
          <h2 :id="ids.params" :class="H2" tabindex="-1">Values chosen at start</h2>
          <p :class="LEAD">
            Each one is asked for when the programme starts, with its default filled in.
          </p>
          <InlineMessage v-for="p in sectionErrors('param')" :key="p.text" tone="error">{{
            p.text
          }}</InlineMessage>
          <ul v-if="paramKeys.length" :class="ROWS" :aria-labelledby="ids.params">
            <StartValueEditor
              v-for="(key, i) in paramKeys"
              :key="uid(doc.params![key]!)"
              :ref="
                (c) =>
                  c
                    ? paramRefs.set(i, c as InstanceType<typeof StartValueEditor>)
                    : paramRefs.delete(i)
              "
              :doc="doc"
              :session="session"
              :param-key="key"
              :open="openParam === i"
              :problems="editorProblems('param', i)"
              @toggle="toggleParam(i)"
              @removed="paramRemoved"
            />
          </ul>
          <div>
            <Button :class="SECTION_BUTTON" data-testid="start-value-add" @click="addStartValue"
              ><Plus :stroke-width="1.5" />Add a value</Button
            >
          </div>
        </section>
      </div>

      <aside
        class="mt-3 flex min-w-0 flex-col gap-1.5 border-t border-line pt-[22px] lg:sticky lg:top-4 lg:mt-0 lg:border-t-0 lg:pt-[calc(var(--u)*28)]"
        :aria-labelledby="ids.weeks"
      >
        <h2 :id="ids.weeks" :class="H2">
          <span class="lg:hidden">Preview</span><span class="hidden lg:inline">The weeks</span>
        </h2>
        <p :class="HINT">
          Weeks by number, at the default values.
          <span class="lg:hidden">Swipe for later weeks.</span
          ><span class="hidden lg:inline">It updates a moment after each change.</span>
        </p>
        <InlineMessage v-if="kept || !plan" tone="info" data-testid="builder-kept"
          >The weeks show the last version with no problems.</InlineMessage
        >
        <ProgrammeGrid
          v-if="plan"
          class="mt-2"
          :grid="plan.preview.grid"
          :kind="plan.kind"
          mode="start"
          undated
          bleed
          label="The weeks, at the default values"
        />
      </aside>
    </div>
  </div>

  <div
    role="region"
    aria-label="Check and save"
    class="fixed inset-x-0 bottom-0 z-30 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-line bg-panel px-(--screen-pad-x) py-3.5 shadow-overlay print:hidden folded:py-3"
    data-slot="item-page"
    data-testid="builder-bar"
  >
    <div role="status" class="min-w-0 flex-[1_1_260px] folded:basis-full">
      <p
        v-if="store.offline"
        class="flex items-start gap-2 text-(length:--set-text) leading-[1.4] text-ink-secondary"
        data-testid="builder-check"
      >
        <CloudOff :stroke-width="1.5" class="mt-0.5 size-5 shrink-0" aria-hidden="true" /><span
          >Offline. Saving needs the server.</span
        >
      </p>
      <p
        v-else-if="!loaded || state === 'checking'"
        class="flex items-start gap-2 text-(length:--set-text) leading-[1.4] text-ink"
        data-testid="builder-check"
      >
        <LoaderCircle :stroke-width="1.5" class="mt-0.5 size-5 shrink-0" aria-hidden="true" /><span
          >Checking…</span
        >
      </p>
      <p
        v-else-if="state === 'ok'"
        class="flex items-start gap-2 text-(length:--set-text) leading-[1.4] text-ink"
        data-testid="builder-check"
      >
        <Check :stroke-width="1.5" class="mt-0.5 size-5 shrink-0" aria-hidden="true" /><span
          >Checked. No problems.</span
        >
      </p>
      <p
        v-else-if="state === 'failed'"
        class="flex items-start gap-2 text-(length:--set-text) leading-[1.4] text-error-ink"
        data-testid="builder-check"
      >
        <CircleAlert
          :stroke-width="1.5"
          class="mt-0.5 size-5 shrink-0"
          aria-hidden="true"
        /><span>{{ failure }}</span>
      </p>
      <p
        v-else-if="!revealed"
        class="flex items-start gap-2 text-(length:--set-text) leading-[1.4] text-ink-secondary"
        data-testid="builder-check"
      >
        <span>Not saved yet.</span>
      </p>
      <p
        v-else-if="!hasPlace"
        class="flex items-start gap-2 text-(length:--set-text) leading-[1.4] text-error-ink"
        data-testid="builder-check"
      >
        <CircleAlert
          :stroke-width="1.5"
          class="mt-0.5 size-5 shrink-0"
          aria-hidden="true"
        /><span>{{ problemLine }}</span>
      </p>
      <button
        v-else
        type="button"
        class="flex cursor-pointer items-start gap-2 text-left text-(length:--set-text) leading-[1.4] text-error-ink [&>span]:underline [&>span]:decoration-1 [&>span]:underline-offset-4 hover:[&>span]:decoration-2"
        data-testid="builder-check"
        @click="goToProblem"
      >
        <CircleAlert
          :stroke-width="1.5"
          class="mt-0.5 size-5 shrink-0"
          aria-hidden="true"
        /><span>{{ problemLine }}</span>
      </button>
      <InlineMessage v-if="saveError" tone="error" class="mt-1">{{ saveError }}</InlineMessage>
    </div>
    <div class="ml-auto flex gap-3 folded:grid folded:basis-full folded:grid-cols-2 folded:gap-2">
      <Button
        class="h-(--set-control) text-(length:--set-label) folded:whitespace-normal"
        data-testid="builder-cancel"
        @click="leave(PROGRAMMES_HREF)"
        >Cancel</Button
      >
      <Button
        variant="primary"
        class="h-(--set-control) text-(length:--set-label) folded:whitespace-normal"
        :disabled="!canSave"
        :busy="saving"
        data-testid="builder-save"
        @click="save"
        >{{ programmeId === null ? 'Save to library' : 'Save changes' }}</Button
      >
    </div>
  </div>

  <Dialog
    v-model:open="conflictOpen"
    :title="`${loadedName} changed since you opened it`"
    description="It was saved somewhere else. Load the saved version to see it, or save yours over it."
  >
    <template #actions>
      <Button data-testid="conflict-load" @click="loadSaved">Load the saved version</Button>
      <Button variant="primary" data-testid="conflict-mine" @click="saveMine"
        >Save mine over it</Button
      >
    </template>
  </Dialog>
</template>
