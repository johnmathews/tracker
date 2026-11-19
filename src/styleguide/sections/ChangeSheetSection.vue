<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@/components/ui/button'
import { ChangeSheet } from '@/components/ui/change-sheet'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'
import { ROW_FROM_WEEK_5, RUN, exampleServer } from './programmeExamples'

/** How long the fake server takes to answer, so a pressed button shows it is busy. */
const DELAY = 700

/** The card's sheet, and the same sheet whose first confirm finds the plan changed (409). */
const CASES = [
  {
    id: 'sg-change-sheet-change-open',
    state:
      'Step 1, then step 2: Preview change with 45 shows what the change does to each week. Week 6’s hand-edit is kept; Drop it too puts it in the change, and Keep it takes it back out. That week only lists week 5 alone. An empty value, or 44, gets the server’s error on step 1.',
    staleOnce: false,
  },
  {
    id: 'sg-change-sheet-stale-open',
    state:
      'The plan changed since the preview: the first Confirm change shows the fresh preview with a line saying so, and applies nothing. The second goes through.',
    staleOnce: true,
  },
] as const

const open = ref(false)
/** A fresh sheet each time it opens, as the overview keys it. */
const key = ref(0)
const server = ref(exampleServer())
const answer = ref('')

function openSheet(staleOnce: boolean): void {
  server.value = exampleServer({ delay: DELAY, staleOnce })
  answer.value = ''
  key.value++
  open.value = true
}
</script>

<!-- The card's sheet (components/ChangeSheet/preview.html): Change Barbell row, opened from week
     5's cell with Change from here, on the running programme of the ProgrammeGrid section. It opens
     from its trigger only, so nothing traps the page on load. A fake server answers its preview and
     confirm (programmeExamples.ts): nothing is sent and nothing is saved. -->
<template>
  <div class="flex flex-col gap-8">
    <ExampleGroup title="Change Barbell row">
      <StateExample v-for="c in CASES" :key="c.id" :state="c.state">
        <Button :id="c.id" @click="openSheet(c.staleOnce)">Change Barbell row</Button>
      </StateExample>
    </ExampleGroup>
    <ExampleGroup title="Offline">
      <StateExample state="The sheet doesn’t open: the controls that open it are disabled.">
        <Button id="sg-change-sheet-offline-disabled" disabled>Change Barbell row</Button>
      </StateExample>
    </ExampleGroup>
    <p id="sg-change-sheet-answer" class="caption text-ink-secondary" aria-live="polite">
      {{ answer || 'What the sheet ends with shows here.' }}
    </p>
    <ChangeSheet
      :key="key"
      v-model:open="open"
      :run="RUN"
      :start="ROW_FROM_WEEK_5"
      :preview="server.preview"
      :confirm="server.confirm"
      @done="answer = 'Confirm change: the change is applied, and the sheet closes.'"
      @show-in-plan="
        answer =
          'Show it in the plan: the overview shows the change in its cells, as the ProgrammeGrid section’s Previewing a change.'
      "
    />
  </div>
</template>
