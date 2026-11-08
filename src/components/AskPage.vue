<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { ChevronLeft, PanelLeft, Send, Square, SquarePen } from '@lucide/vue'
import { ASK_COPY, askAgainNote, unsyncedNote } from '@/lib/ask'
import { useAskStore } from '@/stores/ask'
import { usePlannerStore } from '@/stores/planner'
import { useSyncStore } from '@/stores/sync'
import { readKey, writeKey } from '@/lib/storage'
import EmailStatus from '@/components/EmailStatus.vue'
import SyncStatus from '@/components/SyncStatus.vue'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { HistoryList } from '@/components/ui/history-list'
import { IconButton } from '@/components/ui/icon-button'
import { InlineMessage } from '@/components/ui/inline-message'
import { QuotaChip } from '@/components/ui/quota-chip'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { SidePanel } from '@/components/ui/side-panel'
import { TextArea } from '@/components/ui/text-area'
import { TextLink } from '@/components/ui/text-link'
import { Transcript, type TranscriptView } from '@/components/ui/transcript'

/** Questions to start from on an empty page (the mockup's). */
const STARTS = [
  'Am I doing too much or too little?',
  'Is my diet good enough?',
  'How steady was this month?',
] as const

const ask = useAskStore()
const planner = usePlannerStore()
const sync = useSyncStore()
const heading = useTemplateRef<HTMLHeadingElement>('heading')
const panel = useTemplateRef<InstanceType<typeof SidePanel>>('panel')
const panelOpen = ref(true)

/** The two views (K84): Document, the default, and Conversation; each device keeps its own. */
const VIEW_KEY = 'tracker-ask-view-v1'
const VIEWS = [
  { value: 'document', label: 'Document' },
  { value: 'conversation', label: 'Conversation' },
]
function storedView(): TranscriptView {
  try {
    return JSON.parse(readKey(VIEW_KEY) ?? 'null') === 'conversation' ? 'conversation' : 'document'
  } catch {
    return 'document'
  }
}
const view = ref<TranscriptView>(storedView())
watch(view, (value) => writeKey(VIEW_KEY, value))
/** The SegmentedControl's string, narrowed to a view. */
const viewChoice = computed({
  get: () => view.value,
  set: (value: string) => {
    view.value = value === 'conversation' ? 'conversation' : 'document'
  },
})

// The browser's own word on the connection, and Ask's: either one offline turns the box off.
const online = ref(navigator.onLine)
function onOnline(): void {
  online.value = true
  void ask.loadQuota()
  void ask.loadList()
}
function onOffline(): void {
  online.value = false
}

// Arriving here moves focus to the page's heading, so a screen reader starts at the top.
onMounted(() => {
  heading.value!.focus()
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  void ask.loadQuota()
  void ask.loadList()
})
onBeforeUnmount(() => {
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
})

const offline = computed(() => !online.value || ask.offline)
const answering = computed(() => ask.status === 'asking')
/** The box is off: offline, or no questions left today. */
const closed = computed(() => offline.value || ask.capped)
/**
 * Goals known to be empty, so answers can only compare with the times a week: read and empty, or
 * an account the server says has no settings at all (as the Settings row reads it).
 */
const noGoals = computed(
  () =>
    (planner.goalsKnown || (sync.fresh && planner.savedSettings() === null)) &&
    planner.goals === '',
)
const note = computed(() => {
  if (ask.capped) return askAgainNote(ask.openAt, planner.now)
  if (ask.unsynced > 0) return unsyncedNote(ask.unsynced)
  return ASK_COPY.note
})

/** Send: the store ignores it while an answer is being written. */
function submit(): void {
  void ask.ask()
}

