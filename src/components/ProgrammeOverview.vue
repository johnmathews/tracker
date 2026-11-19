<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, useTemplateRef } from 'vue'
import {
  ChevronLeft,
  CircleStop,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SkipForward,
  Undo2,
} from '@lucide/vue'
import { useConfirm } from '@/composables/useConfirm'
import {
  PROGRAMMES_HREF,
  backToWeek,
  cameFromProgrammes,
  itemHref,
  programmeHref,
} from '@/lib/routes'
import { runControls, type Restarted, type RunAction, type RunActionBody } from '@/lib/runActions'
import {
  dayText,
  logSentence,
  primaryField,
  programmeOptions,
  runMeta,
  sourceText,
  activityOptions,
  type ChangeKind,
  type ChangePreview,
  type GridWeek,
  type SheetStart,
} from '@/lib/programmes'
import { currentMonday, workFrame } from '@/lib/work'
import { useProgrammesStore } from '@/stores/programmes'
import { useTrackersStore } from '@/stores/trackers'
import { Button } from '@/components/ui/button'
import { ChangeSheet, RunActionSheet } from '@/components/ui/change-sheet'
import { InlineMessage } from '@/components/ui/inline-message'
import ProgrammeWork from '@/components/ProgrammeWork.vue'
import { ProgrammeGrid } from '@/components/ui/programme-grid'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TextLink } from '@/components/ui/text-link'

const props = defineProps<{
  /** The programme tracker's id, from the address (`#/programme/<tracker>`). */
  tracker: string
}>()

const OFFLINE =
  'Can’t reach the server, so the programme can’t change now. Try again when you’re online.'

const store = useProgrammesStore()
const trackers = useTrackersStore()
const { confirm } = useConfirm()
const ids = { heading: useId(), bar: useId() }

const loadError = ref<string | null>(null)
/** A failed action of the page's own (End programme), in a line over the controls. */
const actionError = ref<string | null>(null)
const tab = ref('plan')

onMounted(async () => {
  store.run = null
  const res = await store.loadRun(props.tracker)
  if (res.ok) return
  // An address naming a tracker with no run opens the Programmes page instead.
  if (res.message === null) location.replace(PROGRAMMES_HREF)
  else loadError.value = res.message
})

/** The run, once loaded: arriving here clears the one an earlier overview had. */
const run = computed(() => store.run)
/** The tracker's own name, which can differ from the programme's (spec §4). */
const name = computed(() => trackers.get(props.tracker)?.name ?? run.value?.name ?? '')
const meta = computed(() => (run.value ? runMeta(run.value) : null))
const names = computed(() =>
  Object.fromEntries(run.value!.grid.activities.map((a) => [a.key, a.name])),
)
const ended = computed(() => run.value?.status === 'ended')
const paused = computed(() => run.value?.status === 'paused')

// -- the change sheet and 7B's preview --

const sheet = ref<SheetStart | null>(null)
const sheetKey = ref(0)
const sheetOpen = ref(false)
const sheetRef = useTemplateRef<InstanceType<typeof ChangeSheet>>('sheetRef')
/** Show it in the plan (K148): the change's preview, shown in the grid while the sheet is away. */
const shownChange = ref<{ preview: ChangePreview; sentence: string } | null>(null)
const previewing = computed(() => shownChange.value !== null && !sheetOpen.value)
const confirming = ref(false)

function openSheet(start: SheetStart): void {
  shownChange.value = null
  sheet.value = start
  sheetKey.value++
  sheetOpen.value = true
}

function onSheetOpen(open: boolean): void {
  sheetOpen.value = open
  // Back to the change, or a stale confirm, brings the sheet back: the plan's preview ends.
  if (open) shownChange.value = null
  // Closed with nothing to show in the plan: Cancel, Close or Escape. Nothing changed.
  else if (!shownChange.value) sheet.value = null
}

