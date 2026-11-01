import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useDietStore } from '@/stores/diet'
import { usePlannerStore } from '@/stores/planner'
import { DIET_KEY } from '@/lib/storage'

// Friday 23 Oct 2026: the visible week is Mon 19 – Sun 25.
const NOW = new Date(2026, 9, 23, 18, 0)

function stored(key: string): unknown {
  const raw = localStorage.getItem(key)
  return raw === null ? null : JSON.parse(raw)
}

describe('diet store', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with the default foods', () => {
    const d = useDietStore()
    expect(d.foods.map((f) => [f.name, f.target])).toEqual([
      ['Vegetables', 7],
      ['Fruit', 5],
      ['Fish', 2],
      ['Nuts', 3],
    ])
    expect(d.grandTotal).toBe(0)
    expect(d.goalsMet).toBe(0)
  })

  it('toggles foods in the planner’s visible week', () => {
    const d = useDietStore()
    d.toggle('fish', 0)
    d.toggle('fish', 3)
    d.toggle('veg', 3)
    expect(d.isEaten('fish', 3)).toBe(true)
    expect(d.markOf('fish', 3)).toBe('great')
    expect(d.totalFor('fish')).toBe(2)
    expect(d.dayCounts).toEqual([1, 0, 0, 2, 0, 0, 0])
    expect(d.grandTotal).toBe(3)
    expect(d.goalsMet).toBe(1)
    expect(d.log['2026-10-19']!.fish).toEqual(['great', null, null, 'great', null, null, null])
    // Foods have one kind of mark, green, in each drawing; then the next press clears it.
    d.toggle('fish', 3)
    expect(d.markOf('fish', 3)).toBe('great-solid')
    d.toggle('fish', 3)
    expect(d.markOf('fish', 3)).toBe('great-hatch')
    expect(d.totalFor('fish')).toBe(2)
    d.toggle('fish', 3)
    expect(d.markOf('fish', 3)).toBeNull()
  })

  it('marks a food once and clears it on the next press in a tick or face set', () => {
    const d = useDietStore()
    usePlannerStore().markSet = 'ticks'
    d.toggle('fish', 0)
    expect(d.markOf('fish', 0)).toBe('great')
    d.toggle('fish', 0)
    expect(d.markOf('fish', 0)).toBeNull()
  })

  it('follows week navigation from the planner store', () => {
    const d = useDietStore()
    const p = usePlannerStore()
    d.toggle('fruit', 1)
    p.prevWeek()
    expect(d.isEaten('fruit', 1)).toBe(false)
    d.toggle('fruit', 1)
    expect(Object.keys(d.log).sort()).toEqual(['2026-10-12', '2026-10-19'])
    p.thisWeek()
    expect(d.totalFor('fruit')).toBe(1)
  })

  it('clamps food goals to 0–7', () => {
    const d = useDietStore()
    d.changeTarget('veg', 1)
    expect(d.foods[0]!.target).toBe(7)
    for (let i = 0; i < 9; i++) d.changeTarget('veg', -1)
    expect(d.foods[0]!.target).toBe(0)
    d.changeTarget('missing', 1)
  })

  it('renames a food and sets its goal, clamped, keeping its id and marks', () => {
    const d = useDietStore()
    d.toggle('fish', 0)
    expect(d.updateFood('fish', { name: ' Salmon ', target: 9 })).toBe(true)
    expect(d.foods[2]).toEqual({ id: 'fish', name: 'Salmon', target: 7 })
    expect(d.isEaten('fish', 0)).toBe(true)
    expect(d.updateFood('fish', { name: '  ', target: 1 })).toBe(false)
    expect(d.updateFood('missing', { name: 'Beans', target: 1 })).toBe(false)
    expect(d.foods[2]!.name).toBe('Salmon')
  })

  it('keeps no note in the week: a food’s notes are its details, for every week (D3)', () => {
    const d = useDietStore()
    d.updateFood('fish', { name: 'Fish', target: 2, notes: 'Oily fish' } as never)
    expect(d.foods[2]).toEqual({ id: 'fish', name: 'Fish', target: 2 })
  })

  it('adds a food with goal 3, ignores an empty name, and removes', () => {
    const d = useDietStore()
    expect(d.addFood('  ')).toBeNull()
    const id = d.addFood(' Beans ')
    expect(d.foods.at(-1)).toEqual({ id, name: 'Beans', target: 3 })
    d.toggle('nuts', 0)
    d.removeFood('nuts')
    expect(d.foods.map((f) => f.id)).not.toContain('nuts')
    expect(d.grandTotal).toBe(0)
    expect(d.log['2026-10-19']?.nuts?.[0]).toBe('great')
  })

  it('adds a food with its goal from the Add food dialog (K54)', () => {
    const d = useDietStore()
    expect(d.addFood({ name: ' ', target: 2 })).toBeNull()
    const id = d.addFood({ name: ' Beans ', target: 9 })
    // The goal is held to the Stepper's range.
    expect(d.foods.at(-1)).toEqual({ id, name: 'Beans', target: 7 })
    expect(id).toMatch(/^x/)
  })

  it('adopts food data wholesale or a week at a time, and clears', () => {
    const d = useDietStore()
    d.adopt({ plans: { '2026-10-19': [{ id: 'z', name: 'Z', target: 1 }] }, log: {} })
    expect(d.foods.map((f) => f.name)).toEqual(['Z'])
    d.adoptWeek('2026-10-19', [{ id: 'y', name: 'Y', target: 2 }])
    expect(d.foods.map((f) => f.name)).toEqual(['Y'])
    d.toggle('y', 0)
    d.clear()
    expect(d.foods).toHaveLength(4)
    expect(d.grandTotal).toBe(0)
  })

  it('carries food plans forward, and a week changed itself keeps its own', () => {
    const d = useDietStore()
    const p = usePlannerStore()
    d.addFood('Beans')
    p.nextWeek()
    expect(d.foods.map((f) => f.name)).toContain('Beans')
    d.removeFood('fish')
    p.prevWeek()
    expect(d.foods.map((f) => f.id)).toContain('fish')
    p.nextWeek()
    expect(d.foods.map((f) => f.id)).not.toContain('fish')
  })

  it('never reads or writes the diet keys from before accounts', async () => {
    const legacy = JSON.stringify({ foods: [{ id: 'z', name: 'Z', target: 2 }], log: {} })
    localStorage.setItem('tracker-diet-v1', legacy)
    setActivePinia(createPinia())
    const d = useDietStore()
    expect(d.foods).toHaveLength(4)
    d.toggle('veg', 0)
    await nextTick()
    expect(localStorage.getItem('tracker-diet-v1')).toBe(legacy)
    expect(stored(DIET_KEY)).toBeNull()
  })
})
