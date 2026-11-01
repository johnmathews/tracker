import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ORDER,
  ITEM_SECTION_TYPES,
  arrangementOf,
  moveSection,
  normaliseItemSections,
  shownSections,
  showSection,
  withArrangement,
  type Arrangement,
} from '@/lib/itemSections'
import { TRACKER_TYPES } from '@/lib/trackerTypes'

/** The cases both sides must agree on: api/tests/test_item_sections.py reads the same file. */
type Fixture = { keys: string[]; cases: { name: string; input: unknown; output: unknown }[] }
const FIXTURE = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../fixtures/item-sections/normalise.json'), 'utf8'),
) as Fixture

describe('normaliseItemSections, as the API normalises them', () => {
  it('has the API’s keys in its default order', () => {
    expect(DEFAULT_ORDER).toEqual(FIXTURE.keys)
  })

  it('knows every type in the registry, in its order', () => {
    expect(ITEM_SECTION_TYPES).toEqual(Object.keys(TRACKER_TYPES))
  })

  it.each(FIXTURE.cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
    expect(normaliseItemSections(c.input)).toEqual(c.output)
  })

  it('gives output that is already normal, types in the registry’s order', () => {
    for (const c of FIXTURE.cases) {
      const out = normaliseItemSections(c.input)
      expect(normaliseItemSections(out)).toEqual(out)
      expect(Object.keys(out)).toEqual(ITEM_SECTION_TYPES.filter((t) => t in out))
    }
  })

  it('never takes a type from the prototype', () => {
    const out = normaliseItemSections(JSON.parse('{"__proto__": {"order": ["history"]}}'))
    expect(out).toEqual({})
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
  })
})

const ARRANGED: Arrangement = {
  order: ['history', 'notes', 'details', 'plan'],
  hidden: ['details'],
}

describe('arranging a type’s page', () => {
  it('reads the default for a type with none, as a copy', () => {
    const a = arrangementOf({}, 'exercise')
    expect(a).toEqual({ order: ['notes', 'details', 'plan', 'history'], hidden: [] })
    a.order.reverse()
    expect(arrangementOf({}, 'exercise').order[0]).toBe('notes')
    expect(arrangementOf({ food: ARRANGED }, 'food')).toEqual(ARRANGED)
    expect(arrangementOf({ food: ARRANGED }, 'exercise').hidden).toEqual([])
  })

  it('shows and hides a section, keeping hidden ones in the default order', () => {
    const base: Arrangement = { order: ['plan', 'notes', 'details', 'history'], hidden: [] }
    const hidden = showSection(showSection(base, 'history', false), 'notes', false)
    expect(hidden).toEqual({ order: base.order, hidden: ['notes', 'history'] })
    expect(showSection(hidden, 'notes', true).hidden).toEqual(['history'])
    expect(showSection(hidden, 'notes', false)).toEqual(hidden)
    expect(base.hidden).toEqual([])
  })

  it('moves a section one place, and not past either end', () => {
    const base = arrangementOf({}, 'exercise')
    expect(moveSection(base, 'history', -1).order).toEqual(['notes', 'details', 'history', 'plan'])
    expect(moveSection(base, 'notes', 1).order).toEqual(['details', 'notes', 'plan', 'history'])
    expect(moveSection(base, 'notes', -1)).toEqual(base)
    expect(moveSection(base, 'history', 1)).toEqual(base)
    expect(base.order).toEqual(DEFAULT_ORDER)
  })

  it('lists the shown sections in order', () => {
    expect(shownSections(ARRANGED)).toEqual(['history', 'notes', 'plan'])
    expect(shownSections({ order: [...DEFAULT_ORDER], hidden: [...DEFAULT_ORDER] })).toEqual([])
  })

  it('stores a type’s arrangement, leaving out the default', () => {
    const one = withArrangement({}, 'exercise', ARRANGED)
    expect(one).toEqual({ exercise: ARRANGED })
    const two = withArrangement(one, 'food', ARRANGED)
    expect(two).toEqual({ exercise: ARRANGED, food: ARRANGED })
    expect(one).toEqual({ exercise: ARRANGED })
    expect(withArrangement(two, 'exercise', arrangementOf({}, 'exercise'))).toEqual({
      food: ARRANGED,
    })
  })
})
