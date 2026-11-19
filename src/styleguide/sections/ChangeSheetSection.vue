<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@/components/ui/button'
import { ChangeSheet, RunActionSheet } from '@/components/ui/change-sheet'
import type { Run } from '@/lib/programmes'
import type { RunAction } from '@/lib/runActions'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'
import { ROW_FROM_WEEK_5, RUN, exampleServer } from './programmeExamples'
import { ENDED_EARLY, ENDING, runActionServer } from './runActionExamples'

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

/** The run sheet (K168): Re-open, Restart and Cancel the end, each on the run it fits. */
const RUN_CASES: {
  id: string
  label: string
  action: RunAction
  run: Run
  staleOnce: boolean
  state: string
}[] = [
  {
    id: 'sg-change-sheet-reopen-open',
    label: 'Re-open programme',
    action: 'reopen',
    run: ENDED_EARLY,
    staleOnce: false,
    state:
      'Ended early from Mon 14 Dec. Step 1 is From and Reason, step 2 what it does: carries on at week 4, the days since the end paused, and the last day. A day before today gets the server’s error on step 1.',
  },
  {
    id: 'sg-change-sheet-restart-open',
    label: 'Restart from week 1',
    action: 'restart',
    run: ENDED_EARLY,
    staleOnce: false,
    state:
      'Step 1 is Name, the tracker’s to start with, and Starts. Step 2 is the new tracker, week 1’s dates and its last day. An empty name gets the server’s error.',
  },
  {
    id: 'sg-change-sheet-cancel-end-open',
    label: 'Cancel the end',
    action: 'cancel-end',
    run: ENDING,
    staleOnce: false,
    state:
      'Set to end from Mon 28 Dec. One step: the re-open’s preview from that day, with Keep the end and Cancel the end.',
  },
  {
    id: 'sg-change-sheet-reopen-stale-open',
    label: 'Re-open programme',
    action: 'reopen',
    run: ENDED_EARLY,
    staleOnce: true,
    state:
      'The run changed since the preview: the first Re-open programme shows the fresh preview with a line saying so, and applies nothing. The second goes through.',
  },
]

const runCase = ref<(typeof RUN_CASES)[number]>(RUN_CASES[0]!)
const runOpen = ref(false)
const runKey = ref(0)
const runServer = ref(runActionServer(ENDED_EARLY))

function openRunSheet(c: (typeof RUN_CASES)[number]): void {
  runCase.value = c
  runServer.value = runActionServer(c.run, { delay: DELAY, staleOnce: c.staleOnce })
  answer.value = ''
  runKey.value++
  runOpen.value = true
}

const RUN_DONE: Record<RunAction, string> = {
  reopen: 'Re-open programme: the run carries on, and the overview shows its controls again.',
  restart: 'Restart programme: the new tracker’s overview opens.',
  'cancel-end': 'Cancel the end: the run carries on past its end, as planned.',
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
    <ExampleGroup title="Re-open, Restart and Cancel the end">
      <StateExample v-for="c in RUN_CASES" :key="c.id" :state="c.state">
        <Button :id="c.id" @click="openRunSheet(c)">{{ c.label }}</Button>
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
    <RunActionSheet
      :key="runKey"
      v-model:open="runOpen"
      :run="runCase.run"
      :action="runCase.action"
      name="Beginner 5×5"
      :preview="runServer.preview"
      :confirm="runServer.confirm"
      @done="answer = RUN_DONE[runCase.action]"
    />
  </div>
</template>
