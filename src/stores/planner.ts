import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { DAY_NAMES, dateKey, fullDate, mondayOf, weekDates, weekTitle } from '@/lib/dates'
import {
  DEFAULT_SETTINGS,
  MAX_DAILY_PICK,
  MAX_DURATION,
  MAX_SETS,
  MAX_TARGET,
  MIN_DAILY_PICK,
  MIN_TARGET,
  NEW_EXERCISE_TARGET,
  SETTINGS_KEY,
  clamp,
  defaultExercises,
  isRecord,
  normaliseWeight,
  parseJson,
  parseSettings,
  readKey,
  writeKey,
  type Exercise,
  type Log,
  type Mark,
  type MarkSet,
  type PlannerData,
  type PortableSettings,
} from '@/lib/storage'
import * as tracker from '@/lib/tracker'
import type { Theme } from '@/lib/theme'
import { copyPlan, planSource, type Plans } from '@/lib/plans'
import {
  arrangementOf,
  normaliseItemSections,
  withArrangement,
  type Arrangement,
  type ItemSections,
} from '@/lib/itemSections'
import type { TrackerTypeId } from '@/lib/trackerTypes'
import { useDetailsStore } from '@/stores/details'

/**
 * One column of the week: `name` "Thu" and `date` "22" for the header, `full` "Thursday 22
 * October" for the DayMarks' names, and whether it is today or still to come.
 */
export type Day = {
  name: string
  date: string
  full: string
  key: string
  isToday: boolean
  isFuture: boolean
}

export type NewExercise = {
  name: string
  sets?: number
  /** Reps per set; ignored when `duration` is set. */
  reps: number
  /** Seconds per set for a timed exercise. */
  duration?: number
  perSide: boolean
  weight?: number
  /** The weekly goal; left out, an added exercise gets NEW_EXERCISE_TARGET. */
  target?: number
}

/** The chips under an exercise name: the exercise type's (src/lib/trackerTypes.ts). */
export { exerciseDetails } from '@/lib/trackerTypes'

/**
 * Cleans form input into the stored fields; null when the trimmed name is empty. An exercise
 * counts reps or time, never both: a duration keeps reps at 0.
 */
function exerciseFields(input: NewExercise): Omit<Exercise, 'id' | 'target'> | null {
  const name = input.name.trim()
  if (!name) return null
  const duration =
    input.duration !== undefined && Number.isFinite(input.duration) && input.duration > 0
      ? Math.min(MAX_DURATION, Math.floor(input.duration))
      : 0
  const reps =
    !duration && Number.isFinite(input.reps) && input.reps > 0 ? Math.floor(input.reps) : 0
  const sets = Math.min(MAX_SETS, Math.floor(input.sets ?? 0))
  const weight = normaliseWeight(input.weight)
  return {
    name,
    ...(sets > 0 ? { sets } : {}),
    reps,
    ...(duration ? { duration } : {}),
    perSide: input.perSide,
    ...(weight !== undefined ? { weight } : {}),
  }
}

