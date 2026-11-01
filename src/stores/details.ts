import { ref } from 'vue'
import { defineStore } from 'pinia'
import {
  MAX_DETAILS_NOTES,
  MAX_FIELD,
  codePoints,
  detailsFit,
  isEmptyDetails,
  isItemId,
  normaliseDetails,
  normaliseText,
  type DetailsMap,
  type ItemDetails,
} from '@/lib/storage'
import { SECTION_NAMES, type Section } from '@/lib/trackerTypes'

/** Every section's details by item id, each section empty. */
export function noDetails(): Record<Section, DetailsMap> {
  return Object.fromEntries(SECTION_NAMES.map((s) => [s, {}])) as Record<Section, DetailsMap>
}

/** What `get` returns for an item with no details. Frozen: it is shared. */
const NONE: Readonly<ItemDetails> = Object.freeze({})
/** A field key the API keeps (validate.py's FIELD_KEY_RE). */
const FIELD_KEY = /^[a-z][a-z0-9_]{0,31}$/

/** A text's length once trimmed, in code points, as the API counts it. */
function trimmedLength(text: string): number {
  return codePoints(normaliseText(text, Infinity) ?? '')
}

/**
 * Each item's details (D2): its notes and its type's fields, one copy for every week, per section.
 * The sync store fills it through `adopt` and saves it, as it does the plans: a change here is
 * queued as a `details` operation and sent with the revision last seen (docs/architecture.md §7).
 *
 * The setters store the document as the API would (trimmed, blanks left out, an empty document
 * dropped), so what shows is what is saved. A page that edits as you type keeps its own draft of
 * the text and calls a setter on each change: a trailing space stays in the draft, and a change that
 * normalises to the same document queues nothing.
 */
export const useDetailsStore = defineStore('details', () => {
  const docs = ref<Record<Section, DetailsMap>>(noDetails())

  /** An item's details; an empty document when it has none. */
  function get(section: Section, id: string): Readonly<ItemDetails> {
    const map = docs.value[section]
    // Read the key first: Vue tracks a read, not Object.hasOwn, so whatever reads an item with no
    // details yet updates when its first details arrive. hasOwn keeps `toString` and the like out.
    const doc = map[id]
    return Object.hasOwn(map, id) ? doc! : NONE
  }

  /** An item's notes in markdown, or '' when it has none. */
  function notesOf(section: Section, id: string): string {
    return get(section, id).notes ?? ''
  }

  /** One of an item's fields, or '' when it is blank. */
  function fieldOf(section: Section, id: string, key: string): string {
    return get(section, id).fields?.[key] ?? ''
  }

  /** The document `next` makes, normalised, or null when it is over the API's size cap. */
  function make(next: ItemDetails): ItemDetails | null {
    const doc = normaliseDetails(next)!
    return detailsFit(doc) ? doc : null
  }

  function put(section: Section, id: string, doc: ItemDetails): void {
    if (isEmptyDetails(doc)) delete docs.value[section][id]
    else docs.value[section][id] = doc
  }

  /**
   * The document an item would have with `text` as its notes (`id` null: an item not added yet,
   * with no details); null when that can't be saved. An id the API's paths can't name is refused,
   * `__proto__` among them, which as a key would set the map's prototype.
   */
  function withNotes(section: Section, id: string | null, text: string): ItemDetails | null {
    if (trimmedLength(text) > MAX_DETAILS_NOTES) return null
    if (id === null) return make({ notes: text })
    return isItemId(id) ? make({ ...get(section, id), notes: text }) : null
  }

  /**
   * Whether `text` can be an item's notes (`id` null: an item about to be added): at most
   * MAX_DETAILS_NOTES characters once trimmed, and the document within the API's size cap (32 KB,
   * which 20,000 characters of some scripts pass). A dialog asks before it changes anything.
   */
  function canSetNotes(section: Section, id: string | null, text: string): boolean {
    return withNotes(section, id, text) !== null
  }

  /**
   * Set an item's notes for every week; blank clears them. False, and nothing changes, when they
   * can't be saved (`canSetNotes`).
   */
  function setNotes(section: Section, id: string, text: string): boolean {
    const doc = withNotes(section, id, text)
    if (!doc) return false
    put(section, id, doc)
    return true
  }

  /**
   * Set one of an item's fields for every week; blank clears it. False, and nothing changes, for a
   * key the API wouldn't keep, text over MAX_FIELD characters once trimmed, a document over the
   * size cap, a new field past the API's 32, or an id the API can't name.
   */
  function setField(section: Section, id: string, key: string, text: string): boolean {
    if (!isItemId(id) || !FIELD_KEY.test(key) || trimmedLength(text) > MAX_FIELD) return false
    const current = get(section, id)
    const doc = make({ ...current, fields: { ...current.fields, [key]: text } })
    if (!doc) return false
    if (trimmedLength(text) > 0 && doc.fields?.[key] === undefined) return false
    put(section, id, doc)
    return true
  }

  /** Replace every section's details: from the cache, the server, or another tab. */
  function adopt(next: Record<Section, DetailsMap>): void {
    docs.value = next
  }

  /** Replace one item's details, e.g. with the server's copy after a conflict; null clears them. */
  function adoptItem(section: Section, id: string, doc: ItemDetails | null): void {
    put(section, id, doc ?? {})
  }

  function clear(): void {
    adopt(noDetails())
  }

  return {
    docs,
    get,
    notesOf,
    fieldOf,
    canSetNotes,
    setNotes,
    setField,
    adopt,
    adoptItem,
    clear,
  }
})
