import { computed, ref } from 'vue'
import { NEW_EXERCISE_TARGET, type Exercise } from '@/lib/storage'
import type { NewExercise } from '@/stores/planner'

/** Keeps the DOM in step even when the cleaned value didn't change (e.g. typing a letter). */
function clean(ev: Event, fn: (text: string) => string): string {
  const input = ev.target as HTMLInputElement
  input.value = fn(input.value)
  return input.value
}

/** Digits only. */
export function digitsOnly(text: string): string {
  return text.replace(/\D/g, '')
}

/** Digits and one decimal point; a comma counts as the point. */
export function decimalOnly(text: string): string {
  const [whole = '', ...rest] = text
    .replace(/,/g, '.')
    .replace(/[^\d.]/g, '')
    .split('.')
  return rest.length ? `${whole}.${rest.join('')}` : whole
}

/** What a set is counted in: reps, or seconds for a timed exercise such as a plank. */
export type Measure = 'reps' | 'time'

/** The Measure SegmentedControl's options, in the Dialog card's words. */
export const MEASURE_OPTIONS = [
  { value: 'reps', label: 'Reps' },
  { value: 'time', label: 'Time' },
]

/**
 * State and input handling for the exercise's dialog, adding or editing (K54). `reps` holds the
 * amount field's digits whichever the measure: reps per set, or seconds per set when timed.
 * `notes` holds the Note field: the item's notes, from its details (every week), which the dialog
 * saves apart from this week's plan, so `value()` leaves them out.
 */
export function useExerciseForm() {
  const name = ref('')
  const sets = ref('')
  const reps = ref('')
  const weight = ref('')
  const perSide = ref(false)
  const measure = ref<Measure>('reps')
  const target = ref(NEW_EXERCISE_TARGET)
  const notes = ref('')
  /** The amount field's label. */
  const amountLabel = computed(() => (measure.value === 'time' ? 'Seconds' : 'Reps'))
  /** The SegmentedControl's v-model is a string; anything but "time" counts reps. */
  const measureChoice = computed({
    get: () => measure.value,
    set: (v: string) => (measure.value = v === 'time' ? 'time' : 'reps'),
  })

  function onSetsInput(ev: Event): void {
    sets.value = clean(ev, digitsOnly)
  }
  function onRepsInput(ev: Event): void {
    reps.value = clean(ev, digitsOnly)
  }
  function onWeightInput(ev: Event): void {
    weight.value = clean(ev, decimalOnly)
  }

  function value(): NewExercise {
    const amount = parseInt(reps.value, 10) || 0
    const timed = measure.value === 'time'
    return {
      name: name.value,
      sets: parseInt(sets.value, 10) || undefined,
      reps: timed ? 0 : amount,
      ...(timed ? { duration: amount } : {}),
      perSide: perSide.value,
      weight: parseFloat(weight.value) || undefined,
      target: target.value,
    }
  }

  /** Fill the form from an exercise and its notes; nothing given, the form starts empty. */
  function load(e?: Exercise, itemNotes = ''): void {
    name.value = e?.name ?? ''
    sets.value = e?.sets ? String(e.sets) : ''
    measure.value = e?.duration ? 'time' : 'reps'
    const amount = e?.duration ?? e?.reps
    reps.value = amount ? String(amount) : ''
    weight.value = e?.weight ? String(e.weight) : ''
    perSide.value = e?.perSide ?? false
    target.value = e?.target ?? NEW_EXERCISE_TARGET
    notes.value = itemNotes
  }

  return {
    name,
    sets,
    reps,
    weight,
    perSide,
    measure,
    measureChoice,
    amountLabel,
    target,
    notes,
    onSetsInput,
    onRepsInput,
    onWeightInput,
    value,
    load,
  }
}
