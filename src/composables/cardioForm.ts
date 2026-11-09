import { ref } from 'vue'
import { NEW_CARDIO_TARGET, type Cardio } from '@/lib/storage'
import type { NewCardio } from '@/stores/cardio'
import { decimalOnly } from '@/composables/exerciseForm'

/** Keeps the DOM in step even when the cleaned value didn't change (typing a letter). */
function clean(ev: Event): string {
  const input = ev.target as HTMLInputElement
  input.value = decimalOnly(input.value)
  return input.value
}

/** Seconds as the Minutes field shows them: whole minutes, or to two places ("30.5"). */
function minutesText(seconds: number | undefined): string {
  return seconds ? String(Math.round((seconds / 60) * 100) / 100) : ''
}

/**
 * State and input handling for a cardio item's plan (K90), in the Add and Edit cardio dialogs and
 * on its page: Minutes and Distance in km take digits and one decimal point. The plan stores
 * seconds, as an exercise's time; blank or zero leaves a field out. `notes` holds the dialog's
 * Note field, which it saves apart from the week's plan, so `value()` leaves it out.
 */
export function useCardioForm() {
  const name = ref('')
  const minutes = ref('')
  const distance = ref('')
  const target = ref(NEW_CARDIO_TARGET)
  const notes = ref('')

  function onMinutesInput(ev: Event): void {
    minutes.value = clean(ev)
  }
  function onDistanceInput(ev: Event): void {
    distance.value = clean(ev)
  }

  /** The minutes typed, as a number; undefined when blank. */
  function minutesValue(): number | undefined {
    return parseFloat(minutes.value) || undefined
  }

  function distanceValue(): number | undefined {
    return parseFloat(distance.value) || undefined
  }

  function value(): NewCardio {
    const mins = minutesValue()
    return {
      name: name.value,
      duration: mins === undefined ? undefined : Math.round(mins * 60),
      distance: distanceValue(),
      target: target.value,
    }
  }

  /** Fill the form from an item and its notes; nothing given, the form starts empty. */
  function load(c?: Cardio, itemNotes = ''): void {
    name.value = c?.name ?? ''
    minutes.value = minutesText(c?.duration)
    distance.value = c?.distance ? String(c.distance) : ''
    target.value = c?.target ?? NEW_CARDIO_TARGET
    notes.value = itemNotes
  }

  return {
    name,
    minutes,
    distance,
    target,
    notes,
    onMinutesInput,
    onDistanceInput,
    minutesValue,
    distanceValue,
    value,
    load,
  }
}