export const usePlannerStore = defineStore('planner', () => {
  /** "Now" as a ref so the today column moves when the tab is revisited after midnight. */
  const now = ref(new Date())
  /** Monday of the real current week, whichever week is on screen. */
  const currentWeekKey = computed(() => dateKey(mondayOf(now.value, 0)))

  // Plans, the log, accent and daily picks are the signed-in user's: the sync store fills them
  // through `adopt` and saves them. Only the theme and the mark set belong to the device, and are
  // stored here. The accent no longer draws anything, since the marks' pens
  // are fixed (DayMark card); it is kept as it was saved, so the server and exports still agree.
  // Nothing in the app changes it now.
  const plans = ref<Plans<Exercise>>({})
  const log = ref<Log>({})
  const weekOffset = ref(0)
  const accent = ref(DEFAULT_SETTINGS.accent)
  const dailyPick = ref(DEFAULT_SETTINGS.dailyPick)
  /** Foods a day (K57). It lives here with the other settings, though the diet store's days use it. */
  const foodPick = ref(DEFAULT_SETTINGS.foodPick)
  /** Each type's item-page arrangement (K66); a type left out shows every section in order. */
  const itemSections = ref<ItemSections>({})
  const theme = ref<Theme>(parseSettings(readKey(SETTINGS_KEY)).theme)
  const markSet = ref<MarkSet>(parseSettings(readKey(SETTINGS_KEY)).markSet)
  /** Whether the user has settings of their own (from the server, a change, or an import). */
  const settingsSaved = ref(false)
  /** Config mode shows the plan-editing controls; normal mode only ticks cells. Not persisted. */
  const configMode = ref(false)

  const monday = computed(() => mondayOf(now.value, weekOffset.value))
  const weekKey = computed(() => dateKey(monday.value))
  /** The page heading: "19–25 October", with the year when it isn't this one. */
  const label = computed(() => weekTitle(monday.value, now.value))
  const week = computed(() => log.value[weekKey.value] ?? {})

  /** The week whose plan is showing; null while only the defaults exist. */
  const planWeek = computed(() => planSource(plans.value, weekKey.value))
  /** This week's exercises: its own plan, or the one it carries forward (see `planSource`). */
  const exercises = computed<Exercise[]>(() =>
    planWeek.value ? plans.value[planWeek.value]! : defaultExercises(),
  )

  /** The visible week's own plan, copied from what it shows on its first change. */
  function own(): Exercise[] {
    return (plans.value[weekKey.value] ??= copyPlan(exercises.value))
  }

  const days = computed<Day[]>(() => {
    const todayKey = dateKey(now.value)
    return weekDates(monday.value).map((d, i) => ({
      name: DAY_NAMES[i]!,
      date: String(d.getDate()),
      full: fullDate(d),
      key: dateKey(d),
      isToday: dateKey(d) === todayKey,
      // Keys are YYYY-MM-DD, so they compare as dates.
      isFuture: dateKey(d) > todayKey,
    }))
  })

  function isDone(id: string, day: number): boolean {
    return tracker.isDone(week.value, id, day)
  }

  function markOf(id: string, day: number): Mark | null {
    return tracker.markOf(week.value, id, day)
  }

  function totalFor(id: string): number {
    return tracker.totalFor(week.value, id)
  }

  const dayCounts = computed(() => tracker.dayCounts(exercises.value, week.value))
  const grandTotal = computed(() => tracker.grandTotal(exercises.value, week.value))

  // Any change to a week, marks included, gives it its own plan, so later edits to the week it was
  // carried from no longer move it.
  /**
   * Steps the day to its next mark: great, partial and missed in each drawing, then empty; in a
   * tick or face set, the three kinds once (K21).
   */
  function toggle(id: string, day: number): void {
    own()
    tracker.cycleDay(log.value, weekKey.value, id, day, tracker.cycleFor('exercise', markSet.value))
  }

  function changeTarget(id: string, delta: number): void {
    const e = own().find((x) => x.id === id)
    if (e) e.target = clamp(e.target + delta, MIN_TARGET, MAX_TARGET)
  }

  /**
   * Adds an exercise to this week; returns its id, or null (and adds nothing) when the trimmed name
   * is empty. Its notes are its details (the details store), not the week's.
   */
  function addExercise(input: NewExercise): string | null {
    const fields = exerciseFields(input)
    if (!fields) return null
    const target = clamp(input.target ?? NEW_EXERCISE_TARGET, MIN_TARGET, MAX_TARGET)
    const id = tracker.newId()
    own().push({ id, ...fields, target })
    return id
  }

  /**
   * Replaces name, sets, reps, per-side and weight this week, keeping the id and history; the goal
   * stays as it is when the input leaves it out.
   */
  function updateExercise(id: string, input: NewExercise): boolean {
    const fields = exerciseFields(input)
    if (!fields || !exercises.value.some((e) => e.id === id)) return false
    const list = own()
    const i = list.findIndex((e) => e.id === id)
    const target = clamp(input.target ?? list[i]!.target, MIN_TARGET, MAX_TARGET)
    list[i] = { id, ...fields, target }
    return true
  }

  /** Removes the exercise from this week; its log history stays in storage. */
  function removeExercise(id: string): void {
    plans.value[weekKey.value] = own().filter((e) => e.id !== id)
  }

  function setConfigMode(on: boolean): void {
    configMode.value = on
  }

  function prevWeek(): void {
    weekOffset.value -= 1
  }
  function nextWeek(): void {
    weekOffset.value += 1
  }
  function thisWeek(): void {
    weekOffset.value = 0
  }
  /** Moves "today" only when the calendar date has changed, so periodic calls are free. */
  function refreshNow(): void {
    const next = new Date()
    if (dateKey(next) !== dateKey(now.value)) now.value = next
  }

  /** Replace the user's data wholesale: from the cache, the server, or another tab. */
  function adopt(data: PlannerData, settings: PortableSettings | null): void {
    plans.value = data.plans
    log.value = data.log
    accent.value = settings?.accent ?? DEFAULT_SETTINGS.accent
    dailyPick.value = settings?.dailyPick ?? DEFAULT_SETTINGS.dailyPick
    foodPick.value = settings?.foodPick ?? DEFAULT_SETTINGS.foodPick
    itemSections.value = normaliseItemSections(settings?.itemSections)
    settingsSaved.value = settings !== null
  }

  /** Replace one week's plan, e.g. with the server's copy after a conflict. */
  function adoptWeek(week: string, items: Exercise[]): void {
    plans.value[week] = items
  }

  /**
   * Forget the user's data on sign-out, their items' details included (the session clears the
   * planner whenever it clears the user's data); the theme stays with the device.
   */
  function clear(): void {
    adopt({ plans: {}, log: {} }, null)
    useDetailsStore().clear()
    configMode.value = false
    weekOffset.value = 0
  }

  function changeDailyPick(delta: number): void {
    dailyPick.value = clamp(dailyPick.value + delta, MIN_DAILY_PICK, MAX_DAILY_PICK)
    settingsSaved.value = true
  }
  function changeFoodPick(delta: number): void {
    foodPick.value = clamp(foodPick.value + delta, MIN_DAILY_PICK, MAX_DAILY_PICK)
    settingsSaved.value = true
  }
  function setTheme(next: Theme): void {
    theme.value = next
  }

  /** A type's item-page arrangement, as a copy: the default while it has none. */
  function arrangementFor(type: TrackerTypeId): Arrangement {
    return arrangementOf(itemSections.value, type)
  }
  /** Every page of `type` takes this arrangement at once, and it syncs like the other settings. */
  function setArrangement(type: TrackerTypeId, arrangement: Arrangement): void {
    itemSections.value = withArrangement(itemSections.value, type, arrangement)
    settingsSaved.value = true
  }

  /**
   * The accent, daily picks and item pages' arrangement (left out while every page has the
   * default), or null while no settings have been stored, changed or imported.
   */
  function savedSettings(): PortableSettings | null {
    if (!settingsSaved.value) return null
    return {
      accent: accent.value,
      dailyPick: dailyPick.value,
      foodPick: foodPick.value,
      ...(Object.keys(itemSections.value).length
        ? { itemSections: normaliseItemSections(itemSections.value) }
        : {}),
    }
  }

  // Only the theme is written to the device's settings key, merged into what is there: it is
  // what public/theme-init.js reads before first paint, and the accent and daily pick saved by
  // the app before accounts existed stay untouched for the first-login import.
  watch(theme, (next) => {
    const stored = parseJson(readKey(SETTINGS_KEY))
    writeKey(SETTINGS_KEY, { ...(isRecord(stored) ? stored : {}), theme: next })
  })
  watch(markSet, (next) => {
    const stored = parseJson(readKey(SETTINGS_KEY))
    writeKey(SETTINGS_KEY, { ...(isRecord(stored) ? stored : {}), markSet: next })
  })

  return {
    markSet,
    plans,
    exercises,
    log,
    weekOffset,
    accent,
    dailyPick,
    foodPick,
    itemSections,
    theme,
    now,
    monday,
    weekKey,
    currentWeekKey,
    label,
    days,
    dayCounts,
    grandTotal,
    isDone,
    markOf,
    totalFor,
    toggle,
    changeTarget,
    addExercise,
    updateExercise,
    removeExercise,
    configMode,
    setConfigMode,
    prevWeek,
    nextWeek,
    thisWeek,
    refreshNow,
    adopt,
    adoptWeek,
    clear,
    changeDailyPick,
    changeFoodPick,
    setTheme,
    arrangementFor,
    setArrangement,
    savedSettings,
  }
})
