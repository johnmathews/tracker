import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { usePlannerStore } from '@/stores/planner'
import {
  MAX_CARDIO_DURATION,
  MAX_TARGET,
  MIN_TARGET,
  NEW_CARDIO_TARGET,
  clamp,
  defaultCardio,
  normaliseDistance,
  type Cardio,
  type CardioData,
  type Log,
  type Mark,
} from '@/lib/storage'
import { copyPlan, planSource, type Plans } from '@/lib/plans'
import * as tracker from '@/lib/tracker'

/** What the Add and Edit cardio dialogs give: a name, a time and a distance, and a goal. */
export type NewCardio = { name: string; duration?: number; distance?: number; target?: number }

/**
 * Cardio done per day against a weekly goal (K90): cycling, running and the like, each with a time,
 * a distance, both or neither. The visible week comes from the planner store, and the plans carry
 * forward week to week as the others do. There is no daily target.
 */
export const useCardioStore = defineStore('cardio', () => {
  const planner = usePlannerStore()
  // Filled and saved by the sync store, like the planner's data.
  const plans = ref<Plans<Cardio>>({})
  const log = ref<Log>({})

  const week = computed(() => log.value[planner.weekKey] ?? {})
  const planWeek = computed(() => planSource(plans.value, planner.weekKey))
  const items = computed<Cardio[]>(() =>
    planWeek.value ? plans.value[planWeek.value]! : defaultCardio(),
  )

  /** The visible week's own plan, copied from what it shows on its first change. */
  function own(): Cardio[] {
    return (plans.value[planner.weekKey] ??= copyPlan(items.value))
  }

  function markOf(id: string, day: number): Mark | null {
    return tracker.markOf(week.value, id, day)
  }

  function totalFor(id: string): number {
    return tracker.totalFor(week.value, id)
  }

  const dayCounts = computed(() => tracker.dayCounts(items.value, week.value))
  const goalsMet = computed(() => tracker.goalsMet(items.value, week.value))

  /** Steps the day through great, partial and missed, as an exercise's (K90), then clears it. */
  function toggle(id: string, day: number): void {
    own()
    tracker.cycleDay(
      log.value,
      planner.weekKey,
      id,
      day,
      tracker.cycleFor('cardio', planner.markSet),
    )
  }

  function changeTarget(id: string, delta: number): void {
    const c = own().find((x) => x.id === id)
    if (c) c.target = clamp(c.target + delta, MIN_TARGET, MAX_TARGET)
  }

  /** The item as stored: whole seconds and km within their limits, each left out when not set. */
  function item(id: string, name: string, input: NewCardio): Cardio {
    const duration = Math.round(input.duration ?? 0)
    const distance = normaliseDistance(input.distance)
    return {
      id,
      name,
      ...(duration > 0 ? { duration: Math.min(MAX_CARDIO_DURATION, duration) } : {}),
      ...(distance !== undefined ? { distance } : {}),
      target: clamp(input.target ?? NEW_CARDIO_TARGET, MIN_TARGET, MAX_TARGET),
    }
  }

  /**
   * Adds a cardio item this week (the Add cardio dialog, K54). Returns its id, or null (and adds
   * nothing) when the trimmed name is empty. Its notes are its details, not the week's.
   */
  function addCardio(input: NewCardio): string | null {
    const name = input.name.trim()
    if (!name) return null
    const id = tracker.newId()
    own().push(item(id, name, input))
    return id
  }

  /**
   * Replaces the item's name, time, distance and goal this week (the Edit cardio dialog), keeping
   * its id and history; the goal stays when none is given. False for an empty name or an item not
   * in the week.
   */
  function updateCardio(id: string, input: NewCardio): boolean {
    const name = input.name.trim()
    const current = items.value.find((c) => c.id === id)
    if (!name || !current) return false
    const list = own()
    const i = list.findIndex((c) => c.id === id)
    list[i] = item(id, name, { ...input, target: input.target ?? current.target })
    return true
  }

  /** Removes the item from this week; its log history stays in storage, like the others. */
  function removeCardio(id: string): void {
    plans.value[planner.weekKey] = own().filter((c) => c.id !== id)
  }

  /** Replace the user's cardio data wholesale: from the cache, the server, or another tab. */
  function adopt(data: CardioData): void {
    plans.value = data.plans
    log.value = data.log
  }

  /** Replace one week's cardio plan, e.g. with the server's copy after a conflict. */
  function adoptWeek(week: string, list: Cardio[]): void {
    plans.value[week] = list
  }

  function clear(): void {
    adopt({ plans: {}, log: {} })
  }

  return {
    plans,
    items,
    log,
    dayCounts,
    goalsMet,
    markOf,
    totalFor,
    toggle,
    changeTarget,
    addCardio,
    updateCardio,
    removeCardio,
    adopt,
    adoptWeek,
    clear,
  }
})
