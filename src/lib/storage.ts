import { isTheme, type Theme } from '@/lib/theme'
import type { Plans } from '@/lib/plans'
import { normaliseItemSections, type ItemSections } from '@/lib/itemSections'

export type Exercise = {
  id: string
  name: string
  /** Sets per session; absent when not set. */
  sets?: number
  /** Reps per set; 0 for a timed exercise, which has a `duration` instead. */
  reps: number
  /** Seconds per set for a timed exercise (a plank); absent when it counts reps. */
  duration?: number
  perSide?: boolean
  /** Load in kg (e.g. a 12 kg kettlebell); absent for bodyweight exercises. */
  weight?: number
  /** Weekly goal in days, 0–7. */
  target: number
}

export type Food = {
  id: string
  name: string
  /** Weekly goal in days, 0–7. */
  target: number
}

/**
 * An item's details (D2): its notes in markdown (K43) and its text fields by key, one copy for
 * every week. A key is left out when blank, so `{}` is an item with none. The type's field list
 * (src/lib/trackerTypes.ts) names the fields the app shows; other keys are kept, so changing the
 * list never loses text.
 */
export type ItemDetails = { notes?: string; fields?: Record<string, string> }

/** A section's details by item id; an item with none is left out. */
export type DetailsMap = Record<string, ItemDetails>

/**
 * How a marked day went (DayMark card): done well, done in part, or tried and couldn't. Every kind
 * counts towards the week. Foods only ever take `great`.
 */
export type MarkKind = 'great' | 'partial' | 'missed'
export const MARK_KINDS: readonly MarkKind[] = ['great', 'partial', 'missed']

/** The three marker drawings a box can be filled with, traced from the owner's own (K17). */
export type Drawing = 'zigzag' | 'solid' | 'hatch'
export const DRAWINGS: readonly Drawing[] = ['zigzag', 'solid', 'hatch']

/**
 * A marked day: its kind, and the drawing a press chose for it. The zigzag is the plain kind
 * (`great`), as every mark stored before drawings reads; the others add theirs (`great-solid`,
 * `missed-hatch`). An empty day is `null`.
 */
export type Mark = MarkKind | `${MarkKind}-${Exclude<Drawing, 'zigzag'>}`
/** Every mark, drawing first: the zigzag's three kinds, then the solid's, then the hatch's. */
export const MARKS: readonly Mark[] = DRAWINGS.flatMap((drawing) =>
  MARK_KINDS.map((kind): Mark => (drawing === 'zigzag' ? kind : `${kind}-${drawing}`)),
)

export function markKind(mark: Mark): MarkKind {
  return mark.split('-')[0] as MarkKind
}

export function markDrawing(mark: Mark): Drawing {
  return (mark.split('-')[1] ?? 'zigzag') as Drawing
}

/**
 * How the marks are drawn (DayMark card, K20): the squiggles (each mark's own drawing), or one
 * symbol per kind, stroked or stamped: a tick, a circle and a cross, or a happy, so-so and sad
 * face. The device's choice, like the theme; it never changes a stored mark (K21).
 */
export const MARK_SETS = ['squiggles', 'ticks', 'stamped-ticks', 'faces', 'stamped-faces'] as const
export type MarkSet = (typeof MARK_SETS)[number]

export function isMarkSet(value: unknown): value is MarkSet {
  return MARK_SETS.includes(value as MarkSet)
}

/** One item's week: a mark or `null` for each day, Monday first. */
export type Days = (Mark | null)[]

/** Week Monday `YYYY-MM-DD` → item id → its days Mon–Sun. */
export type Log = Record<string, Record<string, Days>>

export type PlannerData = { plans: Plans<Exercise>; log: Log }

export type DietData = { plans: Plans<Food>; log: Log }

/**
 * How an Ask turn ended (docs/api.md §3.2): with an answer (`end_turn`, or `max_tokens` cut
 * short), or without one, keeping only its question.
 */
