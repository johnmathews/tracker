import type { TrackerTypeId } from '@/lib/trackerTypes'

/**
 * The item page's sections, shown or hidden and in order, per tracker type (K66, P24). A setting
 * that syncs with the account (`itemSections`), keyed by type id, not section, so every page of a
 * type shares one. `api/src/tracker_api/item_sections.py` normalises the same way, and
 * `fixtures/item-sections/normalise.json` keeps the two in step.
 */

/** The page's sections: its notes, its type's fields, the week's plan and recent weeks. */
export type SectionKey = 'notes' | 'details' | 'plan' | 'history'

/** The order a page shows them in until it is arranged, every one shown (K65). */
export const DEFAULT_ORDER: readonly SectionKey[] = ['notes', 'details', 'plan', 'history']

/**
 * One type's page: every section once, in the order shown, and those it hides (in the default
 * order, so moving a section never reorders them).
 */
export type Arrangement = { order: SectionKey[]; hidden: SectionKey[] }

/** Each type's arrangement by type id. A type left out has the default one. */
export type ItemSections = Partial<Record<TrackerTypeId, Arrangement>>

/**
 * The registry's type ids, in its order. Written out rather than read from trackerTypes.ts, which
 * imports storage.ts, which imports this module: the Record makes TypeScript check every id is
 * here and no other, and itemSections.spec.ts that the order is the registry's.
 */
const TYPE_IDS: Readonly<Record<TrackerTypeId, true>> = { exercise: true, food: true }
export const ITEM_SECTION_TYPES = Object.keys(TYPE_IDS) as readonly TrackerTypeId[]

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isSectionKey(v: unknown): v is SectionKey {
  return typeof v === 'string' && (DEFAULT_ORDER as readonly string[]).includes(v)
}

/** A list's section keys, each once, in the list's order; anything else is passed over. */
function known(v: unknown): SectionKey[] {
  const out: SectionKey[] = []
  if (Array.isArray(v))
    for (const key of v) if (isSectionKey(key) && !out.includes(key)) out.push(key)
  return out
}

/**
 * One type's arrangement: known keys once each, the missing ones after them in the default order;
 * `hidden` a subset of the keys, in the default order. Anything unusable reads as the default.
 */
export function normaliseArrangement(v: unknown): Arrangement {
  const raw = isRecord(v) ? v : {}
  const order = known(raw.order)
  order.push(...DEFAULT_ORDER.filter((k) => !order.includes(k)))
  const hidden = known(raw.hidden)
  return { order, hidden: DEFAULT_ORDER.filter((k) => hidden.includes(k)) }
}

function isDefault(a: Arrangement): boolean {
  return a.hidden.length === 0 && a.order.every((k, i) => k === DEFAULT_ORDER[i])
}

/**
 * Each type's arrangement, in the registry's order, leaving out a type with the default one. A
 * type the registry doesn't have is dropped, so a value from a newer version still reads;
 * anything that isn't an object reads as `{}`.
 */
export function normaliseItemSections(v: unknown): ItemSections {
  const out: ItemSections = {}
  if (!isRecord(v)) return out
  for (const type of ITEM_SECTION_TYPES) {
    if (!Object.hasOwn(v, type)) continue
    const a = normaliseArrangement(v[type])
    if (!isDefault(a)) out[type] = a
  }
  return out
}

/** A type's arrangement, as a copy the caller may change: the default when it has none. */
export function arrangementOf(sections: ItemSections, type: TrackerTypeId): Arrangement {
  const a = sections[type]
  return a ? { order: [...a.order], hidden: [...a.hidden] } : normaliseArrangement(null)
}

/** The arrangement with `key` shown or hidden. */
export function showSection(a: Arrangement, key: SectionKey, shown: boolean): Arrangement {
  const hidden = shown ? a.hidden.filter((k) => k !== key) : [...a.hidden, key]
  return normaliseArrangement({ order: a.order, hidden })
}

/** The arrangement with `key` one place earlier (-1) or later (1); unchanged at either end. */
export function moveSection(a: Arrangement, key: SectionKey, delta: -1 | 1): Arrangement {
  const order = [...a.order]
  const i = order.indexOf(key)
  const j = i + delta
  if (i < 0 || j < 0 || j >= order.length) return { order, hidden: [...a.hidden] }
  ;[order[i], order[j]] = [order[j]!, order[i]!]
  return { order, hidden: [...a.hidden] }
}

/** The sections a page shows, in order. */
export function shownSections(a: Arrangement): SectionKey[] {
  return a.order.filter((k) => !a.hidden.includes(k))
}

/** The setting with `type`'s arrangement replaced; a default one is left out. */
export function withArrangement(
  sections: ItemSections,
  type: TrackerTypeId,
  a: Arrangement,
): ItemSections {
  return normaliseItemSections({ ...sections, [type]: a })
}
