import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'

export { default as InlineMessage } from './InlineMessage.vue'

/**
 * A one- or two-line message beside what it is about
 * (brand/design-system/project/components/InlineMessage): `caption` text after a 16px icon,
 * space-2 apart, with no box and no fill. Error is error-ink, caution (a warning to read before
 * acting, such as the consent screen's; nothing on the planner uses it, K28) caution-ink, success
 * ink (never the pen: pen means a done session, not a done task), info ink-secondary. It appears
 * and goes without motion.
 */
export const inlineMessageVariants = cva('caption flex items-start gap-2', {
  variants: {
    tone: {
      error: 'text-error-ink',
      caution: 'text-caution-ink',
      success: 'text-ink',
      info: 'text-ink-secondary',
    },
  },
  defaultVariants: {
    tone: 'error',
  },
})

export type InlineMessageVariants = VariantProps<typeof inlineMessageVariants>
export type InlineMessageTone = NonNullable<InlineMessageVariants['tone']>
