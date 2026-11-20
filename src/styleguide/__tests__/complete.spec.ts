import { describe, expect, it } from 'vitest'
import { SECTIONS } from '../sections'

/**
 * The style guide is complete (#84, docs/brand.md §10): every primitive in `src/components/ui/`
 * has a section. A primitive is a folder with an `index.ts`; its section's id is `sg-` and the
 * folder's name (`programme-grid` → `sg-programme-grid`), as the registry's rule names it.
 */
const PRIMITIVES = Object.keys(import.meta.glob('../../components/ui/*/index.ts'))
  .map((path) => path.split('/').at(-2)!)
  .sort()

describe('the style guide', () => {
  it('finds the primitives', () => {
    // A guard on the glob itself: an empty list would pass the test below vacuously.
    expect(PRIMITIVES).toContain('button')
    expect(PRIMITIVES.length).toBeGreaterThan(20)
  })

  it('has a section for every primitive in src/components/ui', () => {
    const ids = new Set(SECTIONS.map((s) => s.id))
    const missing = PRIMITIVES.filter((folder) => !ids.has(`sg-${folder}`))
    expect(missing, 'primitives with no style guide section').toEqual([])
  })

  it('has a section for each of the programme builder’s components (W5, W6)', () => {
    // They live in src/components, as ItemPage and NewTrackerPage do, so the glob misses them.
    const ids: string[] = SECTIONS.map((s) => s.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'sg-programme-builder',
        'sg-activity-card',
        'sg-value-field',
        'sg-exception-week-editor',
        'sg-start-value-editor',
      ]),
    )
  })

  it('gives every section its own id', () => {
    const ids = SECTIONS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
