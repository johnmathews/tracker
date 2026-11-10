<script setup lang="ts">
import { MAX_TARGET, MIN_TARGET } from '@/lib/storage'
import { FIELDS } from '@/lib/itemPage'
import { MEASURE_OPTIONS, type useExerciseForm } from '@/composables/exerciseForm'
import type { useCardioForm } from '@/composables/cardioForm'
import PerSideToggle from '@/components/PerSideToggle.vue'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Stepper } from '@/components/ui/stepper'
import { TextField } from '@/components/ui/text-field'

/** The plan's error messages, one per field that can be over its limit. */
export type PlanErrors = {
  sets?: string
  reps?: string
  weight?: string
  minutes?: string
  distance?: string
}

const props = defineProps<{
  /** What the item is: an exercise has sets, reps and weight; cardio time and distance; a food
   * only Times a week. */
  kind: 'exercise' | 'cardio' | 'food'
  form: ReturnType<typeof useExerciseForm>
  cardioForm: ReturnType<typeof useCardioForm>
  /** Times a week. */
  target: number
  errors: PlanErrors
  /** Prefix for the fields' ids, unique on the page. */
  idBase: string
}>()
const emit = defineEmits<{
  /** A field changed; the form holds the new value. */
  change: []
  'update:target': [value: number]
}>()

function onInput(handler: (ev: Event) => void, ev: Event): void {
  handler(ev)
  emit('change')
}
function onMeasure(value: string): void {
  props.form.onMeasure(value)
  emit('change')
}
function onPerSide(value: boolean): void {
  props.form.onPerSide(value)
  emit('change')
}
</script>

<!-- This week's plan's controls (ItemPage card), as the item's page and the new item page show
     them (K104): an exercise's Sets, Measure, the amount, Weight, Reps count and Times a week; a
     cardio item's Minutes, Distance and Times a week (K90); a food's Times a week. -->
<template>
  <div :class="FIELDS">
    <template v-if="kind === 'exercise'">
      <TextField
        :id="`${idBase}-sets`"
        :model-value="form.sets.value"
        label="Sets"
        maxlength="2"
        inputmode="numeric"
        :error="errors.sets"
        class="[&_input]:max-w-[max(5rem,calc(var(--u)*96))]"
        data-field="sets"
        @input="onInput(form.onSetsInput, $event)"
      />
      <SegmentedControl
        :model-value="form.measureChoice.value"
        label="Measure"
        :options="MEASURE_OPTIONS"
        @update:model-value="onMeasure"
      />
      <TextField
        :id="`${idBase}-reps`"
        :model-value="form.reps.value"
        :label="form.amountLabel.value"
        inputmode="numeric"
        maxlength="4"
        :error="errors.reps"
        class="[&_input]:max-w-[max(5rem,calc(var(--u)*96))]"
        data-field="reps"
        @input="onInput(form.onRepsInput, $event)"
      />
      <TextField
        :id="`${idBase}-weight`"
        :model-value="form.weight.value"
        label="Weight in kg"
        inputmode="decimal"
        placeholder="Bodyweight"
        :error="errors.weight"
        class="[&_input]:max-w-[max(11rem,calc(var(--u)*170))]"
        data-field="weight"
        @input="onInput(form.onWeightInput, $event)"
      />
      <PerSideToggle
        :model-value="form.perSide.value"
        :timed="form.measure.value === 'time'"
        @update:model-value="onPerSide"
      />
    </template>
    <!-- A cardio item's time and distance (K90): either may stay blank. -->
    <template v-else-if="kind === 'cardio'">
      <TextField
        :id="`${idBase}-minutes`"
        :model-value="cardioForm.minutes.value"
        label="Minutes"
        inputmode="decimal"
        maxlength="7"
        :error="errors.minutes"
        class="[&_input]:max-w-[max(5rem,calc(var(--u)*96))]"
        data-field="minutes"
        @input="onInput(cardioForm.onMinutesInput, $event)"
      />
      <TextField
        :id="`${idBase}-distance`"
        :model-value="cardioForm.distance.value"
        label="Distance in km"
        inputmode="decimal"
        maxlength="7"
        :error="errors.distance"
        class="[&_input]:max-w-[max(11rem,calc(var(--u)*170))]"
        data-field="distance"
        @input="onInput(cardioForm.onDistanceInput, $event)"
      />
    </template>
    <Stepper
      :id="`${idBase}-target`"
      :model-value="target"
      label="Times a week"
      lower-label="Fewer times a week"
      raise-label="More times a week"
      :min="MIN_TARGET"
      :max="MAX_TARGET"
      @update:model-value="emit('update:target', $event)"
    />
  </div>
</template>
