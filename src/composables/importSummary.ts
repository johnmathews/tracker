import { useDetailsStore } from '@/stores/details'
import { useDietStore } from '@/stores/diet'
import { usePlannerStore } from '@/stores/planner'
import { mergeSummary, type ExportData } from '@/lib/transfer'
import { countOf } from '@/lib/words'

/** Weekly plans, marked days, items gaining notes or details, and whether the settings apply. */
export type Additions = { plans: number; ticks: number; details: number; settings: boolean }

/**
 * What importing export data would add to the signed-in user's state, and that as a sentence.
 * Shared by Settings → Import… and the first-login prompt. Both read the stores each time they
 * render, so the answer stays true when another tab or a settings change gets there first.
 */
export function useImportSummary() {
  const planner = usePlannerStore()
  const diet = useDietStore()
  const details = useDetailsStore()

  function additions(data: ExportData): Additions {
    const ex = mergeSummary(
      { plans: planner.plans, log: planner.log, details: details.docs.exercise },
      data.exercise,
    )
    const di = mergeSummary(
      { plans: diet.plans, log: diet.log, details: details.docs.diet },
      data.diet,
    )
    // Exercise and food plans count separately: a week can gain either or both.
    return {
      plans: ex.weeks + di.weeks,
      ticks: ex.ticks + di.ticks,
      details: ex.details + di.details,
      settings: data.settings !== null && planner.savedSettings() === null,
    }
  }

  function addsAnything(data: ExportData): boolean {
    const a = additions(data)
    return a.plans > 0 || a.ticks > 0 || a.details > 0 || a.settings
  }

  function describe(data: ExportData): string {
    const { plans, ticks, details: items, settings } = additions(data)
    // Notes and fields come once per item (D2), so they count by item. The settings as Edit plan
    // names them: Exercises a day and Foods a day (K56). The file's accent comes too, but nothing
    // shows it any more, so the summary leaves it out.
    const extras = [
      ...(items ? [`the notes and details of ${countOf(items, 'item')}`] : []),
      ...(settings ? ['the exercises and foods a day'] : []),
    ]
    const extra = extras.length ? `, plus ${extras.join(' and ')}` : ''
    return `Adds ${countOf(plans, 'weekly plan')} and ${countOf(ticks, 'marked day')}${extra}. Existing plans and marks stay as they are.`
  }

  return { additions, addsAnything, describe }
}
