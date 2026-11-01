import { dateKey } from '@/lib/dates'
import { copyPlan } from '@/lib/plans'
import {
  isRecord,
  normaliseExercise,
  normaliseFood,
  normaliseLog,
  normalisePlans,
  normalisePortableSettings,
  parseJson,
  type DietData,
  type Days,
  type Log,
  type Mark,
  type PlannerData,
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
 * Version 4 files may carry a note on an exercise or a food (K43). Version 3 files carry a mark
 * per day with its drawing (`great`, `partial-solid`, `missed-hatch` … or null). Version 2 files
 * carry the kinds alone, which read as the zigzag; version 1 files a `true` per done day, which
 * reads as `great`. All four import. Settings may carry My goals (`goals`) with no new version, as
 * `foodPick` came: a reader from before them drops the key, and a file without them reads as none.
 */
export const EXPORT_VERSION = 4
const READ_VERSIONS: readonly unknown[] = [1, 2, 3, EXPORT_VERSION]

export type ExportData = {
  exercise: PlannerData
  diet: DietData
  /** Null when the file carries no settings. */
  settings: PortableSettings | null
}

export type ExportFile = {
  format: typeof EXPORT_FORMAT
  version: typeof EXPORT_VERSION
  exportedAt: string
  exercise: PlannerData
  diet: DietData
  settings: PortableSettings
}

export type ParseError = 'json' | 'format' | 'version'

export type ParseResult = { ok: true; data: ExportData } | { ok: false; error: ParseError }

/** The theme is left out on purpose: it belongs to the device, not the person. */
export function buildExport(input: {
  exercise: PlannerData
  diet: DietData
  settings: PortableSettings
  now?: Date
}): ExportFile {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: (input.now ?? new Date()).toISOString(),
    exercise: { plans: input.exercise.plans, log: input.exercise.log },
    diet: { plans: input.diet.plans, log: input.diet.log },
    settings: {
      accent: input.settings.accent,
      dailyPick: input.settings.dailyPick,
      foodPick: input.settings.foodPick,
      goals: input.settings.goals,
    },
  }
}

function section<T>(v: unknown, normalise: (item: unknown) => T | null): TrackedData<T> {
  if (!isRecord(v)) return { plans: {}, log: {} }
  return { plans: normalisePlans(v.plans, normalise), log: normaliseLog(v.log) }
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
  return {
    ok: true,
    data: {
      exercise: section(parsed.exercise, normaliseExercise),
      diet: section(parsed.diet, normaliseFood),
      settings: isRecord(parsed.settings) ? normalisePortableSettings(parsed.settings) : null,
    },
  }
}

const NO_DAYS: readonly (Mark | null)[] = Array<Mark | null>(7).fill(null)

/**
 * Merge without deleting: a week that has a plan keeps it (an empty plan included), a week without
 * one takes the incoming plan, and per week, item and day a marked day keeps its mark while an
 * empty one takes the file's. Returns new objects; neither argument changes.
 */
export function mergeTracked<T extends object>(
  existing: TrackedData<T>,
  incoming: TrackedData<T>,
): TrackedData<T> {
  const plans = { ...existing.plans }
  for (const [week, items] of Object.entries(incoming.plans)) {
    if (!(week in plans)) plans[week] = copyPlan(items)
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
  return { plans, log }
}

/** What a merge would add: weeks that gain a plan, and empty days that gain a mark. */
export function mergeSummary<T>(
  existing: TrackedData<T>,
  incoming: TrackedData<T>,
): { weeks: number; ticks: number } {
  const weeks = Object.keys(incoming.plans).filter((w) => !(w in existing.plans)).length
  let ticks = 0
  for (const [week, entries] of Object.entries(incoming.log)) {
    for (const [id, days] of Object.entries(entries)) {
      const mine = existing.log[week]?.[id] ?? NO_DAYS
      ticks += days.filter((m, i) => m !== null && mine[i] === null).length
    }
  }
  return { weeks, ticks }
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
