<script setup lang="ts">
import { reactive } from 'vue'
import ActivityCard from '@/components/ActivityCard.vue'
import {
  moveActivity,
  newSession,
  removeActivity,
  type DraftSession,
  type ProgrammeDoc,
} from '@/lib/programmeDraft'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'
import { LIMIT, builderDoc, rideDoc } from './builderExamples'

/** One list of cards: its draft, its session and which card is open. */
type Example = { doc: ProgrammeDoc; session: DraftSession; open: number | null }
const make = (doc: ProgrammeDoc, open: number | null): Example =>
  reactive({ doc, session: newSession(), open }) as Example

// Each state its own draft: the cards open, move and go in it only; nothing is saved.
const STATES: { id: string; state: string; example: Example }[] = [
  {
    id: 'closed',
    state:
      'Beginner 5×5’s activities, every card closed, each with its rule in a line. Deadlift grows 90 kg a week: its border is error-ink and the problem is under its rule. The ⋯ Menu has Move up, Move down and Remove.',
    example: make(builderDoc(), null),
  },
  {
    id: 'open',
    state:
      'Plank, open in place in 2px ink: Name, Measure, Sides, a line per value, then More: key, notes, link.',
    example: make(builderDoc(), 4),
  },
  {
    id: 'cardio',
    state:
      'Long ride, in a cardio programme: no Measure and no Sides; Times a week, Time and Distance.',
    example: make(rideDoc(), 1),
  },
]

const problems = (e: Example, i: number) =>
  e.doc.activities[i]!.key === 'deadlift' ? [{ fieldId: 'weight', message: LIMIT }] : []
function toggle(e: Example, i: number): void {
  e.open = e.open === i ? null : i
}
function move(e: Example, i: number, by: -1 | 1): void {
  moveActivity(e.doc, i, by)
  if (e.open === i) e.open = i + by
}
function remove(e: Example, i: number): void {
  removeActivity(e.doc, e.session, i)
  e.open = null
}
</script>

<!-- The card's states (components/ActivityCard/preview.html), drawn by the app's own ActivityCard
     on its own draft per state: press a card to open it, its ⋯ to move or remove it. More, and a
     value's line, open on a press. -->
<template>
  <div class="flex flex-col gap-8">
    <ExampleGroup>
      <StateExample
        v-for="{ id, state, example } in STATES"
        :key="id"
        :state="state"
        class="w-full max-w-[calc(var(--u)*520)]"
      >
        <ul
          :id="`sg-activity-card-${id}`"
          class="flex w-full flex-col gap-3"
          aria-label="Activities"
        >
          <ActivityCard
            v-for="(a, i) in example.doc.activities"
            :key="a.key"
            :doc="example.doc"
            :session="example.session"
            :index="i"
            :open="example.open === i"
            :problems="problems(example, i)"
            @toggle="toggle(example, i)"
            @move="(by) => move(example, i, by)"
            @remove="remove(example, i)"
          />
        </ul>
      </StateExample>
    </ExampleGroup>
  </div>
</template>