async function onShowInPlan(preview: ChangePreview, sentence: string): Promise<void> {
  shownChange.value = { preview, sentence }
  await nextTick()
  document.getElementById(ids.bar)?.focus()
}

function onDone(): void {
  shownChange.value = null
  sheet.value = null
}

/** A later week's cell: Edit this week (That week only), or Change from here. */
function openCell(key: string, week: GridWeek, scope: 'on' | 'once'): void {
  // A later week starts after today, so its Monday is a day a change may take.
  const from = week.monday
  openSheet({
    title: `Change ${names.value[key]}`,
    options: activityOptions(run.value!, key, from),
    kind: 'set-value',
    field: primaryField(week.cells[key]!.values!),
    activity: key,
    from,
    scope,
    undo: null,
  })
}

function openProgrammeChange(kind: ChangeKind): void {
  openSheet({
    title: `Change ${name.value}`,
    options: programmeOptions(run.value!),
    kind,
    field: null,
    activity: null,
    from: run.value!.today,
    scope: 'on',
    undo: null,
  })
}

/** Undo is a change too (spec P2): it previews first. */
function openUndo(seq: number): void {
  openSheet({
    title: `Change ${name.value}`,
    options: [{ kind: 'undo', field: null }],
    kind: 'undo',
    field: null,
    activity: null,
    from: run.value!.today,
    scope: 'on',
    undo: seq,
  })
}

async function confirmFromBar(): Promise<void> {
  confirming.value = true
  await sheetRef.value!.confirmChange()
  confirming.value = false
}

async function backToChange(): Promise<void> {
  onSheetOpen(true)
}

/** End programme (spec §4): from today, keeping its history. */
async function endProgramme(): Promise<void> {
  actionError.value = null
  const yes = await confirm({
    title: `End ${name.value}?`,
    message: `It ends today, ${dayText(run.value!.today)}. Its weeks, marks and changes stay.`,
    confirmLabel: 'End programme',
  })
  if (!yes) return
  const res = await store.endRun(props.tracker)
  if (!res.ok) actionError.value = res.message
}

// -- Re-open, Restart and Cancel the end (K168) --

/** Which controls the run gets: ended early, ended, ending on a later day, or running. */
const controls = computed(() => (run.value ? runControls(run.value) : 'running'))
const runAction = ref<RunAction | null>(null)
const runActionKey = ref(0)
const runActionOpen = ref(false)

function openRunAction(action: RunAction): void {
  actionError.value = null
  runAction.value = action
  runActionKey.value++
  runActionOpen.value = true
}

function onRunActionOpen(open: boolean): void {
  runActionOpen.value = open
  if (!open) runAction.value = null
}

function previewRunAction(action: RunAction, body: RunActionBody) {
  return action === 'restart'
    ? store.previewRestart(props.tracker, body)
    : store.previewReopen(props.tracker, body)
}

function confirmRunAction(action: RunAction, body: RunActionBody, rev: string) {
  return action === 'restart'
    ? store.restart(props.tracker, body, rev)
    : store.reopen(props.tracker, body, rev)
}

/** A confirmed restart opens the new tracker's overview; a re-open shows the run it sent back. */
function onRunActionDone(data: unknown): void {
  if (runAction.value === 'restart') location.hash = programmeHref((data as Restarted).tracker.id)
}

const log = computed(() =>
  run.value!.log.map((entry) => ({
    entry,
    what: logSentence(entry.change, entry.from, names.value, run.value!.log),
  })),
)

const META = 'body text-(length:--set-text) leading-[1.45] text-ink-secondary'
const CONTROL =
  'folded:h-auto folded:min-h-12 folded:gap-2 folded:px-2 folded:py-1 folded:leading-5 folded:whitespace-normal'

/**
 * Back goes where the overview was opened from (K161): the Programmes page, back through history,
 * or the week, as every page's Back to the week does.
 */
const fromProgrammes = cameFromProgrammes()
function backToProgrammes(ev: MouseEvent): void {
  if (ev.ctrlKey || ev.metaKey || ev.shiftKey) return
  ev.preventDefault()
  history.back()
}
</script>

