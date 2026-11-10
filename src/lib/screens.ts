/**
 * A planner screen (PlannerScreen card, K24): on the planner's screens a section fills the screen
 * under the fixed week (K88), and its content (the SectionHeader over the WeekGrid) sits in the
 * middle, at the top when folded. The section also carries `data-planner-screen`, which
 * useScreenSprint finds it by (K38). In Edit plan each section is a screen too, at least the window
 * less the sticky bar (`--bar-height`, measured by AppNavbar), its content from the top and any
 * space over left empty at its foot (K99). On paper it is an ordinary section.
 */
export const SCREEN =
  'full:flex full:min-h-[calc(100dvh-var(--week-band))] full:flex-col full:justify-center full:px-(--screen-pad-x) full:pt-(--screen-gap-top) full:pb-(--screen-pad-bottom) short:pt-2 short:pb-1.5 folded:justify-start edit:mt-0 edit:flex edit:min-h-[calc(100dvh-var(--bar-height,0px))] edit:flex-col edit:border-0 edit:pt-12 edit:pb-(--screen-pad-bottom)'

/** The WeekGrid on a screen: it takes the height the SectionHeader leaves. */
export const SCREEN_GRID = 'full:min-h-0 full:flex-1 folded:flex-none'