/**
 * Return in the box sends, like Send; Shift+Return is a new line. A Return that picks an IME
 * candidate (`isComposing`) is the input method's, not ours. While an answer is being written,
 * Return does nothing, so the next question stays in the box.
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  if (!answering.value) submit()
}

/** The New conversation button in the list, where focus goes when nothing nearer is left. */
function newButton(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="history-list"] > button')
}
function bin(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-history-delete="${CSS.escape(id)}"]`)
}

function startNew(): void {
  ask.newConversation()
  panel.value?.close()
}

/** Picking a conversation closes the drawer on a phone (SidePanel card). */
function openConversation(id: string): void {
  panel.value?.close()
  void ask.open(id)
}

// Deleting asks first (HistoryList card): one, or all of them.
const deleting = ref<{ id: string; title: string } | 'all' | null>(null)
const confirmOpen = ref(false)
const deleteBusy = ref(false)
const deleteError = ref<string | undefined>(undefined)
/** Set once the delete went through: focus then moves on rather than back to the bin. */
let deleted = false
/** The bin after the one being deleted, chosen before the list changes. */
let nextBin: string | null = null

function askDelete(id: string): void {
  const item = ask.conversations.find((c) => c.id === id)!
  deleting.value = { id, title: item.title }
  deleteError.value = undefined
  deleted = false
  confirmOpen.value = true
}
function askDeleteAll(): void {
  deleting.value = 'all'
  deleteError.value = undefined
  deleted = false
  confirmOpen.value = true
}

const question = computed(() => {
  const target = deleting.value
  if (target === 'all') {
    return {
      title: 'Delete all conversations?',
      message:
        'Every question and answer in your history goes, on every device. This can’t be undone.',
      verb: 'Delete all',
    }
  }
  return {
    title: `Delete “${target?.title ?? ''}”?`,
    message: 'Its questions and answers go, on every device. This can’t be undone.',
    verb: 'Delete',
  }
})

async function confirmDelete(): Promise<void> {
  const target = deleting.value!
  nextBin = null
  if (target !== 'all') {
    const ids = ask.conversations.map((c) => c.id)
    nextBin = ids[ids.indexOf(target.id) + 1] ?? null
  }
  deleteBusy.value = true
  const problem = target === 'all' ? await ask.removeAll() : await ask.remove(target.id)
  deleteBusy.value = false
  if (problem) {
    deleteError.value = problem
    return
  }
  deleted = true
  confirmOpen.value = false
}

/**
 * Where focus goes once the question closes: Cancel goes back to the bin that asked (via its
 * `data-history-delete`); a delete moves on to the next conversation's bin, else to New
 * conversation. Cancel on Delete all goes back to that button, the one that asked.
 */
function deleteFocus(): HTMLElement | null {
  const target = deleting.value!
  if (!deleted) return target === 'all' ? null : bin(target.id)
  return nextBin ? bin(nextBin) : newButton()
}
</script>

<!--
  The Ask page (mockup 261101-ask-page: layout A, history S1, the chip always shown), at #/ask,
  with no Header (K52): the SidePanel with the HistoryList down the left, and the page beside it,
  each scrolling on its own. The page: Back to the week (with the panel's toggle beside it on a
  phone), the heading, the Transcript in rows like Settings, then the question box as the last
  row: "Ask" in the 240u question column, the TextArea and Send (Stop while answering) to its
  right, and under them the QuotaChip and one line of notes. data-slot="ask-page" gives its
  controls the Settings page's 60u sizes (main.css).
-->
<template>
  <div data-slot="ask-page" data-testid="ask-page" :data-view="view">
    <SidePanel ref="panel" v-model:open="panelOpen" storage-key="tracker-ask-panel-v1">
      <template #panel>
        <HistoryList
          :items="ask.conversations"
          :current-id="ask.conversationId ?? undefined"
          :now="planner.now"
          @open="openConversation"
          @new="startNew"
          @delete="askDelete"
          @delete-all="askDeleteAll"
        />
      </template>
      <template #strip>
        <IconButton label="New conversation" @click="startNew"><SquarePen /></IconButton>
      </template>
      <template #default="{ folded, open, panelId }">
        <!-- Conversation reads in one centred column, 760u wide (K84); Document uses the page. -->
        <div
          class="flex flex-col px-(--screen-pad-x) pt-[calc(var(--u)*28)] pb-[calc(var(--u)*64)] folded:pt-5"
          :class="
            view === 'conversation' &&
            'mx-auto w-full max-w-[calc(var(--u)*760+2*var(--screen-pad-x))] folded:max-w-none'
          "
        >
          <SyncStatus />
          <EmailStatus />
          <div class="flex items-center gap-1 self-start">
            <IconButton
              v-if="folded"
              label="Show history"
              :aria-expanded="open ? 'true' : 'false'"
              :aria-controls="panelId"
              class="-ml-2"
              data-testid="ask-panel-toggle"
              @click="panelOpen = true"
              ><PanelLeft
            /></IconButton>
            <TextLink
              href="#/"
              class="inline-flex items-center gap-1.5 text-(length:--set-text) [&_svg]:size-(--set-icon)"
              ><ChevronLeft :stroke-width="1.5" aria-hidden="true" />Back to the week</TextLink
            >
          </div>
          <!-- The title line: the heading, and the View switch at its end (K84). -->
          <div
            class="mt-[calc(var(--u)*12)] mb-[calc(var(--u)*28)] flex flex-wrap items-center justify-between gap-x-[calc(var(--u)*24)] gap-y-[calc(var(--u)*12)] folded:mb-5"
          >
            <h1
              ref="heading"
              tabindex="-1"
              class="title-1 text-(length:--fs-title) leading-tight text-ink focus:outline-none"
            >
              Ask
            </h1>
            <SegmentedControl
              v-model="viewChoice"
              ariaLabel="View"
              :options="VIEWS"
              data-testid="ask-view"
            />
          </div>

          <div
            v-if="ask.turns.length === 0"
            data-testid="ask-empty"
            class="grid max-w-[72ch] gap-[calc(var(--u)*16)] pb-[calc(var(--u)*28)] text-(length:--set-text)"
          >
            <p class="body text-(length:--set-text) leading-normal text-ink-secondary">
              Ask about your exercises and food: whether you’re doing enough for your goals, how
              steady the weeks are, what to change. The answer reads your plans and marks for the
              last eight weeks{{ noGoals ? '.' : ', and your goals in Settings.' }}
            </p>
            <p
              v-if="noGoals"
              class="body text-(length:--set-text) leading-normal text-ink-secondary"
            >
              Your goals in Settings are empty, so answers can only compare you with the times a
              week you set.
              <TextLink href="#/settings" class="font-semibold">Add your goals</TextLink>
            </p>
            <div class="flex flex-wrap gap-[calc(var(--u)*10)]">
              <Button
                v-for="start in STARTS"
                :key="start"
                data-ask-start
                :disabled="closed || answering"
                @click="ask.ask(start)"
                >{{ start }}</Button
              >
            </div>
          </div>

          <Transcript :turns="ask.turns" :view="view" @retry="ask.retry" />
          <InlineMessage
            v-if="offline"
            tone="info"
            data-testid="ask-offline"
            class="mb-[calc(var(--u)*28)]"
            >{{ ASK_COPY.offline }}</InlineMessage
          >
          <InlineMessage
            v-if="ask.notice"
            tone="info"
            data-testid="ask-notice"
            class="mb-[calc(var(--u)*28)]"
            >{{ ask.notice }}</InlineMessage
          >

          <!-- The question box, at the page's left edge with nothing beside it (K83). -->
          <form
            data-testid="ask-form"
            aria-label="Ask"
            class="border-t border-line pt-[calc(var(--u)*28)] folded:pt-5"
            @submit.prevent="submit"
          >
            <div
              class="grid max-w-[calc(var(--u)*900)] min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-[calc(var(--u)*12)] folded:grid-cols-[minmax(0,1fr)]"
            >
              <TextArea
                v-model="ask.draft"
                label="Your question"
                rows="3"
                data-testid="ask-question"
                :disabled="closed"
                @keydown="onKeydown"
              />
              <Button
                data-testid="ask-send"
                :type="answering ? 'button' : 'submit'"
                :variant="answering ? 'secondary' : 'primary'"
                :disabled="!answering && closed"
                @click="answering && ask.stop()"
              >
                <template v-if="answering"><Square :stroke-width="1.5" />Stop</template>
                <template v-else><Send :stroke-width="1.5" />Send</template>
              </Button>
              <div
                class="col-span-full flex flex-wrap items-center justify-between gap-x-[calc(var(--u)*16)] gap-y-[calc(var(--u)*8)]"
              >
                <QuotaChip
                  v-if="ask.remaining !== null && ask.limit !== null"
                  data-testid="ask-quota"
                  class="text-(length:--set-caption)"
                  :remaining="ask.remaining"
                  :limit="ask.limit"
                />
                <p
                  data-testid="ask-note"
                  class="caption text-(length:--set-caption) leading-[1.4] text-ink-secondary"
                >
                  {{ note }}
                </p>
              </div>
            </div>
          </form>
        </div>
      </template>
    </SidePanel>

    <ConfirmDialog
      v-model:open="confirmOpen"
      :title="question.title"
      :message="question.message"
      :confirm-label="question.verb"
      :busy="deleteBusy"
      :error="deleteError"
      :return-focus="deleteFocus"
      @confirm="confirmDelete"
    />
  </div>
</template>
