import { dateKey } from '@/lib/dates'
import { copyPlan } from '@/lib/plans'
import {
  cutText,
  isRecord,
  liftNotes,
  normaliseCardio,
  normaliseDetailsMap,
  normaliseExercise,
  normaliseFood,
  normaliseLog,
  normalisePlans,
  normalisePortableSettings,
  parseJson,
  type AskStop,
  type AskTurn,
  type Cardio,
  type Conversation,
  type Days,
  type DetailsMap,
  type Exercise,
  type ItemDetails,
  type Food,
  type Log,
  type Mark,
  type PortableSettings,
  type TrackedData,
} from '@/lib/storage'

/**
 * The export file: what Settings → Export downloads and Import… reads. It is also the contract for
 * the API's export and import, which is why the cases live in `fixtures/transfer/`.
 */
export const EXPORT_FORMAT = 'tracker-export'
/**
 * Files exported under the app's earlier names (Fitness Planner, and Exercise Planner before it)
 * carry these formats; they import as if current.
 */
export const OLD_EXPORT_FORMATS: readonly unknown[] = [
  'fitness-planner-export',
  'exercise-planner-export',
]
/**
 * Version 5 files carry each item's details (notes and fields) once per section, beside its plans
 * and log. Version 4 files may carry a note on an exercise or a food in a week's plan (K43); it
 * lifts into the item's details on import, the latest week's winning. Version 3 files carry a mark
 * per day with its drawing (`great`, `partial-solid`, `missed-hatch` … or null). Version 2 files
 * carry the kinds alone, which read as the zigzag; version 1 files a `true` per done day, which
 * reads as `great`. All five import. Settings may carry My goals (`goals`) with no new version,
 * as `foodPick` came: a reader from before them drops the key, and a file without them reads as
 * none. Ask's conversations (`conversations`), which only the API's export writes, came the same
 * way, and so did the `cardio` section (K90): a file without one reads as no cardio.
 */
export const EXPORT_VERSION = 5
/** The last version whose notes live in plan items. */
const LAST_ITEM_NOTES_VERSION = 4
const READ_VERSIONS: readonly unknown[] = [1, 2, 3, LAST_ITEM_NOTES_VERSION, EXPORT_VERSION]

/** One section of an export: its plans and log, and its items' details. */
export type SectionData<T> = TrackedData<T> & { details: DetailsMap }

/** Ask's history, in characters (code points, as Python counts them). */
export const MAX_TITLE = 80
export const MAX_QUESTION = 2000
export const MAX_ANSWER = 64_000
/** What one file may bring: conversations, and turns in each. The rest are dropped. */
export const MAX_CONVERSATIONS = 500
export const MAX_CONVERSATION_TURNS = 200
/** A conversation's id: URL-safe, as the API makes them, so it can sit in a path. */
const CONVERSATION_ID = /^[A-Za-z0-9_-]{1,64}$/
const STOPS: readonly unknown[] = ['end_turn', 'max_tokens', 'refused', 'error', 'cancelled']
/** The stops that keep their answer; any other turn's answer is ''. */
const ANSWERED: readonly AskStop[] = ['end_turn', 'max_tokens']

export type ExportData = {
  exercise: SectionData<Exercise>
  cardio: SectionData<Cardio>
  diet: SectionData<Food>
  /** Null when the file carries no settings. */
  settings: PortableSettings | null
  /** Present only when the file carries a list of them (the API's export does). */
  conversations?: Conversation[]
}

export type ExportFile = {
  format: typeof EXPORT_FORMAT
  version: typeof EXPORT_VERSION
  exportedAt: string
  exercise: SectionData<Exercise>
  cardio: SectionData<Cardio>
  diet: SectionData<Food>
  settings: PortableSettings
}

export type ParseError = 'json' | 'format' | 'version'

export type ParseResult = { ok: true; data: ExportData } | { ok: false; error: ParseError }

/** The theme is left out on purpose: it belongs to the device, not the person. */
export function buildExport(input: {
  exercise: SectionData<Exercise>
  cardio: SectionData<Cardio>
  diet: SectionData<Food>
  settings: PortableSettings
  now?: Date
}): ExportFile {
  const section = <T>({ plans, log, details }: SectionData<T>) => ({ plans, log, details })
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: (input.now ?? new Date()).toISOString(),
    exercise: section(input.exercise),
    cardio: section(input.cardio),
    diet: section(input.diet),
    // Normalised as the API's export writes them: the item pages' arrangement only when a type
    // has one (K66).
    settings: normalisePortableSettings(input.settings),
  }
}

