/**
 * The item page's layout (ItemPage card), shared by an item's page and the new item page (K104):
 * Tailwind class lists, at the Settings page's sizes (K51).
 */

/** The plan's and the details' controls: in columns at least 300u wide, two to a row on a laptop
 * (ItemPage card). */
export const FIELDS =
  'grid grid-cols-[repeat(auto-fill,minmax(min(100%,calc(var(--u)*300)),1fr))] items-start gap-x-[calc(var(--u)*28)] gap-y-[calc(var(--u)*24)] folded:grid-cols-1 folded:gap-5'
/**
 * A section of the page, a row like Settings' (K51, K65): a line rule above it, its h2 in the
 * week's name column (320u), its content beside it, 32u above and below. Folded, the heading over
 * its content; on paper the same, with no rule.
 */
export const ROW =
  'grid grid-cols-[var(--grid-name-w)_minmax(0,1fr)] items-start border-t border-line py-(--set-sec-y) folded:flex folded:flex-col folded:items-stretch folded:gap-4 print:flex print:flex-col print:gap-[calc(var(--u)*18)] print:border-0'
/**
 * A row while arranging (K66): the same columns, 14u above and below, the heading with its
 * controls under it (on its line, folded) and one word beside it.
 */
export const ARRANGE_ROW =
  'grid grid-cols-[var(--grid-name-w)_minmax(0,1fr)] items-center border-t border-line py-[calc(var(--u)*14)] folded:flex folded:flex-col folded:items-stretch'
/** Show, Move up and Move down at Edit plan's row-button size (K54), with the page's icons. */
export const MOVE = 'size-(--edit-ib) [&_svg]:size-(--set-icon)'
/** A row's content, to the right of its heading. */
export const BODY = 'flex min-w-0 flex-col gap-[calc(var(--u)*20)] folded:gap-4'
/** A section's heading. */
export const H2 = 'title-2 text-(length:--set-h2) leading-tight text-ink'
/** The line under a heading, in ink-secondary. */
export const LEDE = 'body max-w-[60ch] text-(length:--set-text) leading-normal text-ink-secondary'
