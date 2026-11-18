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
import { ChevronLeft, ChevronRight, Copy, Play, Trash2, Upload } from '@lucide/vue'
import { useConfirm } from '@/composables/useConfirm'
import { backToWeek, programmeHref } from '@/lib/routes'
import {
  START_PREVIEW_DELAY,
  dayText,
  numberOf,
  problemsLine,
  runLine,
  sentenceCase,
  startLine,
  type Problem,
  type ProgrammeRecord,
  type ProgrammeSummary,
  type StartPreview,
} from '@/lib/programmes'
import { useProgrammesStore } from '@/stores/programmes'
import { Button } from '@/components/ui/button'
import { InlineMessage } from '@/components/ui/inline-message'
import { ProgrammeGrid } from '@/components/ui/programme-grid'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TextField } from '@/components/ui/text-field'
import { TextLink } from '@/components/ui/text-link'

const TABS = [
  ['running', 'Started'],
  ['library', 'Library'],
  ['add', 'Add'],
] as const
type Tab = (typeof TABS)[number][0]

const KIND_NAMES = { strength: 'Strength', mobility: 'Mobility', cardio: 'Cardio' } as const
const OFFLINE =
  'Can’t reach the server, so programmes can’t be added or started now. Try again when you’re online.'

const store = useProgrammesStore()
const { confirm } = useConfirm()
const root = useTemplateRef<HTMLElement>('root')
const heading = useTemplateRef<HTMLHeadingElement>('heading')
const ids = { heading: useId(), json: useId(), jsonHint: useId(), errors: useId() }

const tab = ref<Tab>('running')
const openTab = computed({
  get: () => tab.value,
  set: (value: string) => (tab.value = value as Tab),
})

// Arriving here moves focus to the page's heading, so a screen reader starts at the top.
onMounted(() => {
  heading.value!.focus()
  void store.loadPage()
})

/** The runs still going: running, paused or yet to start. */
const live = computed(() =>
  Object.entries(store.runs)
    .filter(([, run]) => run.status !== 'ended')
    .map(([tracker, run]) => ({ tracker, run, line: runLine(run) })),
)

function facts(p: ProgrammeSummary): string {
  const weeks = p.weeks === 1 ? '1 week' : `${p.weeks} weeks`
  const activities = p.activities === 1 ? '1 activity' : `${p.activities} activities`
  return `${KIND_NAMES[p.kind]} · ${weeks} · ${activities}`
}

/** A line over the library: an action that failed, or a programme just added. */
const libraryNote = ref<{ tone: 'error' | 'success'; text: string } | null>(null)

// -- Preview and start, opened in place (K147) --

const opened = ref<ProgrammeRecord | null>(null)
const startForm = reactive({ name: '', start: '', params: {} as Record<string, string> })
const startErrors = reactive<Record<string, string>>({})
const startGeneral = ref<string[]>([])
const startPreview = ref<StartPreview | null>(null)
const starting = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
/** Each preview asked for; an answer to an older one is dropped. */
let asked = 0

const params = computed(() => Object.entries(opened.value?.doc.params ?? {}))

function showStartProblems(problems: Problem[], message: string | null): void {
  for (const key of Object.keys(startErrors)) delete startErrors[key]
  startGeneral.value = message ? [message] : []
  for (const p of problems) {
    const at = p.path === 'name' || p.path === 'start' ? p.path : /^params\.(.+)$/.exec(p.path)?.[1]
    if (at && !startErrors[at]) startErrors[at] = sentenceCase(p.message)
    else startGeneral.value.push(sentenceCase(p.message))
  }
}

function startBody() {
  return {
    start: startForm.start,
    params: Object.fromEntries(Object.entries(startForm.params).map(([k, v]) => [k, numberOf(v)])),
  }
}

/** The plan as the start would write it, from the server (P4), a moment after the fields change. */
function schedulePreview(): void {
  clearTimeout(timer)
  timer = setTimeout(() => void previewNow(), START_PREVIEW_DELAY)
}
async function previewNow(): Promise<void> {
  const programme = opened.value!
  const mine = ++asked
  const res = await store.previewStart(programme.id, startBody())
  if (mine !== asked) return
  if (res.ok) {
    startPreview.value = res.data
    showStartProblems([], null)
  } else {
    startPreview.value = null
    showStartProblems(res.problems, res.message)
  }
}
watch(startForm, schedulePreview)
onBeforeUnmount(() => clearTimeout(timer))

