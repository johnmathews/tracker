import { cva } from 'class-variance-authority'

export { default as Menu } from './Menu.vue'
export { default as MenuItem } from './MenuItem.vue'

/**
 * The menu panel (brand/design-system/project/components/Menu): panel fill, 1px line border,
 * radius-lg, the overlay shadow (none in dark), space-2 padding, 288px wide but never wider or
 * taller than the screen allows (it scrolls instead). It appears with at most a 120ms fade, none
 * under reduced motion, and doesn't print. The panel itself draws no ring: Reka focuses it only on
 * a pointer open, and the keyboard's focus is always on an item, which takes the global ring.
 */
export const menuVariants = cva([
  'z-50 w-72 max-w-(--reka-dropdown-menu-content-available-width) rounded-lg border border-line',
  'max-h-(--reka-dropdown-menu-content-available-height) overflow-y-auto overscroll-contain',
  'bg-panel p-2 text-ink shadow-overlay outline-none print:hidden',
  'motion-safe:transition-opacity motion-safe:duration-120 motion-safe:ease-out starting:opacity-0',
])

/**
 * One item: at least 48px tall, space-3 side padding, a 22px Lucide icon then its name in label
 * type, radius-md, and a tile fill while highlighted (under the pointer or the arrow keys).
 * Keyboard focus adds the global solid 2px focus ring (main.css).
 */
export const menuItemVariants = cva([
  'flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-left label text-ink select-none',
  'data-highlighted:bg-tile',
  'motion-safe:transition-[background-color] motion-safe:duration-120 motion-safe:ease-out',
  '[&_svg]:pointer-events-none [&_svg]:size-5.5 [&_svg]:shrink-0',
])
