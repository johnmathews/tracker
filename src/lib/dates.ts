export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** Local-midnight Monday of the week containing `now`, shifted by `weekOffset` weeks. */
export function mondayOf(now: Date, weekOffset = 0): Date {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + weekOffset * 7)
  return d
}

/** `YYYY-MM-DD` in local time — the key format the prototype stores in `log`. */
export function dateKey(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d)
  out.setDate(d.getDate() + days)
  return out
}

/** The seven dates Mon–Sun starting at `monday`. */
export function weekDates(monday: Date): Date[] {
  return DAY_NAMES.map((_, i) => addDays(monday, i))
}

/** "26 October": a date as the app's sentences write it (voice.md). */
export function dayMonth(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
}

/**
 * The Header's week label (components/Header): "19–25 October" within a month, and
 * "28 Sep – 4 Oct" across one, short enough for a 320px screen.
 */
export function weekRange(monday: Date): string {
  const sunday = addDays(monday, 6)
  if (sunday.getMonth() === monday.getMonth()) return `${monday.getDate()}–${dayMonth(sunday)}`
  const short = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `${short(monday)} – ${short(sunday)}`
}

/** The year, after a space, when `d` is not in `now`'s year; otherwise nothing. */
function otherYear(d: Date, now: Date): string {
  return d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`
}

/**
 * The page heading: the Header's week label, plus the year when the week ends in another year
 * than today's ("19–25 October", "28 Dec – 3 Jan 2027"). The year is the Sunday's.
 */
export function weekTitle(monday: Date, now: Date): string {
  return weekRange(monday) + otherYear(addDays(monday, 6), now)
}

/**
 * The ISO 8601 week of the week starting `monday`: the week holding the Thursday, numbered from
 * the year's first such week, and that Thursday's year (the week-year). Weeks start on Monday, as
 * the app's do.
 */
export function isoWeek(monday: Date): { week: number; year: number } {
  const thursday = addDays(mondayOf(monday), 3)
  const year = thursday.getFullYear()
  // 4 January is always in week 1, so week 1's Thursday is the Thursday of 4 January's week.
  const firstThursday = addDays(mondayOf(new Date(year, 0, 4)), 3)
  // Rounded, so a clock change between the two dates can't shift the count.
  const days = Math.round((thursday.getTime() - firstThursday.getTime()) / 86_400_000)
  return { week: days / 7 + 1, year }
}

/**
 * The week as its number (K131): "Week 46", with the week-year after a comma when it isn't the
 * one `now` is in ("Week 1, 2027"), unless `withYear` is false, as in the bar.
 */
export function weekNumber(monday: Date, now: Date, withYear = true): string {
  const { week, year } = isoWeek(monday)
  const other = withYear && year !== isoWeek(now).year
  return other ? `Week ${week}, ${year}` : `Week ${week}`
}

/** "Thursday 22 October": a day written in full, as DayMark's accessible name says it. */
export function fullDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}