export type AskStop = 'end_turn' | 'max_tokens' | 'refused' | 'error' | 'cancelled'

/** One question in an Ask conversation and its answer, text only. Times are Unix seconds. */
export type AskTurn = { question: string; answer: string; stop: AskStop; askedAt: number }

/** An Ask conversation as the API keeps it and exports it; keys camelCase, as the rest of the API's. */
export type Conversation = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  turns: AskTurn[]
}

export type Settings = {
  accent: string
  dailyPick: number
  /** Foods a day (K57): a day whose food marks reach it turns green. */
  foodPick: number
  /**
   * Daily goal (K85): whether the daily picks apply at all. Off, Edit plan has no steppers, no
   * day turns green, and Ask and the AI connections get no daily target; the picks are kept.
   */
  dailyGoal: boolean
  /** My goals: the person's own words about what they are aiming for; only Ask reads them. */
  goals: string
  theme: Theme
  /** How marked days are drawn; the device's choice. */
  markSet: MarkSet
}

/** Exercise plans per week plus the log: `{ plans, log }`. */
export const DATA_KEY = 'tracker-v2'
/** Food plans per week plus the diet log. */
export const DIET_KEY = 'tracker-diet-v2'
export const SETTINGS_KEY = 'tracker-settings-v1'
/**
 * The earlier single-list format (`{ exercises, log }` and `{ foods, log }`; the exercise one is the
 * design prototype's, under its old `exercise-planner-v1` name). Read to migrate when v2 data is
 * missing or unreadable; never written or deleted, apart from `migrateKeyPrefix` moving it.
 */
export const LEGACY_DATA_KEY = 'tracker-v1'
export const LEGACY_DIET_KEY = 'tracker-diet-v1'

export const MIN_TARGET = 0
export const MAX_TARGET = 7
export const MIN_DAILY_PICK = 1
export const MAX_DAILY_PICK = 8
export const NEW_EXERCISE_TARGET = 3
export const MAX_WEIGHT = 500
export const MAX_SETS = 20
export const MAX_DURATION = 3600
export const NEW_FOOD_TARGET = 3
/**
 * A plan item's note's length, in characters (code points, as Python counts them): the notes an
 * export of version 4 or a `-v3` cache carries in its plans (K43), which lift into details.
 */
export const MAX_NOTES = 500
/** My goals' length, in characters (code points, as Python counts them). */
export const MAX_GOALS = 1000
/** An item's details: its notes in code points, each field's text in code points, how many fields,
 * and the whole document as the API stores it (compact JSON, UTF-8) in bytes. As the API's. */
export const MAX_DETAILS_NOTES = 20_000
/** A notes field shows its count from here, near the limit (TextArea card; ItemPage card). */
export const NOTES_COUNT_FROM = 19_000
export const MAX_FIELD = 500
export const MAX_FIELDS = 32
export const MAX_DETAILS_BYTES = 32 * 1024
/** An item's id, in characters: the bounds of the API's ticks and details paths. */
export const MAX_ITEM_ID = 128
/** A details field's key: lower case, a letter first, at most 32 characters. */
const FIELD_KEY = /^[a-z][a-z0-9_]{0,31}$/
const WEEK_KEY = /^\d{4}-\d{2}-\d{2}$/

export const DEFAULT_SETTINGS: Settings = {
  accent: '#30d158',
  dailyPick: 3,
  foodPick: 2,
  dailyGoal: true,
  goals: '',
  theme: 'system',
  markSet: 'squiggles',
}

export function defaultExercises(): Exercise[] {
  return [
    { id: 'pu', name: 'Push-ups', reps: 10, target: 4 },
    { id: 'pl', name: 'Pull-ups', reps: 3, target: 4 },
    { id: 'sq', name: 'Squats', reps: 15, target: 4 },
    { id: 'be', name: 'Back extensions', reps: 12, target: 3 },
    { id: 'kh', name: 'Kettlebell halos', reps: 8, perSide: true, target: 3 },
  ]
}

