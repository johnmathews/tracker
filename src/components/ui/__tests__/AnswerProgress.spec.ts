import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { AnswerProgress } from '@/components/ui/answer-progress'

const css = readFileSync(join(import.meta.dirname, '../../../styles/main.css'), 'utf8')

describe('AnswerProgress', () => {
  it('is a status that reads its words once, the pen hidden from screen readers', () => {
    const progress = mount(AnswerProgress)
    expect(progress.attributes('role')).toBe('status')
    expect(progress.attributes('data-slot')).toBe('answer-progress')
    expect(progress.text()).toBe('Reading your weeks…')
    const pen = progress.get('[data-pen]')
    expect(pen.attributes('aria-hidden')).toBe('true')
    expect(pen.findAll('span')).toHaveLength(3)
  })

  it('takes other words', () => {
    expect(mount(AnswerProgress, { props: { label: 'Reading your goals…' } }).text()).toBe(
      'Reading your goals…',
    )
  })

  it('keeps the words at full colour: only the strokes move', () => {
    const progress = mount(AnswerProgress)
    expect(progress.classes()).toContain('text-ink-secondary')
    expect(progress.attributes('class')).not.toMatch(/opacity|animate/)
    for (const stroke of progress.findAll('[data-pen] span')) {
      expect(stroke.classes()).toEqual(expect.arrayContaining(['bg-ink', 'h-[3px]', 'w-2.5']))
    }
  })

  it('stands still under reduced motion: every animation is motion-safe only', () => {
    const strokes = mount(AnswerProgress).findAll('[data-pen] span')
    for (const stroke of strokes) {
      const classes = stroke.classes()
      // At rest, and under reduced motion, a stroke is a still 35% of ink.
      expect(classes).toContain('opacity-35')
      expect(classes).toContain('motion-safe:animate-pen-write')
      const moving = classes.filter((c) => /animat|opacity-100/.test(c))
      expect(moving.length).toBeGreaterThan(0)
      expect(moving.filter((c) => !c.startsWith('motion-safe:'))).toEqual([])
    }
  })

  it('writes with its own keyframe, from 35% ink to full and back, as the mockup', () => {
    expect(css).toContain('--animate-pen-write: pen-write 1.2s ease-in-out infinite;')
    const frames = /@keyframes pen-write \{([\s\S]*?)\n {2}\}/.exec(css)![1]!.replace(/\s+/g, ' ')
    expect(frames).toBe(' 0%, 100% { opacity: 0.35; } 50% { opacity: 1; }')
  })

  it('starts each stroke a fifth of a second after the one before', () => {
    const delays = mount(AnswerProgress)
      .findAll('[data-pen] span')
      .map((s) => s.classes().find((c) => c.includes('animation-delay')))
    expect(delays).toEqual([
      undefined,
      'motion-safe:[animation-delay:200ms]',
      'motion-safe:[animation-delay:400ms]',
    ])
  })
})
