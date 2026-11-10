import { describe, expect, it } from 'vitest'
import { useCardioForm } from '@/composables/cardioForm'
import { NEW_CARDIO_TARGET } from '@/lib/storage'

/** An input event on a field holding `text`, as the browser sends it. */
function input(text: string): Event {
  const el = document.createElement('input')
  el.value = text
  const ev = new Event('input')
  Object.defineProperty(ev, 'target', { value: el })
  return ev
}

describe('useCardioForm (K90)', () => {
  it('starts empty for a new item: no time, no distance, the new item’s goal', () => {
    const form = useCardioForm()
    form.load()
    expect([form.name.value, form.minutes.value, form.distance.value]).toEqual(['', '', ''])
    expect(form.value()).toEqual({
      name: '',
      duration: undefined,
      distance: undefined,
      target: NEW_CARDIO_TARGET,
    })
  })

  it('loads an item’s minutes to two places, and reports seconds', () => {
    const form = useCardioForm()
    form.load({ id: 'cy', name: 'Cycling', duration: 5430, distance: 30, target: 2 }, 'Hills')
    expect(form.minutes.value).toBe('90.5')
    expect(form.distance.value).toBe('30')
    expect(form.notes.value).toBe('Hills')
    form.onMinutesInput(input('12,5x'))
    form.onDistanceInput(input('a4'))
    expect(form.value()).toEqual({ name: 'Cycling', duration: 750, distance: 4, target: 2 })
  })
})