export function defaultFoods(): Food[] {
  return [
    { id: 'veg', name: 'Vegetables', target: 7 },
    { id: 'fruit', name: 'Fruit', target: 5 },
    { id: 'fish', name: 'Fish', target: 2 },
    { id: 'nuts', name: 'Nuts', target: 3 },
  ]
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function toInt(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback
}

export function parseJson(raw: string | null): unknown {
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** A usable weight in kg, rounded to 2 decimals and capped; `undefined` means "no weight". */
export function normaliseWeight(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  // Round before the sign check, so a tiny value like 0.004 can't come out as 0.
  const kg = Math.round(v * 100) / 100
  return kg > 0 ? Math.min(MAX_WEIGHT, kg) : undefined
}

/** Spaces, tabs and line breaks off both ends, as Python's `strip(" \t\n\r")`. */
function trimBlank(s: string): string {
  return s.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, '')
}

/** A string's length in code points, as Python counts it. */
export function codePoints(s: string): number {
  let n = 0
  for (const _ of s) n++
  return n
}

/**
 * A usable text: a string with spaces, tabs and line breaks trimmed from its ends, cut to `limit`
 * code points and trimmed again; undefined for anything else or for nothing left. The API's
 * `normalise_text` does the same (the shared fixtures hold both to it).
 */
export function normaliseText(v: unknown, limit: number): string | undefined {
  if (typeof v !== 'string') return undefined
  return trimBlank(Array.from(trimBlank(v)).slice(0, limit).join('')) || undefined
}

/** A plan item's note from a version 4 export or a `-v3` cache (K43), cut to MAX_NOTES. */
export function normaliseNotes(v: unknown): string | undefined {
  return normaliseText(v, MAX_NOTES)
}

/**
 * My goals: text cut to MAX_GOALS characters; '' for anything that isn't a string or for nothing
 * left. The API's `normalise_goals` does the same.
 */
export function normaliseGoals(v: unknown): string {
  return cutText(v, MAX_GOALS)
}

/** `normaliseText`, but '' rather than undefined for nothing usable: Ask's titles and turns. */
export function cutText(v: unknown, max: number): string {
  return normaliseText(v, max) ?? ''
}

/**
 * Text fields: keys matching FIELD_KEY, any of them (D2), with text cut to MAX_FIELD code points;
 * blanks drop out, and the first MAX_FIELDS that remain are kept. As the API's `normalise_fields`.
 */
export function normaliseFields(v: unknown): Record<string, string> {
  const fields: Record<string, string> = {}
  if (!isRecord(v)) return fields
  let kept = 0
  for (const [key, raw] of Object.entries(v)) {
    if (kept === MAX_FIELDS) break
    const text = normaliseText(raw, MAX_FIELD)
    if (text !== undefined && FIELD_KEY.test(key)) {
      fields[key] = text
      kept++
    }
  }
  return fields
}

/**
 * An item's details document, or null when `v` is not an object. Blank notes and an empty `fields`
 * are left out, so an item with no details is `{}`; other keys are dropped. The size cap is
 * separate (`detailsFit`): normalising never refuses. As the API's `normalise_details`.
 */
export function normaliseDetails(v: unknown): ItemDetails | null {
  if (!isRecord(v)) return null
  const out: ItemDetails = {}
  const notes = normaliseText(v.notes, MAX_DETAILS_NOTES)
  if (notes !== undefined) out.notes = notes
  const fields = normaliseFields(v.fields)
  if (Object.keys(fields).length) out.fields = fields
  return out
}

/** Whether a document is within MAX_DETAILS_BYTES as the API stores it (compact UTF-8 JSON). */
export function detailsFit(details: ItemDetails): boolean {
  return new TextEncoder().encode(JSON.stringify(details)).length <= MAX_DETAILS_BYTES
}

export function isEmptyDetails(details: ItemDetails | undefined): boolean {
  return !details || (details.notes === undefined && details.fields === undefined)
}

/**
 * An id the API's ticks and details paths can name: 1 to MAX_ITEM_ID characters, and never
 * `__proto__` (assigning it would set an object's prototype instead).
 */
export function isItemId(id: string): boolean {
  const n = codePoints(id)
  return n >= 1 && n <= MAX_ITEM_ID && id !== '__proto__'
}

/**
 * An id the details path can name in one segment: an item id with no `/`, and not `.` or `..`.
 * The API decodes `%2F` before routing, and the browser folds dot segments out of a path, so a
 * write for such an id would never reach its item and would be retried for good (D6). The app
 * makes no such id (`newId` is `x` and base36), but an import or an old plan can carry one: its
 * plan and marks work, its notes and details can't be saved. The API's `check_details_id` agrees.
 */
export function isDetailsId(id: string): boolean {
  return isItemId(id) && !id.includes('/') && id !== '.' && id !== '..'
}

/**
 * A section's details from a file, the cache or the API: a usable document per usable item id.
 * Documents that are empty or over the size cap drop out. As the API's `normalise_details_map`.
 */
export function normaliseDetailsMap(v: unknown): DetailsMap {
  const out: DetailsMap = {}
  if (!isRecord(v)) return out
  for (const [id, raw] of Object.entries(v)) {
    const details = normaliseDetails(raw)
    if (isItemId(id) && details && !isEmptyDetails(details) && detailsFit(details)) {
      out[id] = details
    }
  }
  return out
}

/**
 * Plan notes as details (D3), from an export of version 4 or older or a `-v3` cache: per item, the
 * note from the latest week whose copy of the item has one, the first such copy in that week. Only
 * items the plan keeps count. As the API's `lift_notes`, and its migration 7.
 */
export function liftNotes(v: unknown, normalise: (item: unknown) => object | null): DetailsMap {
  const out: DetailsMap = {}
  if (!isRecord(v)) return out
  const weeks = Object.keys(v)
    .filter((week) => WEEK_KEY.test(week) && Array.isArray(v[week]))
    .sort()
    .reverse()
  for (const week of weeks) {
    for (const raw of v[week] as unknown[]) {
      if (normalise(raw) === null) continue
      const { id, notes: rawNotes } = raw as { id: string; notes?: unknown }
      const notes = normaliseNotes(rawNotes)
      if (notes !== undefined && isItemId(id) && !Object.hasOwn(out, id)) out[id] = { notes }
    }
  }
  return out
}

export function normaliseExercise(v: unknown): Exercise | null {
  if (!isRecord(v) || typeof v.id !== 'string' || typeof v.name !== 'string') return null
  const weight = normaliseWeight(v.weight)
  const sets = toInt(v.sets, 0)
  const duration = toInt(v.duration, 0)
  // An item keeps no `notes` (D3): they are the item's details, one copy for every week.
  return {
    id: v.id,
    name: v.name,
    ...(sets > 0 ? { sets: Math.min(MAX_SETS, sets) } : {}),
    reps: Math.max(0, toInt(v.reps, 0)),
    ...(duration > 0 ? { duration: Math.min(MAX_DURATION, duration) } : {}),
    ...(typeof v.perSide === 'boolean' ? { perSide: v.perSide } : {}),
    ...(weight !== undefined ? { weight } : {}),
    target: clamp(toInt(v.target, NEW_EXERCISE_TARGET), MIN_TARGET, MAX_TARGET),
  }
}

export function normaliseFood(v: unknown): Food | null {
  if (!isRecord(v) || typeof v.id !== 'string' || typeof v.name !== 'string') return null
  return {
    id: v.id,
    name: v.name,
    target: clamp(toInt(v.target, NEW_FOOD_TARGET), MIN_TARGET, MAX_TARGET),
  }
}

export function isMark(v: unknown): v is Mark {
  return typeof v === 'string' && (MARKS as readonly string[]).includes(v)
}

/** One stored day: a mark as it is, a `true` from before marks had kinds as `great`, else empty. */
export function normaliseMark(v: unknown): Mark | null {
  if (v === true) return 'great'
  return isMark(v) ? v : null
}

export function normaliseLog(v: unknown): Log {
  const log: Log = {}
  if (!isRecord(v)) return log
  for (const [week, entries] of Object.entries(v)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !isRecord(entries)) continue
    const out: Record<string, Days> = {}
    for (const [id, days] of Object.entries(entries)) {
      if (!Array.isArray(days)) continue
      out[id] = Array.from({ length: 7 }, (_, i) => normaliseMark(days[i]))
    }
    log[week] = out
  }
  return log
}

