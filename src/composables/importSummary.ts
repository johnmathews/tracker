import { useAskStore } from '@/stores/ask'
import { useDietStore } from '@/stores/diet'
import { usePlannerStore } from '@/stores/planner'
import { mergeSummary, type ExportData } from '@/lib/transfer'
import { countOf } from '@/lib/words'

export type Additions = {
  plans: number
  ticks: number
  /** The file's settings apply: the account has none of its own. */
  settings: boolean
  /** The file's My goals fill goals that are empty (F17): a change on its own. */
  goals: boolean
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
  const diet = useDietStore()
  const ask = useAskStore()

  function additions(data: ExportData): Additions {
    const ex = mergeSummary({ plans: planner.plans, log: planner.log }, data.exercise)
    const di = mergeSummary({ plans: diet.plans, log: diet.log }, data.diet)
    const here = new Set(ask.conversations.map((c) => c.id))
    // Exercise and food plans count separately: a week can gain either or both.
    return {
      plans: ex.weeks + di.weeks,
      ticks: ex.ticks + di.ticks,
      settings: data.settings !== null && planner.savedSettings() === null,
      // As mergeSettings: the file's goals fill empty ones, and never replace any.
      goals: !!data.settings?.goals && !planner.goals,
      conversations: (data.conversations ?? []).filter((c) => !here.has(c.id)).length,
    }
  }

  function addsAnything(data: ExportData): boolean {
    const a = additions(data)
    return a.plans > 0 || a.ticks > 0 || a.settings || a.goals || a.conversations > 0
  }

  function describe(data: ExportData): string {
    const { plans, ticks, settings, goals, conversations } = additions(data)
    // The settings as Edit plan names them: Exercises a day and Foods a day (K56). The file's
    // accent comes too, but nothing shows it any more, so the summary leaves it out.
    const extras: string[] = []
    if (settings) extras.push('the exercises and foods a day')
    if (goals) extras.push('your goals')
    if (conversations) extras.push(`${countOf(conversations, 'conversation')} from Ask`)
    const extra = extras.length ? `, plus ${listed(extras)}` : ''
    return `Adds ${countOf(plans, 'weekly plan')} and ${countOf(ticks, 'marked day')}${extra}. Existing plans and marks stay as they are.`
  }

  return { additions, addsAnything, describe }
}
