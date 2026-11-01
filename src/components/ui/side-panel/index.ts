export { default as SidePanel } from './SidePanel.vue'

/**
 * main.css's `folded` variant as a media query, for script: a phone, or an iPad held upright. Keep
 * the two the same.
 */
export const FOLDED =
  'screen and (orientation: portrait) and (width < 1000px), screen and (width < 760px)'
