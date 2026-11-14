import { useTrackersStore, type NewItem } from '@/stores/trackers'
import type { Log } from '@/lib/storage'
import type { Plans } from '@/lib/plans'
import type { Item } from '@/lib/trackerTypes'

/** An item of any kind, every field a kind may have readable. */
export type AnyItem = Item &
  Partial<Record<'sets' | 'reps' | 'duration' | 'weight' | 'distance', number>> & {
    perSide?: boolean
  }

/**
 * One tracker of the trackers store, read and changed as the single-section stores were (the
 * planner's exercises, the cardio store's items, the diet store's foods), so a component test can
 * seed and read one tracker in a line. Every read and write goes to the trackers store.
 */
export function trackerView(id: string) {
  const t = useTrackersStore()
  const data = () => ({ plans: t.plansOf(id), log: t.logOf(id) })
  const update = (item: string, input: NewItem) => t.updateItem(id, item, input)
  const remove = (item: string) => t.removeItem(id, item)
  const add = (input: NewItem | string) =>
    t.addItem(id, typeof input === 'string' ? { name: input } : input)
  return {
    get plans(): Plans<AnyItem> {
      return t.plansOf(id)
    },
    set plans(plans: Plans<AnyItem>) {
      t.data[id] = { ...data(), plans }
    },
    get log(): Log {
      return t.logOf(id)
    },
    set log(log: Log) {
      t.data[id] = { ...data(), log }
    },
    get items(): AnyItem[] {
      return t.itemsOf(id)
    },
    get dayCounts(): number[] {
      return t.dayCounts(id)
    },
    get grandTotal(): number {
      return t.grandTotal(id)
    },
    markOf: (item: string, day: number) => t.markOf(id, item, day),
    isDone: (item: string, day: number) => t.isDone(id, item, day),
    totalFor: (item: string) => t.totalFor(id, item),
    toggle: (item: string, day: number) => t.toggle(id, item, day),
    changeTarget: (item: string, delta: number) => t.changeTarget(id, item, delta),
    addItem: add,
    updateItem: update,
    removeItem: remove,
  }
}