<!--
  A programme's overview (ProgrammeGrid card, spec §9.2), at #/programme/<tracker>: ItemPage's head
  with no bar, "Programme" and the tracker's name, the line saying where the run is, then Plan, Work
  and Changes. Plan is the server's grid (P4), what ends short, and the programme's controls; a later
  week's cell opens Edit this week and Change from here. Work is the run's work charts (K180), left
  out when an older server sends none. Changes is the log, newest first, with Undo
  where the change starts today or later. Every change goes through the ChangeSheet; Show it in the
  plan puts the sheet away and shows the change in the grid with a bar at the foot (K148). Offline,
  the controls, the cells and Undo are disabled with one line saying why.
-->
<template>
  <div
    class="flex flex-col pt-[calc(var(--u)*28)] pb-[calc(var(--u)*64)]"
    :class="previewing && 'pb-56'"
    data-slot="item-page"
    data-testid="programme-overview"
    :data-previewing="previewing ? '' : undefined"
  >
    <TextLink
      v-if="fromProgrammes"
      :href="PROGRAMMES_HREF"
      class="inline-flex items-center gap-1.5 self-start text-(length:--set-text) [&_svg]:size-(--set-icon)"
      data-noprint
      data-testid="back-to-programmes"
      @click="backToProgrammes"
      ><ChevronLeft :stroke-width="1.5" aria-hidden="true" />Back to programmes</TextLink
    >
    <TextLink
      v-else
      href="#/"
      class="inline-flex items-center gap-1.5 self-start text-(length:--set-text) [&_svg]:size-(--set-icon)"
      data-noprint
      data-testid="back-to-week"
      @click="backToWeek"
      ><ChevronLeft :stroke-width="1.5" aria-hidden="true" />Back to the week</TextLink
    >
    <p
      class="label mt-[calc(var(--u)*16)] text-(length:--set-label) leading-snug text-ink-secondary"
    >
      Programme
    </p>
    <h1
      :id="ids.heading"
      class="title-1 mt-[calc(var(--u)*4)] min-w-0 text-(length:--fs-title) leading-tight break-words text-ink"
    >
      {{ name }}
    </h1>
    <p v-if="meta" :class="META" class="mt-1.5" data-testid="programme-meta">
      <b v-if="meta.lead" class="font-semibold text-ink">{{ meta.lead }}</b>
      {{ meta.rest }}
    </p>
    <InlineMessage v-if="loadError" tone="error" class="mt-4">{{ loadError }}</InlineMessage>

    <template v-if="run && previewing">
      <ProgrammeGrid
        class="mt-5"
        :grid="shownChange!.preview.grid"
        :kind="run.kind"
        mode="preview"
        :changes="shownChange!.preview.cells"
        label="The plan with the change, week by week"
        bleed
        :item-href="(key) => itemHref(tracker, key)"
      />
    </template>
    <Tabs v-else-if="run" v-model="tab" class="mt-[calc(var(--u)*24)]">
      <TabsList :aria-labelledby="ids.heading" class="gap-x-[calc(var(--u)*32)]">
        <TabsTrigger
          value="plan"
          class="text-(length:--set-text) leading-[1.35]"
          data-testid="programme-tab-plan"
          >Plan</TabsTrigger
        >
        <TabsTrigger
          v-if="run.work"
          value="work"
          class="text-(length:--set-text) leading-[1.35]"
          data-testid="programme-tab-work"
          >Work</TabsTrigger
        >
        <TabsTrigger
          value="changes"
          class="text-(length:--set-text) leading-[1.35]"
          data-testid="programme-tab-changes"
          >Changes</TabsTrigger
        >
      </TabsList>

      <TabsContent value="plan">
        <ProgrammeGrid
          class="mt-5"
          :grid="run.grid"
          :kind="run.kind"
          mode="running"
          label="The plan, week by week"
          :open-pause="run.openPause !== null"
          :disabled="store.offline"
          :readonly="ended"
          bleed
          :item-href="(key) => itemHref(tracker, key)"
          @edit="(key, week) => openCell(key, week, 'once')"
          @change="(key, week) => openCell(key, week, 'on')"
        />
        <div
          v-if="run.endsShort.length"
          class="mt-4 flex flex-col gap-1"
          data-testid="programme-ends-short"
        >
          <InlineMessage v-for="e in run.endsShort" :key="e.key" tone="info">{{
            e.message
          }}</InlineMessage>
        </div>
        <InlineMessage
          v-if="store.offline"
          tone="info"
          class="mt-4"
          data-testid="programme-offline"
          >{{ OFFLINE }}</InlineMessage
        >
        <InlineMessage v-if="actionError" tone="error" class="mt-4" data-testid="programme-error">{{
          actionError
        }}</InlineMessage>
        <div
          class="mt-[calc(var(--u)*28)] flex flex-wrap gap-3 folded:grid folded:grid-cols-2"
          data-testid="programme-controls"
        >
          <!-- An ended run (K168): Re-open when End programme stopped it part way, and Restart. -->
          <template v-if="ended">
            <Button
              v-if="controls === 'ended-early'"
              :class="CONTROL"
              :disabled="store.offline"
              data-testid="programme-reopen"
              @click="openRunAction('reopen')"
              ><Play :stroke-width="1.5" />Re-open programme</Button
            >
            <Button
              :class="CONTROL"
              :disabled="store.offline"
              data-testid="programme-restart"
              @click="openRunAction('restart')"
              ><RotateCcw :stroke-width="1.5" />Restart from week 1</Button
            >
          </template>
          <template v-else>
            <Button
              v-if="paused"
              :class="CONTROL"
              :disabled="store.offline"
              data-testid="programme-resume"
              @click="openProgrammeChange('resume-programme')"
              ><Play :stroke-width="1.5" />Resume programme</Button
            >
            <Button
              v-else
              :class="CONTROL"
              :disabled="store.offline"
              data-testid="programme-pause"
              @click="openProgrammeChange('pause-programme')"
              ><Pause :stroke-width="1.5" />Pause programme</Button
            >
            <Button
              :class="CONTROL"
              :disabled="store.offline"
              data-testid="programme-go-to-week"
              @click="openProgrammeChange('go-to-week')"
              ><SkipForward :stroke-width="1.5" />Go to week</Button
            >
            <Button
              :class="CONTROL"
              :disabled="store.offline"
              data-testid="programme-add-activity"
              @click="openProgrammeChange('add-activity')"
              ><Plus :stroke-width="1.5" />Add activity</Button
            >
            <Button
              v-if="controls === 'running'"
              :class="CONTROL"
              :disabled="store.offline"
              data-testid="programme-end"
              @click="endProgramme"
              ><CircleStop :stroke-width="1.5" />End programme</Button
            >
            <!-- An end set for a later day: Cancel the end re-opens from its own day (K168). -->
            <Button
              v-else-if="run.canReopen"
              :class="CONTROL"
              :disabled="store.offline"
              data-testid="programme-cancel-end"
              @click="openRunAction('cancel-end')"
              ><Undo2 :stroke-width="1.5" />Cancel the end</Button
            >
          </template>
        </div>
      </TabsContent>

      <TabsContent v-if="run.work" value="work">
        <ProgrammeWork :work="run.work" :frame="workFrame(run)" :current="currentMonday(run)" />
      </TabsContent>

      <TabsContent value="changes">
        <ol class="mt-3 max-w-[820px]" data-testid="programme-changes">
          <li
            v-for="{ entry, what } in log"
            :key="entry.seq"
            class="grid grid-cols-[130px_minmax(0,1fr)_auto] items-start gap-x-5 gap-y-1 border-b border-line py-4 folded:grid-cols-[minmax(0,1fr)_auto]"
            data-testid="programme-change"
          >
            <span
              class="text-(length:--set-caption) leading-[1.6] whitespace-nowrap text-ink-secondary folded:col-span-2"
              >{{ dayText(entry.from) }}</span
            >
            <div>
              <p class="text-(length:--set-text) leading-[1.45] text-ink">{{ what }}</p>
              <p
                v-if="entry.reason"
                class="note mt-0.5 text-(length:--set-text) leading-[1.45] italic"
              >
                {{ entry.reason }}
              </p>
              <p class="mt-0.5 text-(length:--set-caption) leading-[1.35] text-ink-secondary">
                {{ sourceText(entry.source) }}
              </p>
              <p
                v-if="entry.undoneBy !== null"
                class="mt-0.5 text-(length:--set-caption) leading-[1.35] text-ink-secondary"
              >
                Undone.
              </p>
            </div>
            <Button
              v-if="entry.undoable && !ended"
              variant="quiet"
              size="sm"
              :disabled="store.offline"
              data-testid="programme-change-undo"
              @click="openUndo(entry.seq)"
              ><Undo2 :stroke-width="1.5" />Undo</Button
            >
            <span v-else />
          </li>
          <li
            class="grid grid-cols-[130px_minmax(0,1fr)_auto] items-start gap-x-5 gap-y-1 border-b border-line py-4 folded:grid-cols-[minmax(0,1fr)_auto]"
            data-testid="programme-change"
          >
            <span
              class="text-(length:--set-caption) leading-[1.6] whitespace-nowrap text-ink-secondary folded:col-span-2"
              >{{ dayText(run.start) }}</span
            >
            <p class="text-(length:--set-text) leading-[1.45] text-ink">
              Started on {{ dayText(run.start) }}.
            </p>
          </li>
        </ol>
      </TabsContent>
    </Tabs>
  </div>

  <div
    v-if="run && previewing"
    :id="ids.bar"
    role="region"
    :aria-labelledby="`${ids.bar}-words`"
    tabindex="-1"
    class="fixed inset-x-0 bottom-0 z-30 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line bg-panel px-(--screen-pad-x) py-3.5 shadow-overlay focus:outline-none print:hidden"
    data-slot="item-page"
    data-testid="change-preview-bar"
  >
    <p
      :id="`${ids.bar}-words`"
      class="min-w-0 flex-[1_1_320px] text-(length:--set-text) leading-[1.45] text-ink"
    >
      <b class="font-semibold">Previewing a change.</b> {{ shownChange!.sentence }} Nothing is saved
      yet.
    </p>
    <div class="flex flex-wrap gap-3 folded:grid folded:basis-full folded:grid-cols-2 folded:gap-2">
      <Button :class="CONTROL" data-testid="change-preview-back" @click="backToChange"
        ><ChevronLeft :stroke-width="1.5" />Back to the change</Button
      >
      <Button
        variant="primary"
        :class="CONTROL"
        :busy="confirming"
        data-testid="change-preview-confirm"
        @click="confirmFromBar"
        >Confirm change</Button
      >
    </div>
  </div>

  <ChangeSheet
    v-if="run && sheet"
    ref="sheetRef"
    :key="sheetKey"
    :open="sheetOpen"
    :run="run"
    :start="sheet"
    :preview="(request) => store.previewChange(tracker, request)"
    :confirm="(request, rev) => store.confirmChange(tracker, request, rev)"
    @update:open="onSheetOpen"
    @show-in-plan="onShowInPlan"
    @done="onDone"
  />

  <RunActionSheet
    v-if="run && runAction"
    :key="runActionKey"
    :open="runActionOpen"
    :run="run"
    :action="runAction"
    :name="name"
    :preview="(body) => previewRunAction(runAction!, body)"
    :confirm="(body, rev) => confirmRunAction(runAction!, body, rev)"
    @update:open="onRunActionOpen"
    @done="onRunActionDone"
  />
</template>