async function openStart(p: ProgrammeSummary): Promise<void> {
  libraryNote.value = null
  const read = await store.readProgramme(p.id)
  if (!read.ok) {
    libraryNote.value = { tone: 'error', text: read.message! }
    return
  }
  opened.value = read.data
  startForm.name = read.data.doc.name
  startForm.start = store.today ?? ''
  startForm.params = Object.fromEntries(
    Object.entries(read.data.doc.params ?? {}).map(([k, param]) => [k, String(param.default)]),
  )
  startPreview.value = null
  showStartProblems([], null)
  schedulePreview()
  await nextTick()
  root.value!.querySelector<HTMLElement>('[data-testid="start-name"]')!.focus()
}

async function closeStart(): Promise<void> {
  const id = opened.value!.id
  clearTimeout(timer)
  asked++
  opened.value = null
  await nextTick()
  root
    .value!.querySelector<HTMLElement>(
      `[data-programme="${CSS.escape(id)}"] [data-testid="library-start"]`,
    )!
    .focus()
}

/** Start programme: the run starts, and its overview opens. */
async function startProgramme(): Promise<void> {
  if (starting.value) return
  starting.value = true
  const res = await store.start(opened.value!.id, { name: startForm.name, ...startBody() })
  starting.value = false
  if (!res.ok) {
    showStartProblems(res.problems, res.message)
    return
  }
  clearTimeout(timer)
  location.hash = programmeHref(res.data.tracker.id)
}

async function duplicate(p: ProgrammeSummary): Promise<void> {
  libraryNote.value = null
  const res = await store.duplicate(p.id)
  if (!res.ok) libraryNote.value = { tone: 'error', text: res.message! }
}

async function remove(p: ProgrammeSummary): Promise<void> {
  libraryNote.value = null
  const yes = await confirm({
    title: `Delete ${p.name}?`,
    message: 'It leaves the library. Runs started from it keep their own copy.',
    confirmLabel: 'Delete',
  })
  if (!yes) return
  const res = await store.remove(p.id)
  if (!res.ok) libraryNote.value = { tone: 'error', text: res.message! }
}

// -- Add --

const json = ref('')
const addProblems = ref<Problem[]>([])
const addMessage = ref<string | null>(null)
const checking = ref(false)
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const hasProblems = computed(() => addProblems.value.length > 0 || addMessage.value !== null)

/** Check and add (spec §3.4): every problem at once, with its path; the text stays as it was. */
async function check(): Promise<void> {
  if (checking.value) return
  checking.value = true
  const res = await store.addProgramme(json.value)
  checking.value = false
  if (!res.ok) {
    addProblems.value = res.problems
    addMessage.value = res.message
    return
  }
  addProblems.value = []
  addMessage.value = null
  json.value = ''
  tab.value = 'library'
  libraryNote.value = { tone: 'success', text: `${res.data.name} is in the library.` }
}

async function onFile(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) json.value = await file.text()
}

const LABEL = 'label text-(length:--set-label) leading-[1.3] text-ink'
const HINT = 'caption text-(length:--set-caption) leading-[1.35] text-ink-secondary'
const META = 'body text-(length:--set-text) leading-[1.45] text-ink-secondary'
const NAME =
  'text-[max(18px,calc(var(--u)*22))] leading-[1.3] font-semibold folded:text-[calc(var(--n)*18)]'
const TWO =
  'grid max-w-[820px] grid-cols-[repeat(auto-fill,minmax(min(100%,calc(var(--u)*260)),1fr))] items-start gap-x-6 gap-y-5'
</script>

<!--
  The Programmes page (brand/design-system/project/components/ProgrammesPage, K147, spec §9.1), at
  #/programmes, with no bar: Back to the week, the heading, then three tabs. Started (K161: "Running" is also an activity's name) lists each
  live run as a link to its overview. Library lists the account's programmes; Preview and start
  opens one in place, framed in ink, with its name, start day and parameters and the server's plan
  as a live preview. Add takes pasted JSON (or a file) to the validator, listing every problem with
  its path. Offline, what needs the server is disabled, with one line saying why; the lists still
  show what was last loaded.
