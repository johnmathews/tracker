import { usePlannerStore } from '@/stores/planner'
import { useCardioStore } from '@/stores/cardio'
import { useDietStore } from '@/stores/diet'
import { defaultCardio, defaultExercises, defaultFoods, type Log } from '@/lib/storage'
import type { Plans } from '@/lib/plans'
import type { Tracked } from '@/lib/tracker'
import type { Section } from '@/lib/trackerTypes'

/** What the item page reads and changes of one section, from its store. */
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

/**
 * Each section's data from its store (the planner's exercises, the cardio store's items, the diet
 * store's foods), by the
 * registry's section names, for the item page and the route that opens it.
 */
export function useItemSource(): (section: Section) => ItemSource {
  const planner = usePlannerStore()
  const cardio = useCardioStore()
  const diet = useDietStore()
  const sources: Record<Section, () => ItemSource> = {
    exercise: () => ({
      plans: planner.plans,
      items: planner.exercises,
      log: planner.log,
      fallback: defaultExercises(),
      changeTarget: planner.changeTarget,
    }),
    cardio: () => ({
      plans: cardio.plans,
      items: cardio.items,
      log: cardio.log,
      fallback: defaultCardio(),
      changeTarget: cardio.changeTarget,
    }),
    diet: () => ({
      plans: diet.plans,
      items: diet.foods,
      log: diet.log,
      fallback: defaultFoods(),
      changeTarget: diet.changeTarget,
    }),
  }
  return (section) => sources[section]()
}

/** Whether an item has a page: it is in the visible week, or in some week's plan. */
export function itemExists(source: ItemSource, id: string): boolean {
  return (
    source.items.some((it) => it.id === id) ||
    Object.values(source.plans).some((items) => items.some((it) => it.id === id))
  )
}
