import { isItemId, isRecord } from '@/lib/storage'
import { isSection, type Section } from '@/lib/trackerTypes'

/**
 * The item page's address, `#/item/<section>/<id>` (ItemPage card, D5), and the way back from it.
 * The section is a registry section (`exercise`, `cardio`, `diet`); the id is encoded, so any id the API's
 * paths can name fits in one segment.
 */

export type ItemRoute = { section: Section; id: string }

const ITEM_PREFIX = '#/item/'
const ITEM = /^#\/item\/([^/]+)\/([^/]+)$/

/** The address of an item's page. */
export function itemHref(section: Section, id: string): string {
  return `${ITEM_PREFIX}${section}/${encodeURIComponent(id)}`
}

/** Whether the hash is an item address at all, good or not. */
export function isItemHash(hash: string): boolean {
  return hash.startsWith(ITEM_PREFIX)
}

/** The item an address names, or null when it names no section or no id the API could name. */
export function parseItemHash(hash: string): ItemRoute | null {
  const match = ITEM.exec(hash)
  if (!match) return null
  let id: string
  try {
    id = decodeURIComponent(match[2]!)
  } catch {
    return null
  }
  const section = match[1]
  return isSection(section) && isItemId(id) ? { section, id } : null
}

/** The new item page's address, `#/new/<section>` (K104): Edit plan's Add opens it. */
const NEW = /^#\/new\/([^/]+)$/

/** The address of the page that adds an item to a section. */
export function newItemHref(section: Section): string {
  return `#/new/${section}`
}

/** The section a new-item address names, or null for any other address. */
export function parseNewHash(hash: string): Section | null {
  const section = NEW.exec(hash)?.[1]
  return isSection(section) ? section : null
}

/** On an item page's history entry: the entry before it is the week, in this tab. */
const FROM_WEEK = 'trackerFromWeek'

/** Mark the current history entry as an item page opened from the week. */
export function markFromWeek(): void {
  const state: unknown = history.state
  history.replaceState({ ...(isRecord(state) ? state : {}), [FROM_WEEK]: true }, '')
}

/** Whether the current entry was opened from the week in this tab (`markFromWeek`). */
export function cameFromWeek(): boolean {
  const state: unknown = history.state
  return isRecord(state) && state[FROM_WEEK] === true
}

/**
 * The page's "Back to the week" link, pressed. Opened from the week, it goes back through history,
 * so the page's Back and the browser's agree and the week's entry isn't doubled; opened some other
 * way (an address, a reload of an old one), the page's entry becomes the week. A press with a
 * modifier key is the browser's (a new tab or window at `#/`).
 */
export function backToWeek(ev: MouseEvent): void {
  if (ev.ctrlKey || ev.metaKey || ev.shiftKey) return
  ev.preventDefault()
  leaveForWeek()
}

/**
 * Back to the week from an item's page or the new item page, as its "Back to the week" does: back
 * through history when opened from the week in this tab, else this entry becomes the week. Used
 * after Remove, Add and Cancel too (K104).
 */
export function leaveForWeek(): void {
  if (cameFromWeek()) history.back()
  else location.replace('#/')
}

/**
 * The site a web address names, without `www.` ("youtube.com"), for the Link field's "Open
 * youtube.com in a new tab". Null for anything but an http or https address, so a `javascript:`
 * value never becomes a link.
 */
export function webHost(text: string): string | null {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return url.hostname.replace(/^www\./, '')
}
