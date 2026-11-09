<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from 'vue'
import { ChevronLeft, Download, LogOut, Upload } from '@lucide/vue'
import { usePlannerStore } from '@/stores/planner'
import { useDietStore } from '@/stores/diet'
import { useAskStore } from '@/stores/ask'
import { useDetailsStore } from '@/stores/details'
import { useSessionStore } from '@/stores/session'
import { useSyncStore } from '@/stores/sync'
import { request } from '@/lib/api'
import { describeProblem } from '@/lib/problems'
import { useImportSummary } from '@/composables/importSummary'
import {
  MARK_KINDS,
  MARK_SETS,
  MAX_GOALS,
  isMarkSet,
  normaliseGoals,
  type MarkSet,
} from '@/lib/storage'
import { THEMES, type Theme } from '@/lib/theme'
import { countOf } from '@/lib/words'
import { APP_NAME } from '@/lib/app'
import {
  buildExport,
  downloadExport,
  parseExport,
  type ExportData,
  type ParseError,
} from '@/lib/transfer'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DayMarkDrawing } from '@/components/ui/day-mark'
import { InlineMessage } from '@/components/ui/inline-message'
import { RadioCard } from '@/components/ui/radio-card'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Switch } from '@/components/ui/switch'
import { TextArea } from '@/components/ui/text-area'
import { TextLink } from '@/components/ui/text-link'
import ConnectionsSection from '@/components/ConnectionsSection.vue'

const THEME_NAMES: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' }
const THEME_OPTIONS = THEMES.map((t) => ({ value: t, label: THEME_NAMES[t] }))
const MARK_SET_NAMES: Record<MarkSet, string> = {
  squiggles: 'Squiggles',
  ticks: 'Ticks',
  'stamped-ticks': 'Stamped ticks',
  faces: 'Faces',
  'stamped-faces': 'Stamped faces',
}
const MARK_SET_OPTIONS = MARK_SETS.map((m) => ({ value: m, label: MARK_SET_NAMES[m] }))

const IMPORT_ERRORS: Record<ParseError | 'read', string> = {
  json: 'That file isn’t valid JSON.',
  format: `That file isn’t a ${APP_NAME} export.`,
  version: 'That export comes from a newer version of the app.',
  read: 'That file couldn’t be read.',
}

const IMPORT_FAILED: Record<'offline' | 'server' | 'auth' | 'quota' | 'error', string> = {
  offline: 'Can’t reach the server, so nothing was imported. Try again when you’re online.',
  server: 'The server had a problem, so nothing was imported. Try again in a while.',
  auth: 'Your session has ended. Sign in again, then import the file.',
  quota: 'Your account is full, so nothing was imported.',
  error: 'The server refused the import, so nothing changed.',
}

const EXPORT_WITHOUT_HISTORY =
  'Exported without your Ask conversations, because the server couldn’t be reached.'

/** How long typing in Your goals rests before it is saved (F18). */
const GOALS_PAUSE_MS = 600

const store = usePlannerStore()
const diet = useDietStore()
const ask = useAskStore()
const details = useDetailsStore()
const session = useSessionStore()
const sync = useSyncStore()
const heading = useTemplateRef<HTMLHeadingElement>('heading')
const signOutButton = useTemplateRef<InstanceType<typeof Button>>('signOutButton')
const ids = {
  look: useId(),
  goals: useId(),
  data: useId(),
  connections: useId(),
  account: useId(),
}

// Arriving here moves focus to the page's heading, so a screen reader starts at the top.
onMounted(() => heading.value!.focus())

/*
 * Your goals: the box keeps its own draft, saved when the person stops typing for a moment or
 * leaves the box, so one pause is one write (F18). The draft is never trimmed while typing.
 */
/** Daily goal (K85): the switch reads and sets the store's, which syncs with the account. */
const dailyGoal = computed({
  get: () => store.dailyGoal,
  set: (on: boolean) => store.setDailyGoal(on),
})
const dailyGoalHint = useId()
const goalsDraft = ref(store.goals)
let goalsTimer: ReturnType<typeof setTimeout> | undefined
/**
 * Typing may replace the goals only once they are known: read from the server or a cache that
 * carried them, or an account the server says has no settings at all (a new one), whose goals
 * are empty. Until then a stand-in would erase the saved ones (F1).
 */