/**
 * One section of a file. With `itemNotes` (a file of version 4 or older) the details come from the
 * plans' notes, and any `details` key is not read.
 */
function section<T extends object>(
  v: unknown,
  normalise: (item: unknown) => T | null,
  itemNotes: boolean,
): SectionData<T> {
  if (!isRecord(v)) return { plans: {}, log: {}, details: {} }
  return {
    plans: normalisePlans(v.plans, normalise),
    log: normaliseLog(v.log),
    details: itemNotes ? liftNotes(v.plans, normalise) : normaliseDetailsMap(v.details),
  }
}

/**
 * Read an export file. Anything that is not an object with the right `format` and `version` is
 * rejected whole; inside a valid file, fields are normalised the way stored data is.
 */
export function parseExport(text: string): ParseResult {
  // parseJson maps a syntax error to null, and so does the literal `null`; both are "not JSON".
  const parsed = parseJson(text)
  if (parsed === null) return { ok: false, error: 'json' }
  if (
    !isRecord(parsed) ||
    (parsed.format !== EXPORT_FORMAT && !OLD_EXPORT_FORMATS.includes(parsed.format))
  ) {
    return { ok: false, error: 'format' }
  }
  if (!READ_VERSIONS.includes(parsed.version)) {
    return { ok: false, error: 'version' }
  }
  const itemNotes = (parsed.version as number) <= LAST_ITEM_NOTES_VERSION
  const data: ExportData = {
    exercise: section(parsed.exercise, normaliseExercise, itemNotes),
    cardio: section(parsed.cardio, normaliseCardio, itemNotes),
    diet: section(parsed.diet, normaliseFood, itemNotes),
    settings: isRecord(parsed.settings) ? normalisePortableSettings(parsed.settings) : null,
  }
  // Conversations that aren't a list read as none, as in a file from before them.
  if (Array.isArray(parsed.conversations)) {
    data.conversations = normaliseConversations(parsed.conversations)
  }
  return { ok: true, data }
}

/** A time in Unix seconds: a whole number from 0 to the largest safe integer. */
function time(v: unknown): number | null {
  return Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : null
}

/**
 * A usable turn, or null: the question is trimmed and cut to MAX_QUESTION characters and must not
 * be blank; the answer must be a string, and is kept (trimmed, cut to MAX_ANSWER) only for a turn
 * that ended with one; the stop is one of the five; `askedAt` a time. Other keys are dropped, so
 * no tool call or thinking block is kept. The API's `normalise_turn` does the same.
 */
export function normaliseTurn(v: unknown): AskTurn | null {
  if (!isRecord(v)) return null
  const question = cutText(v.question, MAX_QUESTION)
  const askedAt = time(v.askedAt)
  if (!question || typeof v.answer !== 'string' || !STOPS.includes(v.stop) || askedAt === null) {
    return null
  }
  const stop = v.stop as AskStop
  const answer = ANSWERED.includes(stop) ? cutText(v.answer, MAX_ANSWER) : ''
  return { question, answer, stop, askedAt }
}

/**
 * A usable conversation, or null: a URL-safe id, a title that isn't blank (trimmed and cut to
 * MAX_TITLE), two times and a list of turns. Turns that fail drop out, and only the first
 * MAX_CONVERSATION_TURNS stay. The API's `normalise_conversation` does the same.
 */
export function normaliseConversation(v: unknown): Conversation | null {
  if (!isRecord(v) || typeof v.id !== 'string' || !CONVERSATION_ID.test(v.id)) return null
  const title = cutText(v.title, MAX_TITLE)
  const createdAt = time(v.createdAt)
  const updatedAt = time(v.updatedAt)
  if (!title || createdAt === null || updatedAt === null || !Array.isArray(v.turns)) return null
  const turns = v.turns
    .map(normaliseTurn)
    .filter((t): t is AskTurn => t !== null)
    .slice(0, MAX_CONVERSATION_TURNS)
  return { id: v.id, title, createdAt, updatedAt, turns }
}

