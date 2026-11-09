import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { noDetails, useDetailsStore } from '@/stores/details'
import { usePlannerStore } from '@/stores/planner'

describe('details store', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 23, 18, 0))
    setActivePinia(createPinia())
  })

  it('shows a note edited on one week on every other week, owned plans included (F1)', () => {
    const planner = usePlannerStore()
    const details = useDetailsStore()
    planner.changeTarget('sq', 1) // 19 October owns its plan
    planner.nextWeek()
    planner.changeTarget('sq', 1) // and so does 26 October
    planner.prevWeek()
    details.setNotes('exercise', 'sq', 'Knees out')
    planner.nextWeek()
    expect(details.notesOf('exercise', 'sq')).toBe('Knees out')
    // The plans never carry it.
    expect(planner.exercises.find((e) => e.id === 'sq')).not.toHaveProperty('notes')
  })

  it('updates what reads an item’s details when its first details arrive (W5)', () => {
    const details = useDetailsStore()
    const notes = computed(() => details.notesOf('exercise', 'pu'))
    const field = computed(() => details.fieldOf('diet', 'veg', 'serving'))
    expect([notes.value, field.value]).toEqual(['', ''])
    details.setNotes('exercise', 'pu', 'Elbows in')
    details.setField('diet', 'veg', 'serving', 'A bowl')
    expect([notes.value, field.value]).toEqual(['Elbows in', 'A bowl'])
  })

  it('starts with no details in any section', () => {
    const details = useDetailsStore()
    expect(details.docs).toEqual(noDetails())
    expect(details.docs).toEqual({ exercise: {}, cardio: {}, diet: {} })
    expect(details.get('exercise', 'sq')).toEqual({})
    expect(details.notesOf('diet', 'veg')).toBe('')
    expect(details.fieldOf('diet', 'veg', 'serving')).toBe('')
  })

  it('stores notes as the API would: trimmed, and a blank clearing them', () => {
    const details = useDetailsStore()
    expect(details.setNotes('exercise', 'sq', '  **Slow** down \n')).toBe(true)
    expect(details.get('exercise', 'sq')).toEqual({ notes: '**Slow** down' })
    expect(details.setNotes('exercise', 'sq', ' \n ')).toBe(true)
    expect(details.docs.exercise).toEqual({})
  })

  it('sets fields beside the notes, keeps keys the type does not list, and clears blanks', () => {
    const details = useDetailsStore()
    details.setNotes('exercise', 'sq', 'Knees out')
    expect(details.setField('exercise', 'sq', 'equipment', ' Kettlebell ')).toBe(true)
    expect(details.setField('exercise', 'sq', 'tempo', '3-1-1')).toBe(true)
    expect(details.get('exercise', 'sq')).toEqual({
      notes: 'Knees out',
      fields: { equipment: 'Kettlebell', tempo: '3-1-1' },
    })
    expect(details.fieldOf('exercise', 'sq', 'equipment')).toBe('Kettlebell')
    details.setField('exercise', 'sq', 'equipment', '')
    details.setField('exercise', 'sq', 'tempo', ' ')
    expect(details.get('exercise', 'sq')).toEqual({ notes: 'Knees out' })
    details.setNotes('exercise', 'sq', '')
    expect(details.docs.exercise).toEqual({})
  })

  it('refuses a field key the API would drop, and changes nothing', () => {
    const details = useDetailsStore()
    for (const key of ['Bad Key', '2nd', '', 'x'.repeat(33), '__proto__']) {
      expect(details.setField('exercise', 'sq', key, 'text')).toBe(false)
    }
    expect(details.docs.exercise).toEqual({})
  })

  it('refuses notes over 20,000 characters, counted once trimmed and in code points', () => {
    const details = useDetailsStore()
    expect(details.setNotes('exercise', 'sq', `  ${'a'.repeat(20_000)}  `)).toBe(true)
    expect(details.canSetNotes('exercise', 'sq', 'a'.repeat(20_001))).toBe(false)
    expect(details.setNotes('exercise', 'sq', 'a'.repeat(20_001))).toBe(false)
    expect(details.notesOf('exercise', 'sq')).toHaveLength(20_000)
    // An emoji is two UTF-16 units but one character, as Python counts it.
    expect(details.canSetNotes('exercise', 'pu', '😀'.repeat(8_000))).toBe(true)
  })

  it('refuses notes the API could not store in 32 KB, though under 20,000 characters', () => {
    const details = useDetailsStore()
    // Three bytes each in UTF-8: 12,000 characters are 36,000 bytes.
    const long = '語'.repeat(12_000)
    expect(details.canSetNotes('exercise', 'sq', long)).toBe(false)
    // An item about to be added (no id yet) is measured the same way.
    expect(details.canSetNotes('exercise', null, long)).toBe(false)
    expect(details.canSetNotes('exercise', null, 'Knees out')).toBe(true)
    expect(details.setNotes('exercise', 'sq', long)).toBe(false)
    // 10,800 are 32,400 bytes, and the document 32,412: it fits, with no room for 1,500 more.
    expect(details.setNotes('exercise', 'sq', '語'.repeat(10_800))).toBe(true)
    // A field that would take the document over the cap is refused too.
    expect(details.setField('exercise', 'sq', 'works', '語'.repeat(500))).toBe(false)
    expect(details.fieldOf('exercise', 'sq', 'works')).toBe('')
  })

  it('refuses a field over 500 characters, and a new field past the 32 the API keeps', () => {
    const details = useDetailsStore()
    expect(details.setField('diet', 'veg', 'serving', 'x'.repeat(501))).toBe(false)
    for (let i = 0; i < 32; i++) {
      expect(details.setField('diet', 'veg', `f${i}`, 'x')).toBe(true)
    }
    expect(details.setField('diet', 'veg', 'one_more', 'x')).toBe(false)
    expect(details.setField('diet', 'veg', 'f3', 'changed')).toBe(true)
    expect(details.setField('diet', 'veg', 'f4', '')).toBe(true)
    expect(Object.keys(details.get('diet', 'veg').fields!)).toHaveLength(31)
  })

  it('adopts every section, one item, and clears', () => {
    const details = useDetailsStore()
    details.adopt({
      ...noDetails(),
      exercise: { sq: { notes: 'A' } },
      diet: { veg: { notes: 'B' } },
    })
    expect(details.notesOf('diet', 'veg')).toBe('B')
    details.adoptItem('exercise', 'sq', { notes: 'C' })
    details.adoptItem('diet', 'veg', null)
    details.adoptItem('diet', 'fish', {})
    expect(details.docs).toEqual({ exercise: { sq: { notes: 'C' } }, cardio: {}, diet: {} })
    details.clear()
    expect(details.docs).toEqual({ exercise: {}, cardio: {}, diet: {} })
  })

  it('refuses an id the API cannot name, __proto__ among them, and changes nothing', () => {
    const details = useDetailsStore()
    // A slash, `.` or `..` can't be one path segment: the browser or the router splits or folds it.
    for (const id of ['__proto__', '', 'x'.repeat(129), 'a/b', '/', '.', '..']) {
      expect(details.setNotes('exercise', id, 'Note')).toBe(false)
      expect(details.canSetNotes('exercise', id, 'Note')).toBe(false)
      expect(details.setField('exercise', id, 'works', 'Legs')).toBe(false)
    }
    expect(details.docs.exercise).toEqual({})
    expect(Object.getPrototypeOf(details.docs.exercise)).toBe(Object.prototype)
    expect(details.get('exercise', '__proto__')).toEqual({})
    expect(details.setNotes('exercise', 'x'.repeat(128), 'Note')).toBe(true)
    for (const id of ['a.b', '...', 'a\\b', 'a b?#%']) {
      expect(details.setNotes('exercise', id, 'Note')).toBe(true)
    }
  })

  it('never lets a caller change the shared empty document', () => {
    const details = useDetailsStore()
    expect(Object.isFrozen(details.get('exercise', 'none'))).toBe(true)
  })
})
