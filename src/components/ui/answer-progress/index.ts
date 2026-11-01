export { default as AnswerProgress } from './AnswerProgress.vue'

/**
 * One of the pen's three strokes (brand/design-system/project/components/AnswerProgress): 10px by
 * 3px in ink. At rest, and under reduced motion, it is a still 35%; with motion it is full ink
 * dimming to half and back over 1.2s (Tailwind's pulse), each stroke a fifth of a second after the
 * one before, like a pen writing.
 */
export const STROKE = [
  'block h-[3px] w-2.5 rounded-[2px] bg-ink opacity-35',
  'motion-safe:animate-pulse motion-safe:opacity-100 motion-safe:[animation-duration:1.2s] motion-safe:[animation-timing-function:ease-in-out]',
].join(' ')

export const STROKE_DELAYS = [
  '',
  'motion-safe:[animation-delay:200ms]',
  'motion-safe:[animation-delay:400ms]',
] as const
