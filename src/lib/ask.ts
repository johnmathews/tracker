import type { HistoryItem } from '@/components/ui/history-list'
import type { TranscriptTurn } from '@/components/ui/transcript'
import { isRecord, type AskTurn } from '@/lib/storage'
import { countOf } from '@/lib/words'

/**
 * The Ask page's words (mockup `261101-ask-page`, voice.md): what happened, then what to do. The
 * page's other states read them from here, so the store and the page say the same thing.
 */
export const ASK_COPY = {
  /** Under the box while asking is open. */
  note: 'Answers come from an AI and can be wrong. They aren’t medical advice.',
  offline: 'You’re offline. Asking needs a connection; your marks are saved on this device.',
  /** `done.saved` false: the account is at its quota (docs/api.md §3.2). */
  notSaved: 'Your account is full, so this answer wasn’t saved.',
  /** The conversation went (deleted in another tab or on another device) before it was used. */
  gone: 'That conversation was deleted, so this is a new one.',
  openFailed: 'That conversation couldn’t be opened. Try again when you’re online.',
  /** The person pressed Stop. */
  stopped: 'You stopped this answer.',
  /** A kept turn whose answer was cut off: Stop, or the page closed while it was written. */
  cancelled: 'This answer stopped before it finished.',
  busy: 'The answer stopped before it finished, because the AI service didn’t respond. Your question is kept.',
  failed:
    'The answer stopped before it finished, because of a problem on the server. Your question is kept.',
  /** The stream ended or went quiet with no `done` or `error`, as a proxy's cut does (W5 C3). */
  cut: 'The answer stopped before it finished, because the connection was lost. Your question is kept.',
  /** A kept turn that failed: the history doesn't say why. */
  failedEarlier: 'The answer stopped before it finished. Your question is kept.',
  refused: 'The AI didn’t answer this question. Try asking it another way.',
  long: 'The answer ran long and was cut short. Ask a follow-up for the rest.',
  server: 'The server had a problem, so the question wasn’t asked. Try again in a while.',
  rejected: 'The server refused the question, so it wasn’t asked.',
  deleteOffline: 'Can’t reach the server, so nothing was deleted. Try again when you’re online.',
  deleteFailed: 'The server had a problem, so nothing was deleted. Try again in a while.',
} as const

/** "09:14", in the browser's time. */
function clock(d: Date): string {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/**
 * The line under the box when no questions are left: when asking opens again, from the 429's
 * `retryAfter` (`openAt`, in ms). `GET /api/ask` gives only the count, so with none left before
 * any refusal the time isn't known, and the line says the most it can: the cap is a rolling day.
 */
export function askAgainNote(openAt: number | null, now: Date): string {
  if (openAt === null) return 'You can ask again within 24 hours.'
  const at = new Date(openAt)
  const day = at.toDateString() === now.toDateString() ? 'today' : 'tomorrow'
  return `You can ask again from ${clock(at)} ${day}.`
}

/** The line under the box when changes on this device hadn't reached the server (F11). */
export function unsyncedNote(n: number): string {
  const one = n === 1
  return `${countOf(n, 'change', true)} on this device ${one ? 'isn’t' : 'aren’t'} synced yet, so the answer won’t include ${one ? 'it' : 'them'}.`
}

/** A kept turn from the history (docs/api.md §3.2), as the Transcript draws it. */
export function savedTurn(turn: AskTurn, id: number): TranscriptTurn {
  const base = { id, question: turn.question, answer: turn.answer }
  switch (turn.stop) {
    case 'end_turn':
      return { ...base, state: 'done' }
    case 'max_tokens':
      return { ...base, state: 'stopped', message: ASK_COPY.long }
    case 'refused':
      return { ...base, state: 'stopped', message: ASK_COPY.refused }
    case 'cancelled':
      return { ...base, state: 'stopped', message: ASK_COPY.cancelled }
    default:
      return { ...base, state: 'error', message: ASK_COPY.failedEarlier }
  }
}

/** `GET /api/ask/conversations`' list as the HistoryList takes it; a malformed item drops out. */
export function historyItems(v: unknown): HistoryItem[] {
  if (!Array.isArray(v)) return []
  return v
    .filter(
      (c): c is HistoryItem =>
        isRecord(c) &&
        typeof c.id === 'string' &&
        typeof c.title === 'string' &&
        typeof c.updatedAt === 'number',
    )
    .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
}
