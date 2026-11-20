<script setup lang="ts">
import { reactive } from 'vue'
import ValueField from '@/components/ValueField.vue'
import { setActivityField, type ProgrammeDoc, type Value } from '@/lib/programmeDraft'
import type { Field } from '@/lib/programmes'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'
import { LIMIT, builderDoc, rideDoc } from './builderExamples'

/** One example: a draft, the activity whose values it shows, and which line is open. */
type Example = { doc: ProgrammeDoc; index: number; open: Field | null }
const make = (doc: ProgrammeDoc, index: number, open: Field | null): Example =>
  reactive({ doc, index, open }) as Example

// Each state its own draft, so pressing one changes only it; nothing is saved.
const EXAMPLES = {
  closed: make(builderDoc(), 4, null),
  grows: make(builderDoc(), 4, 'duration'),
  stays: make(builderDoc(), 4, 'sets'),
  none: make(builderDoc(), 4, 'weight'),
  param: make(rideDoc(), 1, 'distance'),
  errorClosed: make(builderDoc(), 3, null),
  errorOpen: make(builderDoc(), 3, 'weight'),
}
const PLANK: Field[] = ['target', 'sets', 'duration', 'weight']
const DEADLIFT: Field[] = ['target', 'sets', 'reps', 'weight']
const RIDE: Field[] = ['target', 'duration', 'distance']

const OPTIONAL: Field[] = ['sets', 'weight', 'distance']
const optional = (e: Example, f: Field) =>
  OPTIONAL.includes(f) || (e.doc.kind === 'cardio' && f === 'duration')
const activity = (e: Example) => e.doc.activities[e.index]!
function write(e: Example, f: Field, v: Value | undefined): void {
  setActivityField(activity(e), f, v)
}
function toggle(e: Example, f: Field): void {
  e.open = e.open === f ? null : f
}
/** The card's states, in its order, each captioned with its words. */
const STATES: { state: string; key: keyof typeof EXAMPLES; fields: Field[] }[] = [
  {
    state:
      'Plank’s values, every line closed. Weight reads None in ink-secondary: a plank has no weight.',
    key: 'closed',
    fields: PLANK,
  },
  {
    state: 'Hold, open: it grows from 30 s, 5 s more every 2 weeks, up to 90 s.',
    key: 'grows',
    fields: PLANK,
  },
  {
    state:
      'Sets, open: it stays the same, at 3. Use a value chosen at start swaps the number for a Menu.',
    key: 'stays',
    fields: PLANK,
  },
  {
    state: 'Plank’s weight, open: None. A field left out stays out of the saved programme.',
    key: 'none',
    fields: PLANK,
  },
  {
    state:
      'Long ride’s distance, in a cardio programme: it starts at a value chosen at start, and grows 10% a week.',
    key: 'param',
    fields: RIDE,
  },
  {
    state: 'A week over the limit, closed: the problem shows under the words.',
    key: 'errorClosed',
    fields: DEADLIFT,
  },
  {
    state: 'The same, open: the problem at the foot of the group.',
    key: 'errorOpen',
    fields: DEADLIFT,
  },
]
const problems = (e: Example, f: Field) =>
  e.index === 3 && f === 'weight' ? [{ sub: null, message: LIMIT }] : []
</script>

<!-- The card's states (components/ValueField/preview.html), drawn by the app's own ValueField in
     an open ActivityCard's list. Each list has its own draft: pressing a line opens it, and each
     field writes the draft it shows. Change the most and the rounding and the Menu of values
     chosen at start open on a press. -->
<template>
  <div class="flex flex-col gap-8">
    <ExampleGroup>
      <StateExample
        v-for="{ state, key, fields } in STATES"
        :key="key"
        :state="state"
        class="w-full max-w-[calc(var(--u)*520)]"
      >
        <ul
          :id="`sg-value-field-${key}`"
          class="w-full border-t border-line"
          :aria-label="`${activity(EXAMPLES[key]).name}’s values`"
        >
          <ValueField
            v-for="f in fields"
            :key="f"
            :doc="EXAMPLES[key].doc"
            :field="f"
            :value="activity(EXAMPLES[key])[f]"
            :optional="optional(EXAMPLES[key], f)"
            :activity="activity(EXAMPLES[key]).name"
            :open="EXAMPLES[key].open === f"
            :problems="problems(EXAMPLES[key], f)"
            @toggle="toggle(EXAMPLES[key], f)"
            @update="(v) => write(EXAMPLES[key], f, v)"
          />
        </ul>
      </StateExample>
    </ExampleGroup>
  </div>
</template>
