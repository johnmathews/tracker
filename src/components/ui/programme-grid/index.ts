export { default as ProgrammeGrid } from './ProgrammeGrid.vue'

/**
 * main.css's `folded` variant as a media query, for script: a phone, or an iPad held upright. The
 * grid opens on this week there (ProgrammeGrid card). Keep it the same as main.css's.
 */
export const FOLDED =
  'screen and (orientation: portrait) and (width < 1000px), screen and (width < 760px)'
