import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { usePlannerStore } from '@/stores/planner'
import {
  MAX_TARGET,
  MIN_TARGET,
  NEW_FOOD_TARGET,
  clamp,
  defaultFoods,
  type DietData,
  type Food,
  type Log,
  type Mark,
} from '@/lib/storage'
import { copyPlan, planSource, type Plans } from '@/lib/plans'
import * as tracker from '@/lib/tracker'

/**
 * Foods eaten per day against a weekly goal. The visible week comes from the planner store, and
 * food plans carry forward week to week the same way exercise plans do.
 */
export const useDietStore = defineStore('diet', () => {
  const planner = usePlannerStore()
  // Filled and saved by the sync store, like the planner's data.
  const plans = ref<Plans<Food>>({})
  const log = ref<Log>({})

  const week = computed(() => log.value[planner.weekKey] ?? {})
  const planWeek = computed(() => planSource(plans.value, planner.weekKey))
  const foods = computed<Food[]>(() =>
    planWeek.value ? plans.value[planWeek.value]! : defaultFoods(),
  )

  /** The visible week's own plan, copied from what it shows on its first change. */
  function own(): Food[] {
    return (plans.value[planner.weekKey] ??= copyPlan(foods.value))
  }

  function isEaten(id: string, day: number): boolean {
    return tracker.isDone(week.value, id, day)
  }

  function markOf(id: string, day: number): Mark | null {
    return tracker.markOf(week.value, id, day)
  }

  function totalFor(id: string): number {
    return tracker.totalFor(week.value, id)
  }

  const dayCounts = computed(() => tracker.dayCounts(foods.value, week.value))
  const grandTotal = computed(() => tracker.grandTotal(foods.value, week.value))
  const goalsMet = computed(() => tracker.goalsMet(foods.value, week.value))

  /** Marks the day eaten, in each drawing in the squiggles, or clears it: foods have one kind of mark. */
  function toggle(id: string, day: number): void {
    own()
    tracker.cycleDay(log.value, planner.weekKey, id, day, tracker.cycleFor('food', planner.markSet))
  }

  function changeTarget(id: string, delta: number): void {
    const f = own().find((x) => x.id === id)
    if (f) f.target = clamp(f.target + delta, MIN_TARGET, MAX_TARGET)
  }

  /**
   * Adds a food this week: a name alone, or with its goal (the Add food dialog, K54). Returns its
   * id, or null (and adds nothing) when the trimmed name is empty. Its notes are its details (the
   * details store), not the week's.
   */
  function addFood(input: string | { name: string; target?: number }): string | null {
    const { name: rawName, target } = typeof input === 'string' ? { name: input } : input
    const name = rawName.trim()
    if (!name) return null
    const id = tracker.newId()
    own().push({ id, name, target: clamp(target ?? NEW_FOOD_TARGET, MIN_TARGET, MAX_TARGET) })
    return id
  }

  /**
   * Renames the food and sets its goal this week (the Edit food dialog), keeping its id and
   * history. False for an empty name or a food not in the week.
   */
  function updateFood(id: string, input: { name: string; target: number }): boolean {
    const name = input.name.trim()
    if (!name || !foods.value.some((f) => f.id === id)) return false
    const list = own()
    const i = list.findIndex((f) => f.id === id)
    list[i] = { id, name, target: clamp(input.target, MIN_TARGET, MAX_TARGET) }
    return true
  }

  /** Removes the food from this week; its log history stays in storage, like exercises. */
  function removeFood(id: string): void {
    plans.value[planner.weekKey] = own().filter((f) => f.id !== id)
  }

  /** Replace the user's food data wholesale: from the cache, the server, or another tab. */
  function adopt(data: DietData): void {
    plans.value = data.plans
    log.value = data.log
  }

  /** Replace one week's food plan, e.g. with the server's copy after a conflict. */
  function adoptWeek(week: string, items: Food[]): void {
    plans.value[week] = items
  }

  function clear(): void {
    adopt({ plans: {}, log: {} })
  }

  return {
    plans,
    foods,
    log,
    dayCounts,
    grandTotal,
    goalsMet,
    isEaten,
    markOf,
    totalFor,
    toggle,
    changeTarget,
    addFood,
    updateFood,
    removeFood,
    adopt,
    adoptWeek,
    clear,
  }
})
