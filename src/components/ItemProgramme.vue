<script setup lang="ts">
import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue'
import { ChevronLeft, CircleStop, Pause, Pencil, Play, TrendingUp } from '@lucide/vue'
import { itemHref } from '@/lib/routes'
import {
  FIELD_WORDS,
  activityOptions,
  type ChangeKind,
  type ChangePreview,
  type Field,
  type SheetStart,
} from '@/lib/programmes'
import { useProgrammesStore } from '@/stores/programmes'
import { useSyncStore } from '@/stores/sync'
import { Button } from '@/components/ui/button'
import { ChangeSheet } from '@/components/ui/change-sheet'
import { InlineMessage } from '@/components/ui/inline-message'
import { ProgrammeChart, ProgrammeLede, activityChart } from '@/components/ui/programme-chart'
import { ProgrammeGrid } from '@/components/ui/programme-grid'
import { WorkChart, WorkLegend } from '@/components/ui/work-chart'
import { LEDE } from '@/lib/itemPage'
import { chartLabel, currentMonday, workFrame, workLine } from '@/lib/work'

const props = defineProps<{
  /** The programme tracker's id. */
  tracker: string
  /** The activity's key, which is its item's id (§8.6). */
  activity: string
}>()

const OFFLINE =
  'Can’t reach the server, so the programme can’t change now. Try again when you’re online.'

const store = useProgrammesStore()
const sync = useSyncStore()
const barId = useId()

const loadError = ref<string | null>(null)
// The run's grid is the chart's (P4): read it, and again whenever the state lists a newer one.
watch(
  () => sync.runs[props.tracker]?.rev,
  async () => {
    const res = await store.ensureRun(props.tracker)
    loadError.value = res && !res.ok ? res.message : null
  },
  { immediate: true },
)

const run = computed(() => store.byTracker[props.tracker] ?? null)
const chart = computed(() => (run.value ? activityChart(run.value, props.activity) : null))
const ended = computed(() => run.value!.status === 'ended')
/** The activity's work chart (K180), found by its key in the run's work; none from an older
 * server, or for an activity the work leaves out. */
const work = computed(() => {
  const series = run.value!.work?.activities.find((a) => a.key === props.activity)
  if (!series) return null
  const current = currentMonday(run.value!)
  return {
    series,
    frame: workFrame(run.value!),
    current,
    line: workLine(series, current, series.measure === 'work'),
    label: chartLabel(series.name, series.measure),
  }
})
const paused = computed(() =>
  activityOptions(run.value!, props.activity).some((o) => o.kind === 'resume-activity'),
)

// -- the change sheet, and Show it in the plan (K148) --

const sheet = ref<SheetStart | null>(null)
const sheetKey = ref(0)
const sheetOpen = ref(false)
const sheetRef = useTemplateRef<InstanceType<typeof ChangeSheet>>('sheetRef')
const shownChange = ref<{ preview: ChangePreview; sentence: string } | null>(null)
const previewing = computed(() => shownChange.value !== null && !sheetOpen.value)
const confirming = ref(false)

/** A control opens the ChangeSheet with its change chosen, from today (ProgrammeChart card). */
function open(kind: ChangeKind): void {
  shownChange.value = null
  sheet.value = {
    title: `Change ${chart.value!.name}`,
    options: activityOptions(run.value!, props.activity),
    kind,
    field: kind === 'set-value' ? chart.value!.field : null,
    activity: props.activity,
    from: run.value!.today,
    scope: 'on',
    undo: null,
  }
  sheetKey.value++
  sheetOpen.value = true
}

function onSheetOpen(next: boolean): void {
  sheetOpen.value = next
  if (next) shownChange.value = null
  else if (!shownChange.value) sheet.value = null
}

/**
 * Resolves once the closing sheet has left the page, after its closing animation, and a task
 * later: its focus scope hands focus back then, and the bar must take it after that.
 */
function sheetGone(): Promise<void> {
  return new Promise((resolve) => {
    const check = () =>
      document.querySelector('[data-testid="change-sheet"]')
        ? requestAnimationFrame(check)
        : setTimeout(resolve)
    check()
  })
}

async function onShowInPlan(preview: ChangePreview, sentence: string): Promise<void> {
  shownChange.value = { preview, sentence }
  await nextTick()
  await sheetGone()
  document.getElementById(barId)?.focus()
}

function onDone(): void {
  shownChange.value = null
  sheet.value = null
}

async function confirmFromBar(): Promise<void> {
  confirming.value = true
  await sheetRef.value!.confirmChange()
  confirming.value = false
}

/** Set weight, or Set reps or Set time: named for the field the chart shows (spec §9.4). */
const setLabel = computed(() => FIELD_WORDS[chart.value!.field as Field].set)

