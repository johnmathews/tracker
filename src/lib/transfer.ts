import { dateKey } from '@/lib/dates'
import { copyPlan } from '@/lib/plans'
import {
  cutText,
  isRecord,
  liftNotes,
  normaliseDetailsMap,
  normaliseLog,
  normalisePlans,
  normalisePortableSettings,
  parseJson,
  type AskStop,
  type AskTurn,
  type Conversation,
  type Days,
  type DetailsMap,
  type ItemDetails,
  type Log,
  type Mark,
  type PortableSettings,
  type TrackedData,
} from '@/lib/storage'
import {
  SECTIONS,
  SECTION_NAMES,
  TRACKER_TYPES,
  type Item,
  type TrackerTypeId,
} from '@/lib/trackerTypes'
import { inOrder, normaliseTrackers, type TrackerInfo } from '@/lib/trackers'

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
 * Version 6 files carry the account's trackers (K123), each tracker's plans and log under
 * `sections` and its items' details under `details`, both keyed by tracker id. Version 5 files
 * carry the first three trackers under fixed keys (`exercise`, `cardio`, `diet`), each with its
 * items' details (notes and fields) beside its plans and log. Version 4 files may carry a note on
 * an exercise or a food in a week's plan (K43); it lifts into the item's details on import, the
 * latest week's winning. Version 3 files carry a mark per day with its drawing (`great`,
 * `partial-solid`, `missed-hatch` … or null). Version 2 files carry the kinds alone, which read as
 * the zigzag; version 1 files a `true` per done day, which reads as `great`. All six import.
 * Settings may carry My goals (`goals`) with no new version, as `foodPick` came: a reader from
 * before them drops the key, and a file without them reads as none. Ask's conversations
 * (`conversations`), which only the API's export writes, came the same way, and so did the
 * `cardio` section (K90): a file without one reads as no cardio.
 */
export const EXPORT_VERSION = 6
/** The last version whose notes live in plan items. */
const LAST_ITEM_NOTES_VERSION = 4
/** The last version whose sections are the first three trackers' fixed keys. */
const LAST_FIXED_VERSION = 5
const READ_VERSIONS: readonly unknown[] = [
  1,
  2,
  3,
  LAST_ITEM_NOTES_VERSION,
  LAST_FIXED_VERSION,
  EXPORT_VERSION,
]

/** One tracker's data in a file: its plans and log, and its items' details. */
export type SectionData<T = Item> = TrackedData<T> & { details: DetailsMap }

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

/**
 * A file as read, whatever its version: its trackers (none before version 6) and each tracker's
 * data by id. The first three ids are always there, so a file from before version 6 maps onto them.
 */
export type ExportData = {
  trackers: TrackerInfo[]
  sections: Record<string, SectionData>
  /** Null when the file carries no settings. */
  settings: PortableSettings | null
  /** Present only when the file carries a list of them (the API's export does). */
  conversations?: Conversation[]
  /**
   * The programme library and the runs (programmes spec §11.2), present only when the file
   * carries a list of each. Passed through as the file has them: the server checks them on
   * import, and the app never reads them.
   */
  programmes?: unknown[]
  runs?: unknown[]
}

export type ExportFile = {
  format: typeof EXPORT_FORMAT
  version: typeof EXPORT_VERSION
  exportedAt: string
  trackers: TrackerInfo[]
  sections: Record<string, TrackedData<Item>>
  details: Record<string, DetailsMap>
  settings: PortableSettings
}

export type ParseError = 'json' | 'format' | 'version'

export type ParseResult = { ok: true; data: ExportData } | { ok: false; error: ParseError }

/** No plans, no log and no details. */
export function emptySection<T = Item>(): SectionData<T> {
  return { plans: {}, log: {}, details: {} }
}

/**
 * The file for the account's trackers, in the week's order, and each tracker's data. The theme is
 * left out on purpose: it belongs to the device, not the person.
 */
