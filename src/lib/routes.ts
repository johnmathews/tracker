import { isItemId, isRecord } from '@/lib/storage'
import { isTrackerId } from '@/lib/trackers'

/**
 * The item page's address, `#/item/<tracker>/<id>` (ItemPage card, D5), and the way back from it.
 * The tracker is a tracker id (`exercise`, `cardio`, `diet` for the first three, K123); the id is
 * encoded, so any id the API's paths can name fits in one segment. These functions check an
 * address's shape only: whether the account has the tracker is the app's to check, once the
 * trackers have loaded (App.vue).
 */

/** An item page's tracker id (`section`, as the API's paths name it) and item id. */
export type ItemRoute = { section: string; id: string }

const ITEM_PREFIX = '#/item/'
const ITEM = /^#\/item\/([^/]+)\/([^/]+)$/

/** The address of an item's page. */
export function itemHref(section: string, id: string): string {
  return `${ITEM_PREFIX}${section}/${encodeURIComponent(id)}`
}

/** Whether the hash is an item address at all, good or not. */
export function isItemHash(hash: string): boolean {
  return hash.startsWith(ITEM_PREFIX)
}

/** The item an address names, or null when it names no tracker id or item id the API could name. */
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
  return isTrackerId(section) && isItemId(id) ? { section, id } : null
}

/** The new item page's address, `#/new/<tracker>` (K104): Edit plan's Add opens it. */
const NEW = /^#\/new\/([^/]+)$/

/** The address of the page that adds an item to a tracker. */
export function newItemHref(section: string): string {
  return `#/new/${section}`
}

/** The tracker id a new-item address names, or null for any other address. */
export function parseNewHash(hash: string): string | null {
  const section = NEW.exec(hash)?.[1]
  return isTrackerId(section) ? section : null
}

/** The new tracker page's address (K124): Edit plan's Add tracker opens it. */
export const NEW_TRACKER_HREF = '#/new-tracker'

/** Whether the address is the new tracker page's. */
export function isNewTrackerHash(hash: string): boolean {
  return hash === NEW_TRACKER_HREF
}

/**
 * The Settings page's tabs, in order (K119), each with its own address: `#/settings/<tab>`.
 * `#/settings` alone opens the first.
 */
export const SETTINGS_TABS = ['appearance', 'daily-goal', 'data', 'connections'] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]

const SETTINGS = /^#\/settings(?:\/([^/]+))?$/

/** The address of the Settings page, on a tab. With no tab, the page's own address. */
export function settingsHref(tab?: SettingsTab): string {
  return tab ? `#/settings/${tab}` : '#/settings'
}

/**
 * The Settings tab an address opens: the first for `#/settings`, the named one for
 * `#/settings/<tab>`, and null for any other address, a tab Settings doesn't have included.
 */
export function parseSettingsHash(hash: string): SettingsTab | null {
  const match = SETTINGS.exec(hash)
  if (!match) return null
  const tab = match[1] ?? SETTINGS_TABS[0]
  return (SETTINGS_TABS as readonly string[]).includes(tab) ? (tab as SettingsTab) : null
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
