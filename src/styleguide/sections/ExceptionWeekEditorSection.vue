<script setup lang="ts">
import { reactive } from 'vue'
import { Plus } from '@lucide/vue'
import ExceptionWeekEditor, { type OverrideProblem } from '@/components/ExceptionWeekEditor.vue'
import { setDocField, type ProgrammeDoc } from '@/lib/programmeDraft'
import { Button } from '@/components/ui/button'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'
import { builderDoc, legsRestDoc } from './builderExamples'

/** One list of exception weeks: its draft, which one is open, and the server's problems. */
type Example = { doc: ProgrammeDoc; open: number | null; problems: OverrideProblem[] }
const make = (doc: ProgrammeDoc, open: number | null, problems: OverrideProblem[] = []) =>
  reactive({ doc, open, problems }) as Example

/** Beginner 5×5 with its deload over weeks 4 and 9: the programme has 8 weeks. */
function pastTheEnd(): ProgrammeDoc {
  const doc = builderDoc()
  doc.overrides![0]!.weeks = [4, 9]
  return doc
}

// Each state its own draft: its weeks open, change, go and come back in it only; nothing is saved.
const STATES: { id: string; state: string; example: Example }[] = [
  {
    id: 'closed',
    state:
      'Exception weeks, closed: Beginner 5×5’s deload as a row that says what it changes, with a pencil to open it, then Add exception week.',
    example: make(builderDoc(), null),
  },
  {
    id: 'open',
    state:
      'Weeks 4 and 8, open in place in 2px ink: the weeks typed with a comma, the label, every activity’s values, then Deadlift’s own. Each value is Set to a number or % of planned. Add a value opens a Menu of the fields the group doesn’t set yet.',
    example: make(builderDoc(), 0),
  },
  {
    id: 'rest',
    state:
      'Week 3 rests the legs, open: Back squat and Deadlift ticked under Rest these activities, so Back squat has no group of its own, and Deadlift’s keeps its 1 set. Closed, it reads “Rest: Back squat, Deadlift.”',
    example: make(legsRestDoc(), 1),
  },
  {
    id: 'error',
    state: 'A week past the end: the programme has 8 weeks, so week 9 is a problem under Weeks.',
    example: make(pastTheEnd(), 0, [
      { fieldId: 'weeks', message: 'Week 9 is past the end. This programme has 8 weeks.' },
    ]),
  },
]

function toggle(e: Example, i: number): void {
  e.open = e.open === i ? null : i
}
function add(e: Example): void {
  const overrides = e.doc.overrides ?? []
  overrides.push({ weeks: [], activities: {} })
  setDocField(e.doc, 'overrides', overrides)
  e.open = overrides.length - 1
}
function remove(e: Example, i: number): void {
  e.doc.overrides!.splice(i, 1)
  if (!e.doc.overrides!.length) setDocField(e.doc, 'overrides', undefined)
  e.open = null
}
</script>

<!-- The card's states (components/ExceptionWeekEditor/preview.html), drawn by the app's own
     ExceptionWeekEditor on its own draft per state: press the pencil to open a week, its head to
     close it. -->
<template>
  <div class="flex flex-col gap-8">
    <ExampleGroup>
      <StateExample
        v-for="{ id, state, example } in STATES"
        :key="id"
        :state="state"
        class="w-full max-w-[calc(var(--u)*520)]"
      >
        <div
          :id="`sg-exception-week-editor-${id}`"
          data-slot="item-page"
          class="flex w-full flex-col gap-5"
        >
          <ul
            v-if="example.doc.overrides?.length"
            class="border-t border-line"
            aria-label="Exception weeks"
          >
            <ExceptionWeekEditor
              v-for="(o, i) in example.doc.overrides"
              :key="i"
              :doc="example.doc"
              :index="i"
              :open="example.open === i"
              :problems="example.problems"
              @toggle="toggle(example, i)"
              @remove="remove(example, i)"
            />
          </ul>
          <div>
            <Button data-testid="exception-add" @click="add(example)"
              ><Plus :stroke-width="1.5" />Add exception week</Button
            >
          </div>
        </div>
      </StateExample>
    </ExampleGroup>
  </div>
</template>
