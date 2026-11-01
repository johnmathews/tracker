import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { HistoryItem } from '@/components/ui/history-list'
import type { TranscriptTurn } from '@/components/ui/transcript'
import { request, stream, type ApiError, type StreamEvent } from '@/lib/api'
import { ASK_COPY, historyItems, savedTurn } from '@/lib/ask'
import { dateKey } from '@/lib/dates'
import { normaliseConversation } from '@/lib/transfer'
import { useSessionStore } from '@/stores/session'
import { useSyncStore } from '@/stores/sync'

/**
 * The Ask page's state (docs/architecture.md §3): the open conversation's turns, whether an
 * answer is being written, the questions left today, and the account's past conversations. The
 * history lives on the server (docs/api.md §3.2); nothing of a conversation is kept in the
 * browser's storage, and everything here goes on sign-out or when another user signs in.
 */
export const useAskStore = defineStore('ask', () => {
  const session = useSessionStore()
  const sync = useSyncStore()

  /** The open conversation, as the Transcript draws it. */
  const turns = ref<TranscriptTurn[]>([])
  /** The open conversation's id; null for a new one, until the server names it. */
  const conversationId = ref<string | null>(null)
  const status = ref<'idle' | 'asking'>('idle')
  /** The question box's words, kept while the person is on another page. */
  const draft = ref('')
  /** Questions left today and the day's cap, from the server; null until it has said. */
  const remaining = ref<number | null>(null)
  const limit = ref<number | null>(null)
  /** When asking opens again (ms), from the last 429; null when not known. */
  const openAt = ref<number | null>(null)
  const conversations = ref<HistoryItem[]>([])
  /** Changes still on this device when the last question went, so its answer misses them (F11). */
  const unsynced = ref(0)
  /** The last call to Ask couldn't reach the server. */
  const offline = ref(false)
  /** One line about the conversation as a whole: not kept, or gone. */
  const notice = ref<string | null>(null)

  const capped = computed(() => remaining.value === 0)

  /** Bumped whenever the page changes conversation or user, so replies to the old one are dropped. */
  let generation = 0
  let stopper: AbortController | null = null
  let ids = 0

  const headers = () => ({ 'X-Expected-User': session.user ?? '' })

  /** A failed call's side effects: offline, the session gone, or Ask turned off. */
  function failed(error: ApiError): void {
    if (error.kind === 'offline') offline.value = true
    // Reading the state hears the 401 too, and signs out as every other ended session does.
    else if (error.kind === 'auth') void sync.refresh()
    else if (error.kind === 'refused' && error.code === 'ask-off') session.askOff()
  }

  /** The page shows a new, empty conversation; an answer still streaming stops. */
  function reset(): void {
    generation++
    stopper?.abort()
    stopper = null
    status.value = 'idle'
    turns.value = []
    conversationId.value = null
    unsynced.value = 0
    notice.value = null
  }

  /** Everything goes: on sign-out, and when another user signs in. */
  function clear(): void {
    reset()
    draft.value = ''
    remaining.value = null
    limit.value = null
    openAt.value = null
    conversations.value = []
    offline.value = false
  }

  watch(
    () => [session.user, session.status] as const,
    ([user, status], [before]) => {
      if (status !== 'signed-in' || user !== before) clear()
    },
    { flush: 'sync' },
  )

  async function loadQuota(): Promise<void> {
    const res = await request<{ remaining: number; limit: number }>(
      'GET',
      '/ask',
      undefined,
      headers(),
    )
    if (!res.ok) return failed(res.error)
    offline.value = false
    remaining.value = res.data.remaining
    limit.value = res.data.limit
    if (res.data.remaining > 0) openAt.value = null
  }

  async function loadList(): Promise<void> {
    const res = await request<{ conversations: unknown }>(
      'GET',
      '/ask/conversations',
      undefined,
      headers(),
    )
    if (!res.ok) return failed(res.error)
    offline.value = false
    conversations.value = historyItems(res.data.conversations)
  }

  function drop(id: string): void {
    conversations.value = conversations.value.filter((c) => c.id !== id)
  }

  function newConversation(): void {
    reset()
  }

  /** Show a past conversation; one that has gone leaves the list. */
  async function open(id: string): Promise<void> {
    reset()
    conversationId.value = id
    const gen = generation
    const res = await request<unknown>(
      'GET',
      `/ask/conversations/${encodeURIComponent(id)}`,
      undefined,
      headers(),
    )
    if (gen !== generation) return
    if (res.ok) offline.value = false
    const found = res.ok ? normaliseConversation(res.data) : null
    if (found) {
      turns.value = found.turns.map((t) => savedTurn(t, ++ids))
      return
    }
    conversationId.value = null
    if (!res.ok && res.error.kind === 'refused' && res.error.status === 404) {
      drop(id)
      notice.value = ASK_COPY.gone
      return
    }
    if (!res.ok) failed(res.error)
    notice.value = ASK_COPY.openFailed
  }

  /** Paint once per frame however fast the deltas come (F19). */
  function frame(paint: () => void): number {
    return requestAnimationFrame(paint)
  }

  /**
   * Ask `text`, or the box's words (which then leave the box). Changes waiting on this device go
   * first (F11), and the date is the browser's (F15). The answer streams into a new turn. A
   * question the server never took (no questions left, Ask off, offline, a conversation gone)
   * goes back in the box.
   */
  async function ask(text?: string): Promise<void> {
    const question = (text ?? draft.value).trim()
    if (!question || status.value === 'asking') return
    const gen = generation
    status.value = 'asking'
    notice.value = null
    if (text === undefined) draft.value = ''
    const putBack = () => {
      turns.value = turns.value.filter((t) => t !== live)
      if (text === undefined) draft.value = question
    }
    await sync.flush()
    if (gen !== generation) return
    unsynced.value = sync.pending
    const fresh = conversationId.value === null
    turns.value.push({ id: ++ids, question, answer: '', state: 'streaming' })
    const live = turns.value.at(-1)!
    const stopping = new AbortController()
    stopper = stopping
    let text_ = ''
    let painting = 0
    let heard = false
    const paint = () => {
      painting = 0
      live.answer = text_
    }
    const settle = (answer: string, state: TranscriptTurn['state'], message?: string) => {
      cancelAnimationFrame(painting)
      live.answer = answer
      live.state = state
      if (message) live.message = message
    }
    // A reset aborts the stream, and `stream` reads nothing after an abort, so every event here
    // belongs to this question.
    const onEvent = ({ event, data }: StreamEvent) => {
      heard = true
      if (event === 'start') {
        if (typeof data.remaining === 'number') remaining.value = data.remaining
        if (fresh && typeof data.conversation === 'string') conversationId.value = data.conversation
      } else if (event === 'text' && typeof data.delta === 'string') {
        text_ += data.delta
        painting ||= frame(paint)
      } else if (event === 'done') {
        // The text before a refusal is partial, and is discarded (docs/api.md §3.2).
        if (data.stop === 'refused') settle('', 'stopped', ASK_COPY.refused)
        else if (data.stop === 'max_tokens') settle(text_, 'stopped', ASK_COPY.long)
        else settle(text_, 'done')
        if (data.saved === false) {
          notice.value = ASK_COPY.notSaved
          // A new conversation whose first turn wasn't kept wasn't kept either.
          if (fresh) conversationId.value = null
        }
      } else if (event === 'error') {
        settle(text_, 'error', data.error === 'busy' ? ASK_COPY.busy : ASK_COPY.failed)
      }
    }
    const body = {
      question,
      today: dateKey(new Date()),
      ...(fresh ? {} : { conversation: conversationId.value }),
    }
    const result = await stream('/ask', body, onEvent, {
      signal: stopping.signal,
      headers: headers(),
    })
    if (gen !== generation) return
    stopper = null
    status.value = 'idle'
    if (result.ok) offline.value = false
    else {
      const { error } = result
      if (error.kind === 'stopped') settle(text_, 'stopped', ASK_COPY.stopped)
      else if (error.kind === 'cut') settle(text_, 'error', ASK_COPY.cut)
      else if (error.kind === 'server') settle('', 'error', ASK_COPY.server)
      else if (error.kind === 'refused' && error.status === 429) {
        putBack()
        remaining.value = 0
        openAt.value = error.retryAfter === undefined ? null : Date.now() + error.retryAfter * 1000
      } else if (error.kind === 'refused' && error.status === 404) {
        drop(conversationId.value!)
        reset()
        if (text === undefined) draft.value = question
        notice.value = ASK_COPY.gone
      } else if (error.kind === 'refused' && error.code !== 'ask-off') {
        settle('', 'error', ASK_COPY.rejected)
      } else {
        // Offline, signed out or Ask off: the question never reached Claude.
        putBack()
        failed(error)
      }
    }
    // The history gains the new conversation, or moves this one to the top.
    if (heard) await loadList()
  }

  /** Stop the answer being written; what arrived stays. */
  function stop(): void {
    stopper?.abort()
  }

  /** Try again: ask a failed turn's question once more, in its place. */
  async function retry(index: number): Promise<void> {
    const failedTurn = turns.value[index]
    if (!failedTurn || status.value === 'asking') return
    turns.value.splice(index, 1)
    await ask(failedTurn.question)
  }

  function deleteProblem(error: ApiError): string {
    failed(error)
    return error.kind === 'offline' ? ASK_COPY.deleteOffline : ASK_COPY.deleteFailed
  }

  /** Delete one conversation; null when it is gone, else what to tell the person. */
  async function remove(id: string): Promise<string | null> {
    const res = await request(
      'DELETE',
      `/ask/conversations/${encodeURIComponent(id)}`,
      undefined,
      headers(),
    )
    // Already gone elsewhere: the list just catches up.
    if (!res.ok && !(res.error.kind === 'refused' && res.error.status === 404)) {
      return deleteProblem(res.error)
    }
    drop(id)
    if (conversationId.value === id) reset()
    return null
  }

  /** Delete every conversation of the account; null when done, else what to tell the person. */
  async function removeAll(): Promise<string | null> {
    const res = await request('DELETE', '/ask/conversations', undefined, headers())
    if (!res.ok) return deleteProblem(res.error)
    conversations.value = []
    reset()
    return null
  }

  return {
    turns,
    conversationId,
    status,
    draft,
    remaining,
    limit,
    openAt,
    conversations,
    unsynced,
    offline,
    notice,
    capped,
    loadQuota,
    loadList,
    newConversation,
    open,
    ask,
    stop,
    retry,
    remove,
    removeAll,
    clear,
  }
})