export function normalisePlans<T>(v: unknown, normalise: (item: unknown) => T | null): Plans<T> {
  const plans: Plans<T> = {}
  if (!isRecord(v)) return plans
  for (const [week, items] of Object.entries(v)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !Array.isArray(items)) continue
    plans[week] = items.map(normalise).filter((it): it is T => it !== null)
  }
  return plans
}

export type TrackedData<T> = { plans: Plans<T>; log: Log }

/**
 * Coerce stored data into `{ plans, log }`, each field falling back on its own. Without v2 data, a
 * legacy single-list payload migrates: its list becomes the plan for every week it logged and for
 * `currentWeek`, so every week looks as it did before. With neither, plans start empty and the
 * stores show the defaults until something is changed.
 */
function parseTracked<T>(
  raw: string | null,
  legacyRaw: string | null,
  currentWeek: string,
  legacyListKey: 'exercises' | 'foods',
  normalise: (item: unknown) => T | null,
  defaults: () => T[],
): TrackedData<T> {
  const parsed = parseJson(raw)
  if (isRecord(parsed)) {
    return { plans: normalisePlans(parsed.plans, normalise), log: normaliseLog(parsed.log) }
  }
  if (legacyRaw === null) return { plans: {}, log: {} }
  const legacy = parseJson(legacyRaw)
  const list =
    isRecord(legacy) && Array.isArray(legacy[legacyListKey])
      ? (legacy[legacyListKey] as unknown[]).map(normalise).filter((it): it is T => it !== null)
      : defaults()
  const log = normaliseLog(isRecord(legacy) ? legacy.log : undefined)
  const plans: Plans<T> = {}
  for (const week of new Set([...Object.keys(log), currentWeek])) {
    plans[week] = list.map((it) => ({ ...it }))
  }
  return { plans, log }
}