const goalsEditable = computed(
  () => store.goalsKnown || (sync.fresh && store.savedSettings() === null),
)

function commitGoals(): void {
  clearTimeout(goalsTimer)
  goalsTimer = undefined
  if (goalsEditable.value) store.setGoals(goalsDraft.value)
}
function onGoalsInput(): void {
  clearTimeout(goalsTimer)
  goalsTimer = setTimeout(commitGoals, GOALS_PAUSE_MS)
}
// Goals saved elsewhere (another tab, the server) show here, unless the person is mid-pause.
watch(
  () => store.goals,
  (saved) => {
    if (goalsTimer === undefined && saved !== normaliseGoals(goalsDraft.value)) {
      goalsDraft.value = saved
    }
  },
)
onBeforeUnmount(() => {
  if (goalsTimer !== undefined) commitGoals()
})

const fileInput = ref<HTMLInputElement | null>(null)
/** A parsed file waiting for "Import". */
const pending = ref<ExportData | null>(null)
const notice = ref<{ tone: 'error' | 'success' | 'info'; text: string } | null>(null)
const signOutProblem = ref<string | null>(null)
const importing = ref(false)
const summary = useImportSummary()

const theme = computed({
  get: () => store.theme,
  set: (value: string) => store.setTheme(value as Theme),
})
const markSet = computed({
  get: () => store.markSet,
  set: (value: string) => {
    if (isMarkSet(value)) store.markSet = value
  },
})

/**
 * The plans, marks, item details and settings as this device has them, unsynced changes included, plus Ask's
 * conversations, which only the server keeps: its own export carries them (docs/api.md §3), so
 * one read fetches them all. Without a server the file still downloads, without them, and says so.
 */
async function exportData(): Promise<void> {
  notice.value = null
  const file = buildExport({
    exercise: { plans: store.plans, log: store.log, details: details.docs.exercise },
    diet: { plans: diet.plans, log: diet.log, details: details.docs.diet },
    settings: {
      accent: store.accent,
      dailyPick: store.dailyPick,
      foodPick: store.foodPick,
      ...(store.dailyGoalKnown ? { dailyGoal: store.dailyGoal } : {}),
      goals: store.goals,
      itemSections: store.itemSections,
    },
  })
  const res = await request<{ conversations?: unknown }>('GET', '/export', undefined, {
    'X-Expected-User': session.user ?? '',
  })
  const conversations = res.ok ? res.data.conversations : undefined
  // A file without the list reads as one from before Ask (transfer.ts), so none means no key.
  const history = Array.isArray(conversations) && conversations.length ? { conversations } : {}
  downloadExport({ ...file, ...history })
  if (!res.ok) notice.value = { tone: 'info', text: EXPORT_WITHOUT_HISTORY }
}

async function onFile(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  // Cleared so that choosing the same file again still fires `change`.
  input.value = ''
  if (!file) return
  pending.value = null
  notice.value = null
  let text: string
  try {
    text = await file.text()
  } catch {
    notice.value = { tone: 'error', text: IMPORT_ERRORS.read }
    return
  }
  const result = parseExport(text)
  if (!result.ok) {
    notice.value = { tone: 'error', text: IMPORT_ERRORS[result.error] }
    return
  }
  // The summary counts only the file's conversations the account doesn't have yet.
  if (result.data.conversations?.length) await ask.loadList()
  if (!summary.addsAnything(result.data)) {
    notice.value = {
      tone: 'success',
      text: 'Nothing new: everything in that file is already here.',
    }
    return
  }
  pending.value = result.data
}

/** Merge the file on the server (one request, never deleting), then show the result. */
async function confirmImport(data: ExportData): Promise<void> {
  if (importing.value) return
  importing.value = true
  const outcome = await sync.importFile(data)
  importing.value = false
  if (outcome.ok) {
    pending.value = null
    notice.value = { tone: 'success', text: 'Imported.' }
  } else {
    notice.value = { tone: 'error', text: IMPORT_FAILED[outcome.code] }
  }
}

// Sign out with unsynced changes asks first: signing out forgets this device's outbox, so those
// changes are lost (session.logout → sync.forget).
const askSignOut = ref(false)
const signingOut = ref(false)
const signOutError = ref<string | undefined>(undefined)
const unsynced = computed(() => {
  const n = sync.pending
  return `${countOf(n, 'change', true)} on this device ${n === 1 ? 'hasn’t' : 'haven’t'} reached the server yet. Signing out now loses them.`
})

