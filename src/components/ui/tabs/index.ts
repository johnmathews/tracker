import { cva } from 'class-variance-authority'

export { default as Tabs } from './Tabs.vue'
export { default as TabsList } from './TabsList.vue'
export { default as TabsTrigger } from './TabsTrigger.vue'
export { default as TabsContent } from './TabsContent.vue'

/**
 * The bar (brand/design-system/project/components/Tabs): the tabs in a row, space-8 apart, that
 * wraps onto a second line on a phone rather than shrinking or scrolling sideways, with a 1px line
 * rule under the whole bar. Doesn't print.
 */
export const tabsListVariants = cva(['flex flex-wrap gap-x-8 border-b border-line print:hidden'])

/**
 * One tab: its name alone, body size at 600 in ink-secondary, at least 44px tall with no side
 * padding. Hover turns the name ink. The open tab is ink with a 3px ink rule under its name, drawn
 * inside the tab so its height never changes. Its focus ring is the global solid 2px one.
 */
export const tabsTriggerVariants = cva([
  'inline-flex min-h-11 items-center bg-transparent py-2 body font-semibold whitespace-nowrap text-ink-secondary',
  'hover:text-ink data-[state=active]:text-ink data-[state=active]:shadow-[inset_0_-3px_0_var(--color-ink)]',
  'motion-safe:transition-[color] motion-safe:duration-120 motion-safe:ease-out',
])
