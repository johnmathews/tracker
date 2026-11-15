import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  DAY_NAMES,
  dateKey,
  fullDate,
  mondayOf,
  weekDates,
  weekNumber,
  weekRange,
  weekTitle as weekTitleOf,
} from '@/lib/dates'
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  isRecord,
  normaliseGoals,
  normaliseLimits,
  parseJson,
  parseSettings,
  readKey,
  writeKey,
  type KnownSettings,
  type MarkSet,
  type WeekTitle,
} from '@/lib/storage'
import type { Theme } from '@/lib/theme'
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

/**
 * The settings the planner keeps: everything the person owns but the daily targets, which live on
 * their trackers (K123). The sync store adds `dailyPick` and `foodPick` from the `exercise` and
 * `diet` trackers wherever settings are sent or cached, so a tab on older code still reads them.
 */
export type PlannerSettings = Omit<KnownSettings, 'dailyPick' | 'foodPick'>

/** The chips under an exercise name: the strength kind's (src/lib/trackerTypes.ts). */
export { exerciseDetails } from '@/lib/trackerTypes'

export const usePlannerStore = defineStore('planner', () => {
  /** "Now" as a ref so the today column moves when the tab is revisited after midnight. */
  const now = ref(new Date())
  /** Monday of the real current week, whichever week is on screen. */
  const currentWeekKey = computed(() => dateKey(mondayOf(now.value, 0)))

  // The accent and goals are the signed-in user's: the sync store fills them through `adopt` and
  // saves them. Each tracker's plans, log and daily target are the trackers store's. Only the
  // theme and the mark set belong to the device, and are stored here. The accent no longer draws
  // anything, since the marks' pens are fixed (DayMark card); it is kept as it was saved, so the
  // server and exports still agree. Nothing in the app changes it now.
  const weekOffset = ref(0)
  const accent = ref(DEFAULT_SETTINGS.accent)
  /** My goals, in the person's words; Ask and the MCP read them. */
  const goals = ref(DEFAULT_SETTINGS.goals)
  /**
   * Whether `goals` came from the server, a cache that carried them, or the person. Until then
   * they are a stand-in, and are never sent or cached: a tab that hasn't read them would erase the
   * saved ones (F1).
   */
  const goalsKnown = ref(false)
  /** Your limits (K107): what the person has to work around, read like the goals. */
  const limits = ref(DEFAULT_SETTINGS.limits)
  /** Whether `limits` are known, as `goalsKnown` (a tab from before them carries goals only). */
  const limitsKnown = ref(false)
  /** Daily goal (K85): on unless the person turned it off; the daily targets are kept either way. */
  const dailyGoal = ref(DEFAULT_SETTINGS.dailyGoal)
  /** Whether `dailyGoal` came from the server, a cache that carried it, or the person (as goals). */
  const dailyGoalKnown = ref(false)
  /** The week's title, its dates or its number (K131), saved with the account (K132). */
  const weekTitle = ref<WeekTitle>(DEFAULT_SETTINGS.weekTitle)
  /** Whether `weekTitle` came from the server, a cache that carried it, or the person. */
  const weekTitleKnown = ref(false)
  /** Each kind's item-page arrangement (K66); a kind left out shows every section in order. */
  const itemSections = ref<ItemSections>({})
  const theme = ref<Theme>(parseSettings(readKey(SETTINGS_KEY)).theme)
  const markSet = ref<MarkSet>(parseSettings(readKey(SETTINGS_KEY)).markSet)
  /** Whether the user has settings of their own (from the server, a change, or an import). */
  const settingsSaved = ref(false)
  /** Config mode shows the plan-editing controls; normal mode only ticks cells. Not persisted. */
  const configMode = ref(false)

  const monday = computed(() => mondayOf(now.value, weekOffset.value))
  const weekKey = computed(() => dateKey(monday.value))
  /** Whether another week than this one is on screen: "This week" shows (K130). */
  const otherWeek = computed(() => weekKey.value !== currentWeekKey.value)
  /** The week's dates, with the year when it isn't this one: "19–25 October". */
  const dates = computed(() => weekTitleOf(monday.value, now.value))
  /**
   * The page heading, in the band and on paper: the dates, or "Week 46" (K131), each with its
   * year when it isn't this one.
   */
  const label = computed(() =>
    weekTitle.value === 'number' ? weekNumber(monday.value, now.value) : dates.value,
  )
  /** The bar's label, without a year: "19–25 October" or "Week 46". */
  const barLabel = computed(() =>
    weekTitle.value === 'number'
      ? weekNumber(monday.value, now.value, false)
      : weekRange(monday.value),
  )

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

  /**
   * Replace the user's settings wholesale: from the cache, the server, or another tab. Settings
   * without goals (a tab from before My goals wrote them) keep the goals this tab has, those
   * without limits keep its limits (K107), and those without Daily goal its Daily goal (K85). The
   * daily picks they carry are the trackers' (K123), which the trackers store adopts.
   */
  function adopt(settings: KnownSettings | PlannerSettings | null): void {
    accent.value = settings?.accent ?? DEFAULT_SETTINGS.accent
    if (settings?.goals !== undefined) {
      goals.value = settings.goals
      goalsKnown.value = true
    }
    if (settings?.limits !== undefined) {
      limits.value = settings.limits
      limitsKnown.value = true
    }
    if (settings?.dailyGoal !== undefined) {
      dailyGoal.value = settings.dailyGoal
      dailyGoalKnown.value = true
    }
    if (settings?.weekTitle !== undefined) {
      weekTitle.value = settings.weekTitle
      weekTitleKnown.value = true
    }
    itemSections.value = normaliseItemSections(settings?.itemSections)
    settingsSaved.value = settings !== null
  }

  /**
   * Forget the user's settings on sign-out, their items' details included (the session clears the
   * planner and the trackers store whenever it clears the user's data); the theme stays with the
   * device.
   */
  function clear(): void {
    adopt(null)
    goals.value = DEFAULT_SETTINGS.goals
    goalsKnown.value = false
    limits.value = DEFAULT_SETTINGS.limits
    limitsKnown.value = false
    dailyGoal.value = DEFAULT_SETTINGS.dailyGoal
    dailyGoalKnown.value = false
    weekTitle.value = DEFAULT_SETTINGS.weekTitle
    weekTitleKnown.value = false
    useDetailsStore().clear()
    configMode.value = false
    weekOffset.value = 0
  }

  /**
   * The person's goals, normalised as the API stores them. The same text again is no change, so it
   * sends nothing. The Profile page calls it when the person stops typing, not on each key (F18).
   */
  function setGoals(text: string): void {
    const next = normaliseGoals(text)
    if (next === goals.value) return
    goals.value = next
    goalsKnown.value = true
    settingsSaved.value = true
  }
  /** The person's limits (K107), as `setGoals` sets the goals. */
  function setLimits(text: string): void {
    const next = normaliseLimits(text)
    if (next === limits.value) return
    limits.value = next
    limitsKnown.value = true
    settingsSaved.value = true
  }
  /** Daily goal on or off (K85), from Settings. The daily targets stay as they are. */
  function setDailyGoal(on: boolean): void {
    if (dailyGoalKnown.value && on === dailyGoal.value) return
    dailyGoal.value = on
    dailyGoalKnown.value = true
    settingsSaved.value = true
  }
  /** The week titled by its dates or its number (K131), from Settings; it syncs (K132). */
  function setWeekTitle(next: WeekTitle): void {
    if (weekTitleKnown.value && next === weekTitle.value) return
    weekTitle.value = next
    weekTitleKnown.value = true
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
   * The settings to send and cache, but the daily picks: the accent, the goals and the limits only
   * once each is known, and the item pages' arrangement (left out while every page has the
   * default).
   */
  function portableSettings(): PlannerSettings {
    return {
      accent: accent.value,
      ...(dailyGoalKnown.value ? { dailyGoal: dailyGoal.value } : {}),
      ...(weekTitleKnown.value ? { weekTitle: weekTitle.value } : {}),
      ...(goalsKnown.value ? { goals: goals.value } : {}),
      ...(limitsKnown.value ? { limits: limits.value } : {}),
      ...(Object.keys(itemSections.value).length
        ? { itemSections: normaliseItemSections(itemSections.value) }
        : {}),
    }
  }

  /** `portableSettings()`, or null while no settings have been stored, changed or imported. */
  function savedSettings(): PlannerSettings | null {
    return settingsSaved.value ? portableSettings() : null
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
    weekOffset,
    accent,
    goals,
    goalsKnown,
    limits,
    limitsKnown,
    dailyGoal,
    dailyGoalKnown,
    weekTitle,
    weekTitleKnown,
    setWeekTitle,
    otherWeek,
    dates,
    barLabel,
    itemSections,
    theme,
    now,
    monday,
    weekKey,
    currentWeekKey,
    label,
    days,
    configMode,
    setConfigMode,
    prevWeek,
    nextWeek,
    thisWeek,
    refreshNow,
    adopt,
    clear,
    setGoals,
    setLimits,
    setDailyGoal,
    setTheme,
    portableSettings,
    arrangementFor,
    setArrangement,
    savedSettings,
  }
})
