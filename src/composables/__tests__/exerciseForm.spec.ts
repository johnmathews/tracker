import { describe, expect, it } from 'vitest'
import { decimalOnly, digitsOnly, useExerciseForm } from '@/composables/exerciseForm'

describe('input cleaning', () => {
  it('keeps only digits for reps', () => {
    expect(digitsOnly('1a2.5')).toBe('125')
  })

  it('keeps digits and one decimal point for weight, reading a comma as the point', () => {
    expect(decimalOnly('12')).toBe('12')
    expect(decimalOnly('2,5')).toBe('2.5')
    expect(decimalOnly('1.2.3kg')).toBe('1.23')
    expect(decimalOnly('.5')).toBe('.5')
    expect(decimalOnly('abc')).toBe('')
  })
})

describe('useExerciseForm', () => {
  it('loads an exercise and its notes, reports its plan value without them, and resets', () => {
    const form = useExerciseForm()
    form.load(
      { id: 'kh', name: 'Kettlebell halos', sets: 3, reps: 8, perSide: true, weight: 8, target: 3 },
      '**Ribs down.**',
    )
    // The notes are the item's details, for every week; the dialog saves them apart.
    expect(form.notes.value).toBe('**Ribs down.**')
    expect(form.value()).toEqual({
      name: 'Kettlebell halos',
      sets: 3,
      reps: 8,
      perSide: true,
      weight: 8,
      target: 3,
    })
    expect(form.sets.value).toBe('3')
    form.load()
    expect(form.notes.value).toBe('')
    expect(form.value()).toStrictEqual({
      name: '',
      sets: undefined,
      reps: 0,
      perSide: false,
      weight: undefined,
      target: 3,
    })
  })

  it('loads a timed exercise as Time and reports seconds as its duration, never reps', () => {
    const form = useExerciseForm()
    form.load({ id: 'pl', name: 'Plank', sets: 3, reps: 0, duration: 45, target: 2 })
    expect(form.measure.value).toBe('time')
    expect(form.amountLabel.value).toBe('Seconds')
    expect(form.reps.value).toBe('45')
    expect(form.value()).toEqual({
      name: 'Plank',
      sets: 3,
      reps: 0,
      duration: 45,
      perSide: false,
      weight: undefined,
      target: 2,
    })
    form.measureChoice.value = 'reps'
    expect(form.amountLabel.value).toBe('Reps')
    expect(form.value()).toMatchObject({ reps: 45 })
    expect(form.value()).not.toHaveProperty('duration')
  })
})
