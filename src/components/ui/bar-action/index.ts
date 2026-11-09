import { cva } from 'class-variance-authority'

export { default as BarAction } from './BarAction.vue'

/**
 * One of the Header's actions (brand/design-system/project/components/BarAction): a Lucide icon
 * over its name, sized from the Header's `--bar-*` sizes so it follows the screen (K47). Quiet:
 * tile on hover; a toggle that is on (aria-pressed) takes the ink fill (K48). Never the pen. The
 * `filled` Done went with K91: E, Esc and a long press leave Edit plan.
 */
export const barActionVariants = cva([
  'inline-flex min-h-11 min-w-(--bar-tile-min) shrink-0 cursor-pointer flex-col items-center justify-center',
  'gap-(--bar-tile-gap) rounded-md border-0 px-(--bar-tile-pad-x) py-(--bar-tile-pad-y)',
  'bg-transparent text-ink hover:bg-tile aria-pressed:bg-ink aria-pressed:text-on-ink',
  'motion-safe:transition-[color,background-color] motion-safe:duration-120 motion-safe:ease-out',
  '[&_svg]:pointer-events-none [&_svg]:size-(--bar-icon) [&_svg]:shrink-0',
])
