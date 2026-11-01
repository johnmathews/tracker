import {
  DATA_KEY,
  DIET_KEY,
  LEGACY_DATA_KEY,
  LEGACY_DIET_KEY,
  SETTINGS_KEY,
  isRecord,
  normalisePortableSettings,
  parseDietData,
  parseJson,
  parsePlannerData,
  readKey,
  writeKey,
  type TrackedData,
} from '@/lib/storage'
import type { ExportData } from '@/lib/transfer'

/**
 * What this browser recorded before accounts existed, as export data, or null when it holds
 * nothing worth offering. The keys are read with the same parsing and migration the stores used
 * then (docs/architecture.md §4); they are never written or removed.
 */
export function readLegacyData(currentWeek: string): ExportData | null {
  const exercise = fromV1Only(
    DATA_KEY,
    LEGACY_DATA_KEY,
    currentWeek,
    parsePlannerData(readKey(DATA_KEY), readKey(LEGACY_DATA_KEY), currentWeek),
  )
  const diet = fromV1Only(
    DIET_KEY,
    LEGACY_DIET_KEY,
    currentWeek,
    parseDietData(readKey(DIET_KEY), readKey(LEGACY_DIET_KEY), currentWeek),
  )
  // The settings key also holds the theme, which every device still writes; only an accent or a
  // daily pick, saved before accounts, is the person's.
  const raw = parseJson(readKey(SETTINGS_KEY))
  const settings =
    isRecord(raw) && ('accent' in raw || 'dailyPick' in raw) ? normalisePortableSettings(raw) : null
  const empty = (t: { plans: object; log: object }) =>
    !Object.keys(t.plans).length && !Object.keys(t.log).length
  if (empty(exercise) && empty(diet) && !settings) return null
  // No details: these keys were last written before accounts (P9), and notes came after (K43).
  return {
    exercise: { ...exercise, details: {} },
    diet: { ...diet, details: {} },
    settings,
  }
}

/**
 * Trim what the single-list (v1) migration invents. Locally, the old app copied the one list
 * onto every logged week and onto the current week, so the screen looked as before. Imported
 * into an account, that copy on the current week would replace the account's own carried-forward
 * plan for it and every later week, and an empty list would empty them. So: the list goes only on
 * weeks it was ticked in, on the current week only if it was never ticked, and nowhere if empty.
 * A damaged v1 key, which the parser reads as the default list, gives nothing.
 */
function fromV1Only<T>(
  v2Key: string,
  v1Key: string,
  currentWeek: string,
  data: TrackedData<T>,
): TrackedData<T> {
  if (isRecord(parseJson(readKey(v2Key))) || readKey(v1Key) === null) return data
  const v1 = parseJson(readKey(v1Key))
  const list = isRecord(v1) ? Object.values(v1).find(Array.isArray) : undefined
  if (!list?.length) return { plans: {}, log: data.log }
  const logged = Object.keys(data.log)
  if (!logged.length) return data
  const plans = Object.fromEntries(logged.map((week) => [week, data.plans[week]!]))
  return { plans, log: data.log }
}

/**
 * Whether the first-login prompt has had its answer for a user on this browser: `imported`
 * (added, or nothing left to add) or `dismissed` ("Not mine"). Kept through sign-out, so the
 * answer holds for the next sign-in too.
 */
export const IMPORT_MARKER_PREFIX = 'tracker-import-v1:'
export type ImportMarker = 'imported' | 'dismissed'

export function readImportMarker(user: string): ImportMarker | null {
  const value = readKey(IMPORT_MARKER_PREFIX + user)
  return value === '"imported"' || value === '"dismissed"'
    ? (JSON.parse(value) as ImportMarker)
    : null
}

export function writeImportMarker(user: string, marker: ImportMarker): void {
  writeKey(IMPORT_MARKER_PREFIX + user, marker)
}
