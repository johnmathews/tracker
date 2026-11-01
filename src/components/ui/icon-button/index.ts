import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'

export { default as IconButton } from './IconButton.vue'

/**
 * The icon-only button (brand/design-system/project/components/IconButton): a 44px square on
 * every layout, ink icon, tile on hover and while what it opens is open (aria-expanded). Quiet
 * has no border; outlined draws the control border. Only `disabled` fades, to 40%.
 */
export const iconButtonVariants = cva(
  [
    'inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-transparent',
    'bg-transparent p-0 text-ink hover:not-disabled:not-aria-disabled:bg-tile aria-expanded:bg-tile',
    // At an end (the item page's first Move up, K66) it stays focusable: the icon fades instead.
    'aria-disabled:cursor-default aria-disabled:[&_svg]:opacity-40',
    'disabled:cursor-not-allowed disabled:opacity-40',
    'motion-safe:transition-[color,background-color,border-color] motion-safe:duration-120 motion-safe:ease-out',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        quiet: '',
        outlined: 'border-control-border',
      },
    },
    defaultVariants: {
      variant: 'quiet',
    },
  },
)

export type IconButtonVariants = VariantProps<typeof iconButtonVariants>