export function parsePlannerData(
  raw: string | null,
  legacyRaw: string | null,
  currentWeek: string,
): PlannerData {
  return parseTracked(raw, legacyRaw, currentWeek, 'exercises', normaliseExercise, defaultExercises)
}

export function parseDietData(
  raw: string | null,
  legacyRaw: string | null,
  currentWeek: string,
): DietData {
  return parseTracked(raw, legacyRaw, currentWeek, 'foods', normaliseFood, defaultFoods)
}

/** The settings that belong to the person rather than the device: not the theme, totals or marks. */
export type PortableSettings = Pick<Settings, 'accent' | 'dailyPick' | 'foodPick' | 'goals'> & {
  /**
   * Daily goal (K85), left out where it isn't known (a cache, file or tab from before it), which
   * reads as on and, sent to the API, keeps the saved one.
   */
  dailyGoal?: boolean
  /** Each type's item-page arrangement (K66, P29); left out while every page has the default. */
  itemSections?: ItemSections
}

/**
 * Portable settings as a tab or its cache knows them. `goals` is absent when the tab hasn't read
 * them from the server or had them from the person: a cache written by a tab from before My goals
 * has none, and sending a stand-in would erase the saved ones (F1). (`dailyGoal` is optional in
 * PortableSettings already, for the same reason.)
 */