/** A file's conversations: the valid ones, the first of each id, at most MAX_CONVERSATIONS. */
export function normaliseConversations(v: unknown[]): Conversation[] {
  const out: Conversation[] = []
  const seen = new Set<string>()
  for (const item of v) {
    const conversation = normaliseConversation(item)
    if (!conversation || seen.has(conversation.id)) continue
    seen.add(conversation.id)
    out.push(conversation)
    if (out.length === MAX_CONVERSATIONS) break
  }
  return out
}

/**
 * The account's conversations as they are, then the file's whose id isn't among them, in the
 * file's order and the first of each id: an import never changes a conversation it has. Returns
 * new objects; neither argument changes. The API's `merge_conversations` does the same.
 */
export function mergeConversations(
  existing: Conversation[],
  incoming: Conversation[],
): Conversation[] {
  const out = structuredClone(existing)
  const seen = new Set(existing.map((c) => c.id))
  for (const conversation of incoming) {
    if (seen.has(conversation.id)) continue
    seen.add(conversation.id)
    out.push(structuredClone(conversation))
  }
  return out
}

const NO_DAYS: readonly (Mark | null)[] = Array<Mark | null>(7).fill(null)

/**
 * Merge without deleting: a week that has a plan keeps it (an empty plan included), a week without
 * one takes the incoming plan, per week, item and day a marked day keeps its mark while an empty
 * one takes the file's, and an item with details keeps them whole while one without takes the
 * file's. Returns new objects; neither argument changes.
 */
export function mergeTracked<T extends object>(
  existing: SectionData<T>,
  incoming: SectionData<T>,
): SectionData<T> {
  const plans = { ...existing.plans }
  for (const [week, items] of Object.entries(incoming.plans)) {
    if (!(week in plans)) plans[week] = copyPlan(items)
  }
  const details: DetailsMap = JSON.parse(JSON.stringify(existing.details)) as DetailsMap
  for (const [id, doc] of Object.entries(incoming.details)) {
    if (!Object.hasOwn(details, id)) details[id] = JSON.parse(JSON.stringify(doc)) as ItemDetails
  }
  const log: Log = {}
  for (const week of new Set([...Object.keys(existing.log), ...Object.keys(incoming.log)])) {
    const mine = existing.log[week] ?? {}
    const theirs = incoming.log[week] ?? {}
    const out: Record<string, Days> = {}
    for (const id of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
      const a = mine[id] ?? NO_DAYS
      const b = theirs[id] ?? NO_DAYS
      out[id] = Array.from({ length: 7 }, (_, i) => a[i] ?? b[i] ?? null)
    }
    log[week] = out
  }
  return { plans, log, details }
}

/** What a merge would add: weeks that gain a plan, empty days that gain a mark, and items that
 * gain details. */
export function mergeSummary<T>(
  existing: SectionData<T>,
  incoming: SectionData<T>,
): { weeks: number; ticks: number; details: number } {
  const weeks = Object.keys(incoming.plans).filter((w) => !(w in existing.plans)).length
  let ticks = 0
  for (const [week, entries] of Object.entries(incoming.log)) {
    for (const [id, days] of Object.entries(entries)) {
      const mine = existing.log[week]?.[id] ?? NO_DAYS
      ticks += days.filter((m, i) => m !== null && mine[i] === null).length
    }
  }
  const details = Object.keys(incoming.details).filter(
    (id) => !Object.hasOwn(existing.details, id),
  ).length
  return { weeks, ticks, details }
}

/**
 * Saved settings win; the file's apply only where none are saved (`existing` null). The one
 * exception is My goals: the file's fill saved goals that are empty, and never replace ones that
 * aren't (F17). The API's `merge_settings` does the same.
 */
export function mergeSettings(
  existing: PortableSettings | null,
  incoming: PortableSettings | null,
): PortableSettings | null {
  if (!existing) return incoming
  if (!existing.goals && incoming?.goals) return { ...existing, goals: incoming.goals }
  return existing
}

export function exportFilename(now: Date): string {
  return `tracker-${dateKey(now)}.json`
}

/** Save the export through a temporary link; the browser names the file `exportFilename(now)`. */
export function downloadExport(file: ExportFile, now = new Date()): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = exportFilename(now)
  // Firefox ignores a click on a link that is not in the document.
  document.body.append(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
