<script setup lang="ts">
import { computed, onMounted, ref, useId, useTemplateRef } from 'vue'
import { ChevronLeft, Download, Upload } from '@lucide/vue'
import { usePlannerStore } from '@/stores/planner'
import { useAskStore } from '@/stores/ask'
import { useSessionStore } from '@/stores/session'
import { useSyncStore } from '@/stores/sync'
import { request } from '@/lib/api'
import { useImportSummary } from '@/composables/importSummary'
import { MARK_KINDS, MARK_SETS, isMarkSet, isWeekTitle, type MarkSet } from '@/lib/storage'
import { THEMES, type Theme } from '@/lib/theme'
import { APP_NAME } from '@/lib/app'
import { SETTINGS_TABS, settingsHref, type SettingsTab } from '@/lib/routes'
import { downloadExport, parseExport, type ExportData, type ParseError } from '@/lib/transfer'
import { Button } from '@/components/ui/button'
import { DayMarkDrawing } from '@/components/ui/day-mark'
import { InlineMessage } from '@/components/ui/inline-message'
import { RadioCard } from '@/components/ui/radio-card'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TextLink } from '@/components/ui/text-link'
import ConnectionsSection from '@/components/ConnectionsSection.vue'

/** The tabs' names (K119): the same words as their sections' headings. */
const TAB_NAMES: Record<SettingsTab, string> = {
  appearance: 'Appearance',
  'daily-goal': 'Daily goal',
  data: 'Your data',
  connections: 'Connections',
}

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

const store = usePlannerStore()
const ask = useAskStore()
const session = useSessionStore()
const sync = useSyncStore()
const heading = useTemplateRef<HTMLHeadingElement>('heading')
const headingId = useId()
const ids = {
  look: useId(),
  dailyGoal: useId(),
  data: useId(),
  connections: useId(),
}

// Arriving here moves focus to the page's heading, so a screen reader starts at the top.
onMounted(() => heading.value!.focus())

/**
 * The open tab (K119), which the address names. Choosing one writes its address in place of the
 * current one, so a reload keeps the tab and the browser's Back still leaves the page.
 */
const tab = defineModel<SettingsTab>('tab', { required: true })
const openTab = computed({
  get: () => tab.value,
  set: (value: string) => {
    const next = SETTINGS_TABS.find((t) => t === value)
    if (!next || next === tab.value) return
    tab.value = next
    history.replaceState(history.state, '', settingsHref(next))
  },
})

/** Daily goal (K85): the switch reads and sets the store's, which syncs with the account. */
const dailyGoal = computed({
  get: () => store.dailyGoal,
  set: (on: boolean) => store.setDailyGoal(on),
})
const dailyGoalHint = useId()

const fileInput = ref<HTMLInputElement | null>(null)
/** A parsed file waiting for "Import". */
const pending = ref<ExportData | null>(null)
const notice = ref<{ tone: 'error' | 'success' | 'info'; text: string } | null>(null)
const importing = ref(false)
const summary = useImportSummary()

const theme = computed({
  get: () => store.theme,
  set: (value: string) => store.setTheme(value as Theme),
})
/** Week title (K131): "Date" or "Week number" (John's words). It is saved with the account (K132). */
const WEEK_TITLE_OPTIONS = [
  { value: 'dates', label: 'Date' },
  { value: 'number', label: 'Week number' },
]
const weekTitle = computed({
  get: () => store.weekTitle,
  set: (value: string) => {
    if (isWeekTitle(value)) store.setWeekTitle(value)
  },
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
  const file = sync.exportFile()
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
</script>

<!--
  The Settings page (brand/design-system/project/components/SettingsPage), at #/settings, with no
  Header (K52): a link back to the week, the heading, then a tab per section (K119, the Tabs card):
  Appearance (Marks, then Theme, K59), Daily goal (K85), Your data and Connections
  (ConnectionsSection), each at #/settings/<tab>. My goals, Your limits and the account are on the
  Profile page (K106, K107). The daily targets are set in Edit plan (K56). Full width in rows like
  the week (K51): the open section's heading in the week's name column, its settings beside it,
  controls beside their words (K53). The tab bar's rule stands in for the row's top rule. Settings
  take effect at once; there is no Save.
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
      :id="headingId"
      ref="heading"
      tabindex="-1"
      class="title-1 mt-[calc(var(--u)*12)] mb-[calc(var(--u)*20)] text-(length:--fs-title) leading-tight text-ink focus:outline-none"
    >
      Settings
    </h1>

    <Tabs v-model="openTab">
      <TabsList :aria-labelledby="headingId" class="gap-x-[calc(var(--u)*32)]">
        <TabsTrigger
          v-for="t in SETTINGS_TABS"
          :key="t"
          :value="t"
          class="text-(length:--set-text) leading-[1.35]"
          :data-testid="`settings-tab-${t}`"
        >
          {{ TAB_NAMES[t] }}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="appearance">
        <section
          :aria-labelledby="ids.look"
          class="grid grid-cols-[var(--grid-name-w)_minmax(0,1fr)] items-start py-(--set-sec-y) folded:flex folded:flex-col folded:items-stretch folded:gap-4"
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
            <SegmentedControl
              v-model="weekTitle"
              label="Week title"
              :options="WEEK_TITLE_OPTIONS"
              data-testid="week-title-control"
            />
          </div>
        </section>
      </TabsContent>

      <TabsContent value="daily-goal">
        <section
          :aria-labelledby="ids.dailyGoal"
          class="grid grid-cols-[var(--grid-name-w)_minmax(0,1fr)] items-start py-(--set-sec-y) folded:flex folded:flex-col folded:items-stretch folded:gap-4"
        >
          <h2 :id="ids.dailyGoal" class="title-2 text-(length:--set-h2) leading-tight text-ink">
            Daily goal
          </h2>
          <!-- Daily goal (K85): the Switch with its hint under it. -->
          <div class="flex min-w-0 flex-col items-start gap-[calc(var(--u)*6)]">
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
        </section>
      </TabsContent>

      <TabsContent value="data">
        <section
          :aria-labelledby="ids.data"
          class="grid grid-cols-[var(--grid-name-w)_minmax(0,1fr)] items-start py-(--set-sec-y) folded:flex folded:flex-col folded:items-stretch folded:gap-4"
        >
          <h2 :id="ids.data" class="title-2 text-(length:--set-h2) leading-tight text-ink">
            Your data
          </h2>
          <div class="flex min-w-0 flex-col gap-(--set-gap)">
            <!-- The text, then its buttons beside it (K53). -->
            <div class="flex flex-wrap items-center gap-x-(--set-gap) gap-y-3">
              <p
                class="body max-w-[34ch] text-(length:--set-text) leading-normal text-ink-secondary"
              >
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
            <div
              v-if="pending"
              class="flex flex-col gap-2"
              role="group"
              aria-label="Confirm import"
            >
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
      </TabsContent>

      <TabsContent value="connections">
        <section
          :aria-labelledby="ids.connections"
          class="grid grid-cols-[var(--grid-name-w)_minmax(0,1fr)] items-start py-(--set-sec-y) folded:flex folded:flex-col folded:items-stretch folded:gap-4"
        >
          <h2 :id="ids.connections" class="title-2 text-(length:--set-h2) leading-tight text-ink">
            Connections
          </h2>
          <ConnectionsSection />
        </section>
      </TabsContent>
    </Tabs>
  </div>
</template>