-->
<template>
  <div
    ref="root"
    class="flex flex-col pt-[calc(var(--u)*28)] pb-[calc(var(--u)*64)]"
    data-slot="settings-page"
    data-testid="programmes-page"
    data-noprint
  >
    <TextLink
      href="#/"
      class="inline-flex items-center gap-1.5 self-start text-(length:--set-text) [&_svg]:size-(--set-icon)"
      data-testid="back-to-week"
      @click="backToWeek"
      ><ChevronLeft :stroke-width="1.5" aria-hidden="true" />Back to the week</TextLink
    >
    <h1
      :id="ids.heading"
      ref="heading"
      tabindex="-1"
      class="title-1 mt-[calc(var(--u)*12)] text-(length:--fs-title) leading-tight text-ink focus:outline-none"
    >
      Programmes
    </h1>

    <InlineMessage v-if="store.loadFailure" tone="error" class="mt-4">{{
      store.loadFailure
    }}</InlineMessage>

    <Tabs v-model="openTab" class="mt-[calc(var(--u)*24)]">
      <TabsList :aria-labelledby="ids.heading" class="gap-x-[calc(var(--u)*32)]">
        <TabsTrigger
          v-for="[key, label] in TABS"
          :key="key"
          :value="key"
          class="text-(length:--set-text) leading-[1.35]"
          :data-testid="`programmes-tab-${key}`"
          >{{ label }}</TabsTrigger
        >
      </TabsList>
      <InlineMessage
        v-if="store.offline"
        tone="info"
        class="mt-4"
        data-testid="programmes-offline"
        >{{ OFFLINE }}</InlineMessage
      >

      <TabsContent value="running" class="pt-2">
        <ul
          v-if="live.length"
          aria-label="Started"
          class="max-w-[820px]"
          data-testid="programmes-running"
        >
          <li
            v-for="r in live"
            :key="r.tracker"
            class="border-b border-line"
            data-testid="programme-run"
            :data-state="r.run.status"
          >
            <a
              :href="programmeHref(r.tracker)"
              class="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-3.5 text-ink no-underline"
            >
              <span
                :class="NAME"
                class="col-start-1 group-hover:underline group-hover:decoration-2 group-hover:underline-offset-3"
                >{{ r.run.name }}</span
              >
              <span :class="META" class="col-start-1"
                ><b class="font-semibold text-ink">{{ r.line.lead }}</b> {{ r.line.rest }}</span
              >
              <ChevronRight
                :size="22"
                :stroke-width="1.5"
                class="col-start-2 row-span-2 row-start-1 text-ink-secondary"
                aria-hidden="true"
              />
            </a>
          </li>
        </ul>
        <p v-else-if="store.library" :class="META" class="py-3.5" data-testid="programmes-running">
          No programme is running. Start one from the Library.
        </p>
      </TabsContent>

      <TabsContent value="library" class="pt-2">
        <div data-testid="programmes-library">
          <InlineMessage v-if="libraryNote" :tone="libraryNote.tone" class="mt-2">{{
            libraryNote.text
          }}</InlineMessage>
          <p v-if="store.library?.length === 0" :class="META" class="py-3.5">
            The library is empty. Add a programme on the Add tab.
          </p>
          <ul v-else aria-label="Library" class="max-w-[820px]">
            <li
              v-for="p in store.library ?? []"
              :key="p.id"
              class="flex flex-col gap-3 border-b border-line py-4"
              :class="opened?.id === p.id && 'gap-5'"
              data-testid="library-programme"
              :data-programme="p.id"
            >
              <div>
                <h2 :id="`${ids.heading}-${p.id}`" :class="NAME">{{ p.name }}</h2>
                <p :class="META">{{ facts(p) }}</p>
                <p
                  v-if="p.description"
                  class="body mt-1 max-w-[60ch] text-(length:--set-text) leading-[1.45] text-ink"
                >
                  {{ p.description }}
                </p>
              </div>
              <div
                v-if="opened?.id !== p.id"
                class="flex flex-wrap gap-2 folded:grid folded:grid-cols-2 folded:[&>*:first-child]:col-span-2"
              >
                <Button
                  aria-expanded="false"
                  :disabled="store.offline"
                  data-testid="library-start"
                  @click="openStart(p)"
                  ><Play :stroke-width="1.5" />Preview and start</Button
                >
                <Button
                  variant="quiet"
                  :disabled="store.offline"
                  data-testid="library-duplicate"
                  @click="duplicate(p)"
                  ><Copy :stroke-width="1.5" />Duplicate</Button
                >
                <Button
                  variant="quiet"
                  :disabled="store.offline"
                  data-testid="library-delete"
                  @click="remove(p)"
                  ><Trash2 :stroke-width="1.5" />Delete</Button
                >
              </div>
              <div
                v-else
                role="group"
                :aria-labelledby="`${ids.heading}-${p.id}`"
                class="-mx-4 flex min-w-0 flex-col gap-5 rounded-lg border-2 border-ink p-4 folded:-mx-2 folded:px-2 folded:py-3"
                data-testid="programme-start"
              >
                <div :class="TWO">
                  <TextField
                    v-model="startForm.name"
                    label="Name"
                    hint="Its tracker’s name. You can change it later."
                    :error="startErrors.name"
                    autocomplete="off"
                    data-testid="start-name"
                  />
                  <TextField
                    v-model="startForm.start"
                    type="date"
                    label="Start"
                    :min="store.today ?? undefined"
                    :hint="
                      store.today
                        ? `Today, ${dayText(store.today)}, or any later day. Week 1 starts on its Monday.`
                        : 'Week 1 starts on its Monday.'
                    "
                    :error="startErrors.start"
                    data-testid="start-date"
                  />
                  <TextField
                    v-for="[key, param] in params"
                    :key="key"
                    v-model="startForm.params[key]"
                    :label="`${param.label} in ${param.unit}`"
                    :hint="`The programme’s own: ${param.default}.`"
                    :error="startErrors[key]"
                    inputmode="decimal"
                    autocomplete="off"
                    data-testid="start-param"
                    :data-param="key"
                  />
                </div>
                <div class="flex min-w-0 flex-col gap-1" data-testid="start-preview">
                  <h3 :class="LABEL">Preview</h3>
                  <template v-if="startPreview">
                    <p :class="META">{{ startLine(startPreview) }}</p>
                    <ProgrammeGrid
                      class="mt-2"
                      :grid="startPreview.grid"
                      :kind="opened.kind"
                      mode="start"
                      label="Preview"
                    />
                  </template>
                </div>
                <div v-if="startGeneral.length" class="flex flex-col gap-1">
                  <InlineMessage v-for="line in startGeneral" :key="line" tone="error">{{
                    line
                  }}</InlineMessage>
                </div>
                <div class="flex flex-wrap justify-end gap-3 folded:[&>*]:flex-1">
                  <Button data-testid="start-cancel" @click="closeStart">Cancel</Button>
                  <Button
                    variant="primary"
                    :busy="starting"
                    :disabled="store.offline"
                    data-testid="start-confirm"
                    @click="startProgramme"
                    >Start programme</Button
                  >
                </div>
              </div>
            </li>
          </ul>
        </div>
      </TabsContent>

      <TabsContent value="add">
        <div class="flex max-w-[820px] flex-col gap-5 pt-4" data-testid="programme-add">
          <div class="flex flex-col gap-1">
            <label :for="ids.json" :class="LABEL">Programme JSON</label>
            <textarea
              :id="ids.json"
              v-model="json"
              rows="7"
              spellcheck="false"
              class="block w-full min-w-0 resize-y overflow-x-auto rounded-sm border border-control-border bg-panel px-3.5 py-2.5 font-sans text-[max(16px,calc(var(--u)*17))] leading-[1.45] whitespace-pre text-ink hover:not-aria-invalid:border-ink aria-invalid:border-error-ink"
              :aria-invalid="hasProblems ? 'true' : undefined"
              :aria-describedby="hasProblems ? `${ids.jsonHint} ${ids.errors}` : ids.jsonHint"
              data-testid="add-json"
            />
            <p :id="ids.jsonHint" :class="HINT">
              Paste a programme in the tracker-programme/1 format, or choose a file. Claude can add
              one for you through your connection.
            </p>
          </div>
          <div
            v-if="hasProblems"
            :id="ids.errors"
            class="flex flex-col gap-2"
            data-testid="add-errors"
          >
            <InlineMessage tone="error">{{
              addMessage ?? problemsLine(addProblems.length)
            }}</InlineMessage>
            <ul
              v-if="addProblems.length"
              class="flex flex-col gap-1.5 pl-6 text-(length:--set-caption) leading-[1.35] text-ink"
            >
              <li
                v-for="p in addProblems"
                :key="`${p.path}: ${p.message}`"
                data-testid="add-error"
                :data-path="p.path"
              >
                <span class="font-semibold wrap-anywhere">{{ p.path }}:</span> {{ p.message }}
              </li>
            </ul>
          </div>
          <div class="flex flex-wrap gap-3">
            <Button data-testid="add-choose-file" @click="fileInput?.click()"
              ><Upload :stroke-width="1.5" />Choose file</Button
            >
            <input
              ref="fileInput"
              type="file"
              accept=".json,application/json"
              class="hidden"
              aria-label="Programme file"
              data-testid="add-file"
              @change="onFile"
            />
            <Button
              variant="primary"
              :busy="checking"
              :disabled="store.offline"
              data-testid="add-check"
              @click="check"
              >Check and add</Button
            >
          </div>
        </div>
      </TabsContent>
    </Tabs>
  </div>
</template>
