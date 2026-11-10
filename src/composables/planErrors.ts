import {
  MAX_CARDIO_DURATION,
  MAX_DISTANCE,
  MAX_DURATION,
  MAX_SETS,
  MAX_WEIGHT,
} from '@/lib/storage'
import type { useExerciseForm } from '@/composables/exerciseForm'
import type { useCardioForm } from '@/composables/cardioForm'
import type { PlanErrors } from '@/components/PlanFields.vue'

/** "This is 25 sets. Enter 20 or fewer to change the plan.", or nothing when within the limit. */
function overLimit(value: number | undefined, max: number, unit: string): string | undefined {
  if (value === undefined || value <= max) return undefined
  const fmt = (n: number) => n.toLocaleString('en-US')
  return `This is ${fmt(value)} ${unit}. Enter ${fmt(max)} or fewer to change the plan.`
}

/** An exercise's plan fields over their limits (ItemPage card), each with its message. */
export function exercisePlanErrors(form: ReturnType<typeof useExerciseForm>): PlanErrors {
  const input = form.value()
  return {
    sets: overLimit(input.sets, MAX_SETS, 'sets'),
    reps: overLimit(input.duration, MAX_DURATION, 'seconds'),
    weight: overLimit(input.weight, MAX_WEIGHT, 'kg'),
  }
}

/** A cardio item's plan fields over their limits (K90), each with its message. */
export function cardioPlanErrors(form: ReturnType<typeof useCardioForm>): PlanErrors {
  return {
    minutes: overLimit(form.minutesValue(), MAX_CARDIO_DURATION / 60, 'minutes'),
    distance: overLimit(form.distanceValue(), MAX_DISTANCE, 'km'),
  }
}

/** Whether any field has a message. */
export function hasPlanErrors(errors: PlanErrors): boolean {
  return Object.values(errors).some(Boolean)
}
