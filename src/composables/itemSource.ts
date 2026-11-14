import { useTrackersStore } from '@/stores/trackers'
import type { Log } from '@/lib/storage'
import type { Plans } from '@/lib/plans'
import type { Tracked } from '@/lib/tracker'
import { defaultItems } from '@/lib/trackerTypes'

/** What the item page reads and changes of one tracker, from the trackers store. */
export type ItemSource = {
  plans: Plans<Tracked>
  /** The visible week's items: its own plan, the one it carries forward, or the defaults. */
  items: Tracked[]
  log: Log
  /** The items a week shows while nothing is planned. */
  fallback: Tracked[]
  /** The Edit dialog's goal action, for the visible week. */
  changeTarget: (id: string, delta: number) => void
}

/** Each tracker's data from the trackers store, by tracker id, for the item page and its route. */
export function useItemSource(): (section: string) => ItemSource {
  const trackers = useTrackersStore()
  return (section) => ({
    plans: trackers.plansOf(section),
    items: trackers.itemsOf(section),
    log: trackers.logOf(section),
    fallback: defaultItems(section),
    changeTarget: (id, delta) => trackers.changeTarget(section, id, delta),
  })
}

/** Whether an item has a page: it is in the visible week, or in some week's plan. */
export function itemExists(source: ItemSource, id: string): boolean {
  return (
    source.items.some((it) => it.id === id) ||
    Object.values(source.plans).some((items) => items.some((it) => it.id === id))
  )
}
