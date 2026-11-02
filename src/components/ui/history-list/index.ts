import { addDays } from '@/lib/dates'

export { default as HistoryList } from './HistoryList.vue'

/** One past conversation in the HistoryList (brand/design-system/project/components/HistoryList). */
export interface HistoryItem {
  id: string
  /** The conversation's first question. */
  title: string
  /** When it last changed, in Unix seconds. */
  updatedAt: number
}

export interface HistoryGroup {
  label: 'Today' | 'Last week' | 'Earlier'
  items: HistoryItem[]
}

/**
 * The list's groups, in local days: Today from midnight, Last week the seven days before today,
 * and Earlier. The items keep the order given (newest first), and a group with none is left out.
 * A time after `now` (another device's clock) counts as today.
 */
export function groupHistory(items: readonly HistoryItem[], now: Date): HistoryGroup[] {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const weekBefore = addDays(today, -7).getTime() / 1000
  const midnight = today.getTime() / 1000
  const groups: HistoryGroup[] = [
    { label: 'Today', items: [] },
    { label: 'Last week', items: [] },
    { label: 'Earlier', items: [] },
  ]
  for (const item of items) {
    const at = item.updatedAt >= midnight ? 0 : item.updatedAt >= weekBefore ? 1 : 2
    groups[at]!.items.push(item)
  }
  return groups.filter((g) => g.items.length > 0)
}