/** The Sign out button, where focus returns once the sign-out question closes. */
function signOutTarget(): HTMLElement | null {
  return (signOutButton.value?.$el as HTMLElement | undefined) ?? null
}

async function signOut(): Promise<void> {
  if (!sync.pending) {
    const problem = await session.logout()
    signOutProblem.value = problem ? describeProblem(problem) : null
    return
  }
  signOutError.value = undefined
  askSignOut.value = true
}

async function confirmSignOut(): Promise<void> {
  if (signingOut.value) return
  signingOut.value = true
  const problem = await session.logout()
  signingOut.value = false
  if (problem) signOutError.value = describeProblem(problem)
  else askSignOut.value = false
}
</script>

<!--
  The Settings page (brand/design-system/project/components/SettingsPage), at #/settings, with no
  Header (K52): a link back to the week, the heading, then Appearance (Marks, then Theme, K59),
  Your goals (the Ask mockup's row), Your data, Connections (ConnectionsSection) and Account. The daily targets are set in Edit
  plan (K56). Full width in rows like the week (K51): each section's
  heading in the week's name column, its settings beside it, a line rule above each row, controls
  beside their words (K53). Settings take effect at once; there is no Save. Your goals saves when
  typing pauses.
-->
<template>
  <div
    class="flex flex-col pt-[calc(var(--u)*28)] pb-[calc(var(--u)*64)]"
    data-slot="settings-page"
    data-testid="settings-page"
    data-noprint
  >
    <TextLink
      href="#/"
      class="inline-flex items-center gap-1.5 self-start text-(length:--set-text) [&_svg]:size-(--set-icon)"
      ><ChevronLeft :stroke-width="1.5" aria-hidden="true" />Back to the week</TextLink
    >
    <h1
      ref="heading"
      tabindex="-1"
      class="title-1 mt-[calc(var(--u)*12)] mb-[calc(var(--u)*28)] text-(length:--fs-title) leading-tight text-ink focus:outline-none"
    >
      Settings
    </h1>

    <section
      :aria-labelledby="ids.look"
      class="grid grid-cols-[var(--grid-name-w)_minmax(0,1fr)] items-start border-t border-line py-(--set-sec-y) folded:flex folded:flex-col folded:items-stretch folded:gap-4"
    >
      <h2 :id="ids.look" class="title-2 text-(length:--set-h2) leading-tight text-ink">
        Appearance
      </h2>
      <div class="flex min-w-0 flex-col gap-(--set-gap)">
        <RadioCard v-model="markSet" label="Marks" :options="MARK_SET_OPTIONS">
          <template #picture="{ option }">
            <span
              v-for="kind in MARK_KINDS"
              :key="kind"
              class="grid size-(--set-mark) shrink-0 place-items-center [&_svg]:size-[94%]"
              data-testid="mark-set-sample"
            >
              <DayMarkDrawing :mark="kind" :set="option.value as MarkSet" />
            </span>
          </template>
        </RadioCard>
        <SegmentedControl v-model="theme" label="Theme" :options="THEME_OPTIONS" />
      </div>
    </section>

    <section
      :aria-labelledby="ids.goals"
      class="grid grid-cols-[var(--grid-name-w)_minmax(0,1fr)] items-start border-t border-line py-(--set-sec-y) folded:flex folded:flex-col folded:items-stretch folded:gap-4"
    >
      <h2 :id="ids.goals" class="title-2 text-(length:--set-h2) leading-tight text-ink">
        Your goals
      </h2>
      <div class="flex min-w-0 flex-col gap-(--set-gap)">
        <!-- Daily goal (K85): first in Your goals, the Switch with its hint under it. -->
        <div class="flex flex-col items-start gap-[calc(var(--u)*6)]">
          <Switch
            v-model="dailyGoal"
            label="Daily goal"
            class="-ml-2"
            :aria-describedby="dailyGoalHint"
            data-testid="daily-goal"
          />
          <p
            :id="dailyGoalHint"
            class="caption max-w-[60ch] text-(length:--set-caption) leading-[1.35] text-ink-secondary"
          >
            A number of exercises and of foods to reach each day, set in Edit plan. A day that
            reaches it turns green.
          </p>
        </div>
        <TextArea
          v-model="goalsDraft"
          label="What you’re working towards"
          hint="Ask reads this when it answers. Nothing else does."
          rows="4"
          :maxlength="MAX_GOALS"
          :disabled="!goalsEditable"
          class="max-w-[calc(var(--u)*900)]"
          data-testid="goals"
          @input="onGoalsInput"
          @blur="commitGoals"
        />
      </div>
    </section>

    <section
      :aria-labelledby="ids.data"
      class="grid grid-cols-[var(--grid-name-w)_minmax(0,1fr)] items-start border-t border-line py-(--set-sec-y) folded:flex folded:flex-col folded:items-stretch folded:gap-4"
    >
      <h2 :id="ids.data" class="title-2 text-(length:--set-h2) leading-tight text-ink">
        Your data
      </h2>
      <div class="flex min-w-0 flex-col gap-(--set-gap)">
        <!-- The text, then its buttons beside it, as Sign out sits beside "Signed in as" (K53). -->
        <div class="flex flex-wrap items-center gap-x-(--set-gap) gap-y-3">
          <p class="body max-w-[34ch] text-(length:--set-text) leading-normal text-ink-secondary">
            Export saves everything to a file. Import adds a file’s plans and marks to yours and
            never deletes anything.
          </p>
          <div role="group" :aria-labelledby="ids.data" class="flex flex-wrap gap-3">
            <Button @click="exportData"><Download :stroke-width="1.5" />Export</Button>
            <Button @click="fileInput?.click()"><Upload :stroke-width="1.5" />Import…</Button>
            <input
              ref="fileInput"
              type="file"
              accept=".json,application/json"
              class="hidden"
              aria-label="Export file to import"
              data-testid="import-file"
              @change="onFile"
            />
          </div>
        </div>
        <div v-if="pending" class="flex flex-col gap-2" role="group" aria-label="Confirm import">
          <p
            class="body text-(length:--set-text) leading-normal text-ink"
            data-testid="import-summary"
          >
            {{ summary.describe(pending) }}
          </p>
          <div class="flex gap-3">
            <Button @click="pending = null">Cancel</Button>
            <Button variant="primary" :busy="importing" @click="confirmImport(pending)">
              Import
            </Button>
          </div>
        </div>
        <InlineMessage v-if="notice" :tone="notice.tone" data-testid="import-notice">
          {{ notice.text }}
        </InlineMessage>
      </div>
    </section>

    <section
      :aria-labelledby="ids.connections"
      class="grid grid-cols-[var(--grid-name-w)_minmax(0,1fr)] items-start border-t border-line py-(--set-sec-y) folded:flex folded:flex-col folded:items-stretch folded:gap-4"
    >
      <h2 :id="ids.connections" class="title-2 text-(length:--set-h2) leading-tight text-ink">
        Connections
      </h2>
      <ConnectionsSection />
    </section>

    <section
      :aria-labelledby="ids.account"
      class="grid grid-cols-[var(--grid-name-w)_minmax(0,1fr)] items-start border-t border-line py-(--set-sec-y) folded:flex folded:flex-col folded:items-stretch folded:gap-4"
    >
      <h2 :id="ids.account" class="title-2 text-(length:--set-h2) leading-tight text-ink">
        Account
      </h2>
      <div class="flex min-w-0 flex-col gap-(--set-gap)">
        <div class="flex flex-wrap items-center gap-x-(--set-gap) gap-y-3">
          <p
            class="body min-w-0 text-(length:--set-text) leading-normal break-words text-ink-secondary"
            data-testid="signed-in-as"
          >
            Signed in as <span class="font-semibold text-ink">{{ session.user }}</span>
          </p>
          <Button ref="signOutButton" @click="signOut"
            ><LogOut :stroke-width="1.5" />Sign out</Button
          >
        </div>
        <InlineMessage v-if="signOutProblem" tone="error" data-testid="sign-out-problem">
          {{ signOutProblem }}
        </InlineMessage>
      </div>
    </section>

    <ConfirmDialog
      v-model:open="askSignOut"
      title="Sign out now?"
      :message="unsynced"
      confirm-label="Sign out"
      :busy="signingOut"
      :error="signOutError"
      :return-focus="signOutTarget"
      @confirm="confirmSignOut"
    />
  </div>
</template>