export function buildExport(input: {
  trackers: readonly TrackerInfo[]
  sections: Readonly<Record<string, SectionData>>
  settings: PortableSettings
  now?: Date
}): ExportFile {
  const trackers = inOrder(input.trackers).map(
    ({ id, name, kind, position, dailyTarget, startWeek, endWeek }): TrackerInfo => ({
      id,
      name,
      kind,
      position,
      dailyTarget,
      startWeek,
      endWeek,
    }),
  )
  const sections: Record<string, TrackedData<Item>> = {}
  const details: Record<string, DetailsMap> = {}
  for (const { id } of trackers) {
    const data = Object.hasOwn(input.sections, id) ? input.sections[id]! : emptySection()
    sections[id] = { plans: data.plans, log: data.log }
    details[id] = data.details
  }
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: (input.now ?? new Date()).toISOString(),
    trackers,
    sections,
    details,
    // Normalised as the API's export writes them: the item pages' arrangement only when a type
    // has one (K66).
    settings: normalisePortableSettings(input.settings),
  }
}

/** `v[key]` when `v` is an object that has it as its own; undefined otherwise. */
function own(v: unknown, key: string): unknown {
  return isRecord(v) && Object.hasOwn(v, key) ? v[key] : undefined
}

/**
 * One of the first three trackers' sections in a file of version 5 or older. With `itemNotes` (a
 * file of version 4 or older) the details come from the plans' notes, and any `details` key is
 * not read.
 */
function fixedSection(v: unknown, kind: TrackerTypeId, itemNotes: boolean): SectionData {
  if (!isRecord(v)) return emptySection()
  const { normalise } = TRACKER_TYPES[kind]
  return {
    plans: normalisePlans(v.plans, normalise),
    log: normaliseLog(v.log),
    details: itemNotes ? liftNotes(v.plans, normalise) : normaliseDetailsMap(v.details),
  }
}

/** One tracker's data in a version 6 file: its section and its details, read apart. */
function trackerSection(kind: TrackerTypeId, v: unknown, details: unknown): SectionData {
  return {
    plans: normalisePlans(own(v, 'plans'), TRACKER_TYPES[kind].normalise),
    log: normaliseLog(own(v, 'log')),
    details: normaliseDetailsMap(details),
  }
}

/**
 * Read an export file. Anything that is not an object with the right `format` and `version` is
 * rejected whole; inside a valid file, fields are normalised the way stored data is. A file from
 * before version 6 maps its fixed keys onto the first three trackers' ids. A version 6 file's data
 * is read for the first three ids and for each of its trackers, by that tracker's kind; data under
 * any other id is dropped. As the API's `parse_export`.
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
  const version = parsed.version as number
  const data: ExportData = { trackers: [], sections: {}, settings: null }
  if (version <= LAST_FIXED_VERSION) {
    const itemNotes = version <= LAST_ITEM_NOTES_VERSION
    for (const id of SECTION_NAMES) {
      data.sections[id] = fixedSection(parsed[id], SECTIONS[id].id, itemNotes)
    }
  } else {
    data.trackers = normaliseTrackers(parsed.trackers)
    const kinds = new Map<string, TrackerTypeId>(SECTION_NAMES.map((id) => [id, SECTIONS[id].id]))
    for (const t of data.trackers) kinds.set(t.id, t.kind)
    for (const [id, kind] of kinds) {
      data.sections[id] = trackerSection(kind, own(parsed.sections, id), own(parsed.details, id))
    }
  }
  data.settings = isRecord(parsed.settings) ? normalisePortableSettings(parsed.settings) : null
  // Conversations that aren't a list read as none, as in a file from before them.
  if (Array.isArray(parsed.conversations)) {
    data.conversations = normaliseConversations(parsed.conversations)
  }
  // The library and the runs likewise, kept as they are: the server's import checks them.
  if (Array.isArray(parsed.programmes)) data.programmes = parsed.programmes
  if (Array.isArray(parsed.runs)) data.runs = parsed.runs
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
 * Saved settings win; the file's apply only where none are saved (`existing` null). The
 * exceptions are My goals and Your limits: the file's fill saved ones that are empty, and never
 * replace ones that aren't (F17, K107). The API's `merge_settings` does the same.
 */
export function mergeSettings(
  existing: PortableSettings | null,
  incoming: PortableSettings | null,
): PortableSettings | null {
  if (!existing) return incoming
  let merged = existing
  if (!existing.goals && incoming?.goals) merged = { ...merged, goals: incoming.goals }
  if (!existing.limits && incoming?.limits) merged = { ...merged, limits: incoming.limits }
  return merged
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