export type KnownSettings = Omit<PortableSettings, 'goals'> & { goals?: string }

/**
 * Any `#rrggbb` accent, daily picks for exercises and foods clamped to 1–8, each falling back to
 * its default, Daily goal only when it is a boolean, My goals as `normaliseGoals` reads them, and the item pages' arrangement as
 * `normaliseItemSections` reads it, left out when every page has the default.
 */
export function normalisePortableSettings(v: Record<string, unknown>): PortableSettings {
  const accent =
    typeof v.accent === 'string' && /^#[0-9a-f]{6}$/i.test(v.accent)
      ? v.accent
      : DEFAULT_SETTINGS.accent
  const dailyPick = clamp(
    toInt(v.dailyPick, DEFAULT_SETTINGS.dailyPick),
    MIN_DAILY_PICK,
    MAX_DAILY_PICK,
  )
  const foodPick = clamp(
    toInt(v.foodPick, DEFAULT_SETTINGS.foodPick),
    MIN_DAILY_PICK,
    MAX_DAILY_PICK,
  )
  const itemSections = normaliseItemSections(v.itemSections)
  return {
    accent,
    dailyPick,
    foodPick,
    ...(typeof v.dailyGoal === 'boolean' ? { dailyGoal: v.dailyGoal } : {}),
    goals: normaliseGoals(v.goals),
    ...(Object.keys(itemSections).length ? { itemSections } : {}),
  }
}

export function parseSettings(raw: string | null): Settings {
  const parsed = parseJson(raw)
  if (!isRecord(parsed)) return { ...DEFAULT_SETTINGS }
  const theme = isTheme(parsed.theme) ? parsed.theme : DEFAULT_SETTINGS.theme
  const markSet = isMarkSet(parsed.markSet) ? parsed.markSet : DEFAULT_SETTINGS.markSet
  const portable = normalisePortableSettings(parsed)
  return {
    ...portable,
    dailyGoal: portable.dailyGoal ?? DEFAULT_SETTINGS.dailyGoal,
    theme,
    markSet,
  }
}

/** `localStorage` can throw (private mode, blocked site data); the app must still run. */
export function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Skips unchanged values, so rewriting what is already stored fires no `storage` event. */
export function writeKey(key: string, value: unknown): void {
  try {
    const json = JSON.stringify(value)
    if (localStorage.getItem(key) !== json) localStorage.setItem(key, json)
  } catch {
    // Storage unavailable or full: keep running with in-memory state.
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Storage unavailable: nothing was stored.
  }
}

/**
 * Every key above began with one of these under the app's earlier names, newest first: Fitness
 * Planner until 2026-10-26 (K44), Exercise Planner until 2026-10-24.
 */
export const OLD_KEY_PREFIXES = ['fitness-planner-', 'exercise-planner-'] as const
export const KEY_PREFIX = 'tracker-'

/**
 * Move each key under an earlier name to the same name under `tracker-…`, newest name first. It
 * runs once per page load, before the stores read storage. A value already under the new name
 * wins, so a newer name's copy beats an older one's; the old key goes either way. When a copy
 * fails (storage full) the old key stays, so the next load retries.
 */
export function migrateKeyPrefix(): void {
  const keys: [key: string, prefix: string][] = []
  try {
    for (const prefix of OLD_KEY_PREFIXES) {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith(prefix)) keys.push([key, prefix])
      }
    }
  } catch {
    return // Storage unavailable: nothing to move.
  }
  for (const [key, prefix] of keys) {
    const next = KEY_PREFIX + key.slice(prefix.length)
    try {
      const value = localStorage.getItem(key)
      if (value !== null && localStorage.getItem(next) === null) localStorage.setItem(next, value)
      localStorage.removeItem(key)
    } catch {
      // Storage full: keep the old copy for the next load.
    }
  }
}
