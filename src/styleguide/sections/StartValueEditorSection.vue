<script setup lang="ts">
import { nextTick, onMounted, reactive } from 'vue'
import { Plus } from '@lucide/vue'
import StartValueEditor from '@/components/StartValueEditor.vue'
import { addParam, newSession, type DraftSession, type ProgrammeDoc } from '@/lib/programmeDraft'
import { Button } from '@/components/ui/button'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'
import { builderDoc } from './builderExamples'

/** One list of values: its draft, its session, and which value is open (by its place). */
type Example = { doc: ProgrammeDoc; session: DraftSession; open: number | null }
const make = (open: number | null) =>
  reactive({ doc: builderDoc(), session: newSession(), open }) as Example

// Each state its own draft: its values open, change, go and come back in it only; nothing is saved.
const STATES: { id: string; state: string; example: Example }[] = [
  {
    id: 'closed',
    state:
      'Values chosen at start, closed: Beginner 5×5 asks for a squat start and a weekly increase. Each row gives its default and the fields that use it, then Add a value.',
    example: make(null),
  },
  {
    id: 'open',
    state:
      'Squat start, open in place in 2px ink: Label, Unit, Default, Lowest and Highest, the line naming the fields that use it, More: key, and Remove.',
    example: make(0),
  },
  {
    id: 'refused',
    state:
      'More: key, opened. Remove pressed while Back squat’s weight uses it: the refusal names the field.',
    example: make(0),
  },
]

const keys = (e: Example) => Object.keys(e.doc.params ?? {})
function toggle(e: Example, i: number): void {
  e.open = e.open === i ? null : i
}
function add(e: Example): void {
  addParam(e.doc, e.session)
  e.open = keys(e).length - 1
}

// The refused state is the open one after two presses: More, then Remove.
onMounted(async () => {
  await nextTick()
  const at = document.getElementById('sg-start-value-editor-refused')!
  at.querySelector<HTMLElement>('[data-testid="start-value-more"]')!.click()
  at.querySelector<HTMLElement>('[data-testid="start-value-remove"]')!.click()
})
</script>

<!-- The card's states (components/StartValueEditor/preview.html), drawn by the app's own
     StartValueEditor on its own draft per state: press the pencil to open a value, its head to
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
          :id="`sg-start-value-editor-${id}`"
          data-slot="item-page"
          class="flex w-full flex-col gap-5"
        >
          <ul
            v-if="keys(example).length"
            class="border-t border-line"
            aria-label="Values chosen at start"
          >
            <StartValueEditor
              v-for="(key, i) in keys(example)"
              :key="i"
              :doc="example.doc"
              :session="example.session"
              :param-key="key"
              :open="example.open === i"
              :problems="[]"
              @toggle="toggle(example, i)"
              @removed="example.open = null"
            />
          </ul>
          <div>
            <Button data-testid="start-value-add" @click="add(example)"
              ><Plus :stroke-width="1.5" />Add a value</Button
            >
          </div>
        </div>
      </StateExample>
    </ExampleGroup>
  </div>
</template>
