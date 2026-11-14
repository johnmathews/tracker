import { useAskStore } from '@/stores/ask'
import { useDetailsStore } from '@/stores/details'
import { usePlannerStore } from '@/stores/planner'
import { useTrackersStore } from '@/stores/trackers'
import { SECTIONS, isSection } from '@/lib/trackerTypes'
import { mergeSummary, type ExportData } from '@/lib/transfer'
import { countOf } from '@/lib/words'

export type Additions = {
  /** Trackers the account doesn't have yet (K123). */
  trackers: number
  plans: number
  ticks: number
  /** Items gaining notes or details. */
  details: number
  /** The file's settings apply: the account has none of its own. */
  settings: boolean
  /** The file's My goals fill goals that are empty (K72): a change on its own. */
  goals: boolean
  /** The file's limits fill limits that are empty (K107), as the goals do. */
  limits: boolean
  /** Ask conversations whose id the account doesn't have yet. */
  conversations: number
}

/** "a", "a and b", "a, b and c". */
function listed(parts: string[]): string {
  return parts.length < 3
    ? parts.join(' and ')
    : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

/**
 * What importing export data would add to the signed-in user's state, and that as a sentence.
 * Shared by Settings → Import… and the first-login prompt. Both read the stores each time they
 * render, so the answer stays true when another tab or a settings change gets there first. The
 * conversations already here are the Ask store's list, which Settings loads when a file has any.
 */
export function useImportSummary() {
  const planner = usePlannerStore()
  const trackers = useTrackersStore()
  const ask = useAskStore()
  const details = useDetailsStore()

  function additions(data: ExportData): Additions {
    const kinds = new Map(data.trackers.map((t) => [t.id, t.kind]))
    let [plans, ticks, items] = [0, 0, 0]
    // Each tracker's plans count separately: a week can gain any of them. Data for no tracker of
    // the file's, or for one the account has as another kind, is skipped, as the API's import
    // skips it.
    for (const [id, incoming] of Object.entries(data.sections)) {
      const kind = kinds.get(id) ?? (isSection(id) ? SECTIONS[id].id : null)
      if (kind === null || (trackers.has(id) && trackers.kindOf(id) !== kind)) continue
      const added = mergeSummary(
        {
          plans: trackers.plansOf(id),
          log: trackers.logOf(id),
          details: Object.hasOwn(details.docs, id) ? details.docs[id]! : {},
        },
        incoming,
      )
      plans += added.weeks
      ticks += added.ticks
      items += added.details
    }
    const here = new Set(ask.conversations.map((c) => c.id))
    return {
      trackers: data.trackers.filter((t) => !trackers.has(t.id)).length,
      plans,
      ticks,
      details: items,
      settings: data.settings !== null && planner.savedSettings() === null,
      // As mergeSettings: the file's goals fill empty ones, and never replace any.
      goals: !!data.settings?.goals && !planner.goals,
      limits: !!data.settings?.limits && !planner.limits,
      conversations: (data.conversations ?? []).filter((c) => !here.has(c.id)).length,
    }
  }

  function addsAnything(data: ExportData): boolean {
    const a = additions(data)
    return (
      a.trackers > 0 ||
      a.plans > 0 ||
      a.ticks > 0 ||
      a.details > 0 ||
      a.settings ||
      a.goals ||
      a.limits ||
      a.conversations > 0
    )
  }

  function describe(data: ExportData): string {
    const {
      trackers: added,
      plans,
      ticks,
      details: items,
      settings,
      goals,
      limits,
      conversations,
    } = additions(data)
    // Notes and fields come once per item (D2), so they count by item. The settings as Edit plan
    // names them: Exercises a day and Foods a day (K56). The file's accent comes too, but nothing
    // shows it any more, so the summary leaves it out.
    const extras: string[] = []
    if (added) extras.push(countOf(added, 'tracker'))
    if (items) extras.push(`the notes and details of ${countOf(items, 'item')}`)
    if (settings) extras.push('the exercises and foods a day')
    if (goals) extras.push('your goals')
    if (limits) extras.push('your limits')
    if (conversations) extras.push(`${countOf(conversations, 'conversation')} from Ask`)
    const extra = extras.length ? `, plus ${listed(extras)}` : ''
    return `Adds ${countOf(plans, 'weekly plan')} and ${countOf(ticks, 'marked day')}${extra}. Existing plans and marks stay as they are.`
  }

  return { additions, addsAnything, describe }
}
