import { cva } from 'class-variance-authority'

export { default as Checkbox } from './Checkbox.vue'

/**
 * The Checkbox row (brand/design-system/project/components/Checkbox): a role="checkbox" button at
 * least 48px tall holding the box and the label in body ink; the whole row is the target. Focus
 * is the global solid 2px outline round the row (main.css). Only `disabled` fades, to 40%.
 */
export const checkboxVariants = cva([
  'group/checkbox flex min-h-12 cursor-pointer items-center gap-3 rounded-sm bg-transparent p-0',
  'body text-left text-ink',
  'disabled:cursor-not-allowed disabled:opacity-40',
])

/**
 * The 24px box: a 2px control border on panel, ink on hover; ticked, filled ink. Only colours
 * transition.
 */
export const checkboxBoxVariants = cva([
  'grid size-6 flex-none place-content-center rounded-sm border-2 border-control-border bg-panel',
  'group-hover/checkbox:group-enabled/checkbox:border-ink',
  'group-data-[state=checked]/checkbox:border-ink group-data-[state=checked]/checkbox:bg-ink',
  'motion-safe:transition-[color,background-color,border-color] motion-safe:duration-120 motion-safe:ease-out',
])
