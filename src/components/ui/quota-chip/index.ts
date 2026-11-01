export { default as QuotaChip } from './QuotaChip.vue'

const WORDS = ['No', 'One', 'Two', 'Three'] as const

/**
 * The QuotaChip's words (brand/design-system/project/components/QuotaChip): "27 questions left
 * today", then words from three down, as small numbers in a sentence are (voice.md), to "No
 * questions left today". A count outside 0 to `limit` is held to it.
 */
export function questionsLeft(remaining: number, limit: number): string {
  const left = Math.max(0, Math.min(Math.floor(remaining), limit))
  const count = WORDS[left] ?? String(left)
  return `${count} ${left === 1 ? 'question' : 'questions'} left today`
}
