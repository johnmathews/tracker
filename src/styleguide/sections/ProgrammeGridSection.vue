<script setup lang="ts">
import { ref } from 'vue'
import { ProgrammeGrid } from '@/components/ui/programme-grid'
import { weekName, type GridWeek } from '@/lib/programmes'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'
import { OPEN_PAUSE_GRID, PART_PAUSE_GRID, REST_GRID, ROW_AT_45, RUN } from './programmeExamples'
import { LIMIT_GRID } from './builderExamples'

const names = Object.fromEntries(RUN.grid.activities.map((a) => [a.key, a.name]))
/** An activity's name links to its item page, whose Programme row is the ProgrammeChart. */
const itemHref = () => '#sg-programme-chart'

// A later week's Menu says what the overview would open; nothing changes here.
const answer = ref('')
function chose(what: string, key: string, week: GridWeek): void {
  answer.value = `${what}: ${names[key]}, ${weekName(week).toLowerCase()}. The overview opens the ChangeSheet.`
}
</script>

<!-- The card's six tables (components/ProgrammeGrid/preview.html), drawn by the app's own
     ProgrammeGrid from browser-built example data (programmeExamples.ts): Beginner 5×5, today Wed
     16 Dec in week 4. Each grid's region has its own name, so the page's landmarks stay unique.
     The overview round it (its line, Tabs, Changes and controls) and the preview's bar at the foot
     are ProgrammeOverview's, not the grid's. -->
<template>
  <div class="flex flex-col gap-8">
    <ExampleGroup title="Running">
      <StateExample
        state="The running programme's overview: week 4 of 8, a deload. Weeks 1 to 3 are done (met: “3 of 3”; not met: “2 of 3”), and Bench press's week 3 is split by a change on Wednesday. This week is framed, “1 of 3 so far”. Deadlift is paused for its knee. Barbell row's week 6 was set by hand. Press a later week's cell for Edit this week and Change from here."
        class="w-full"
      >
        <ProgrammeGrid
          id="sg-programme-grid-overview-running"
          class="w-full"
          :grid="RUN.grid"
          kind="strength"
          mode="running"
          label="The plan, week by week"
          :item-href="itemHref"
          @edit="(key, week) => chose('Edit this week', key, week)"
          @change="(key, week) => chose('Change from here', key, week)"
        />
      </StateExample>
    </ExampleGroup>
    <p id="sg-programme-grid-answer" class="caption text-ink-secondary" aria-live="polite">
      {{ answer || 'What a later week’s cell opens shows here.' }}
    </p>

    <ExampleGroup title="After an open pause">
      <StateExample
        state="Paused today with no end date. This week says “Paused from Wed”, and the weeks after it read “When resumed” in place of their dates."
        class="w-full"
      >
        <ProgrammeGrid
          id="sg-programme-grid-overview-open-pause"
          class="w-full"
          :grid="OPEN_PAUSE_GRID"
          kind="strength"
          mode="running"
          open-pause
          label="The paused plan, week by week"
          :item-href="itemHref"
        />
      </StateExample>
    </ExampleGroup>

    <ExampleGroup title="Paused for part of the week">
      <StateExample
        state="Deadlift paused from today, Wed 16 Dec, until Wed 30 Dec, for its knee. This week's cell and week 6's end on “Paused until Wed 30 Dec” in paused-ink at 600, so the pause stands out (K166). Week 5 is paused."
        class="w-full"
      >
        <ProgrammeGrid
          id="sg-programme-grid-overview-part-pause"
          class="w-full"
          :grid="PART_PAUSE_GRID"
          kind="strength"
          mode="running"
          label="The plan with a pause, week by week"
          :item-href="itemHref"
          @edit="(key, week) => chose('Edit this week', key, week)"
          @change="(key, week) => chose('Change from here', key, week)"
        />
      </StateExample>
    </ExampleGroup>

    <ExampleGroup title="Rest weeks">
      <StateExample
        state="A rest week is a running week planned with a goal of 0, a planned break (K170). Back squat rests in week 2, nothing marked, and in week 6, still to come; Bench press rests in week 3, with one day marked. Each reads “Rest week” over its value, never “Paused” or “0 of 0”. Deadlift's paused week 5 is there for contrast: “Paused” comes from a week's state only."
        class="w-full"
      >
        <ProgrammeGrid
          id="sg-programme-grid-overview-rest"
          class="w-full"
          :grid="REST_GRID"
          kind="strength"
          mode="running"
          label="The plan with rest weeks, week by week"
          :item-href="itemHref"
          @edit="(key, week) => chose('Edit this week', key, week)"
          @change="(key, week) => chose('Change from here', key, week)"
        />
      </StateExample>
    </ExampleGroup>

    <ExampleGroup title="Previewing a change">
      <StateExample
        state="Show it in the plan, from the change sheet's step 2: Barbell row at 45 kg from Mon 21 Dec. Each changed cell reads before → after, and week 6 keeps its hand-edit. Nothing is saved yet."
        class="w-full"
      >
        <ProgrammeGrid
          id="sg-programme-grid-preview-changed"
          class="w-full"
          :grid="ROW_AT_45.grid"
          kind="strength"
          mode="preview"
          :changes="ROW_AT_45.cells"
          label="The plan with the change, week by week"
          :item-href="itemHref"
        />
      </StateExample>
    </ExampleGroup>

    <ExampleGroup title="Undated, in the programme builder">
      <StateExample
        state="Weeks by number, every week a later week, no buttons. Deadlift grows 90 kg a week, so weeks 6 to 8 pass the 500 kg an item can hold: each of those values is in error-ink with circle-alert, and the builder says why under Deadlift’s field."
        class="w-full"
      >
        <ProgrammeGrid
          id="sg-programme-grid-builder-limit"
          class="w-full"
          :grid="LIMIT_GRID"
          kind="strength"
          mode="start"
          undated
          label="The weeks, at the default values"
        />
      </StateExample>
    </ExampleGroup>
  </div>
</template>