const CONTROL =
  'folded:h-auto folded:min-h-12 folded:gap-2 folded:px-2 folded:py-1 folded:leading-5 folded:whitespace-normal'
</script>

<!--
  An activity's Programme row's content (ProgrammeChart card, K145, spec §9.4): the lede, the
  step chart from the run's grid, the line when it ends short, the activity's work under a "Work"
  heading (WorkChart card, K180), then its controls, each opening the
  ChangeSheet from today with its change chosen. Offline, the controls are disabled with one line
  saying why (spec §11.2). Show it in the plan (K148) puts the sheet away and shows the run's plan
  with the change in its cells here, with the overview's bar at the foot.
-->
<template>
  <InlineMessage v-if="loadError && !run" tone="error" data-testid="programme-error">{{
    loadError
  }}</InlineMessage>
  <template v-if="run && chart">
    <ProgrammeLede :lede="chart.lede" data-testid="programme-lede" />
    <!-- The page's foot keeps clear of the bar, as the overview's does. -->
    <ProgrammeGrid
      v-if="previewing"
      class="mb-56"
      :grid="shownChange!.preview.grid"
      :kind="run.kind"
      mode="preview"
      :changes="shownChange!.preview.cells"
      label="The plan with the change, week by week"
      :item-href="(key) => itemHref(tracker, key)"
    />
    <template v-else>
      <ProgrammeChart :chart="chart" />
      <InlineMessage v-if="chart.endsShort" tone="info" data-testid="activity-ends-short">{{
        chart.endsShort
      }}</InlineMessage>
      <!-- The activity's work, as the overview's Work tab draws it (WorkChart card, K180). -->
      <div v-if="work" class="flex flex-col gap-3" data-testid="activity-work">
        <h3 class="label text-(length:--set-label) leading-[1.3] font-semibold text-ink">Work</h3>
        <p :class="LEDE" data-testid="activity-work-line">
          {{ work.line.before }}<b class="font-semibold text-ink">{{ work.line.value }}</b
          >{{ work.line.after }}
        </p>
        <WorkLegend />
        <WorkChart
          :series="work.series"
          :frame="work.frame"
          :current="work.current"
          :height="200"
          :label="work.label"
        />
      </div>
      <template v-if="!ended">
        <InlineMessage v-if="store.offline" tone="info" data-testid="activity-offline">{{
          OFFLINE
        }}</InlineMessage>
        <div
          class="flex flex-wrap gap-3 folded:grid folded:grid-cols-2"
          data-testid="activity-controls"
        >
          <Button
            :class="CONTROL"
            :disabled="store.offline"
            data-testid="activity-set-value"
            @click="open('set-value')"
            ><Pencil :stroke-width="1.5" />{{ setLabel }}</Button
          >
          <Button
            :class="CONTROL"
            :disabled="store.offline"
            data-testid="activity-set-increase"
            @click="open('set-increase')"
            ><TrendingUp :stroke-width="1.5" />Set increase</Button
          >
          <Button
            v-if="paused"
            :class="CONTROL"
            :disabled="store.offline"
            data-testid="activity-resume"
            @click="open('resume-activity')"
            ><Play :stroke-width="1.5" />Resume activity</Button
          >
          <Button
            v-else
            :class="CONTROL"
            :disabled="store.offline"
            data-testid="activity-pause"
            @click="open('pause-activity')"
            ><Pause :stroke-width="1.5" />Pause activity</Button
          >
          <Button
            :class="CONTROL"
            :disabled="store.offline"
            data-testid="activity-end"
            @click="open('end-activity')"
            ><CircleStop :stroke-width="1.5" />End activity</Button
          >
        </div>
      </template>
    </template>

    <div
      v-if="previewing"
      :id="barId"
      role="region"
      :aria-labelledby="`${barId}-words`"
      tabindex="-1"
      class="fixed inset-x-0 bottom-0 z-30 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line bg-panel px-(--screen-pad-x) py-3.5 shadow-overlay focus:outline-none print:hidden"
      data-testid="change-preview-bar"
    >
      <p
        :id="`${barId}-words`"
        class="min-w-0 flex-[1_1_320px] text-(length:--set-text) leading-[1.45] text-ink"
      >
        <b class="font-semibold">Previewing a change.</b> {{ shownChange!.sentence }} Nothing is
        saved yet.
      </p>
      <div
        class="flex flex-wrap gap-3 folded:grid folded:basis-full folded:grid-cols-2 folded:gap-2"
      >
        <Button :class="CONTROL" data-testid="change-preview-back" @click="onSheetOpen(true)"
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
      v-if="sheet"
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
  </template>
</template>
