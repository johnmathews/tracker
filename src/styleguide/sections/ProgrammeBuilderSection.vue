<script setup lang="ts">
import { reactive } from 'vue'
import ActivityCard from '@/components/ActivityCard.vue'
import { ProgrammeGrid } from '@/components/ui/programme-grid'
import { InlineMessage } from '@/components/ui/inline-message'
import { newSession, type ProgrammeDoc } from '@/lib/programmeDraft'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'
import { LIMIT, LIMIT_GRID, builderDoc } from './builderExamples'

// The page's own draft: its cards open and change here only; nothing is saved.
const doc = reactive(builderDoc()) as ProgrammeDoc
const session = newSession()
const state = reactive({ open: null as number | null })
const problems = (i: number) =>
  doc.activities[i]!.key === 'deadlift' ? [{ fieldId: 'weight', message: LIMIT }] : []
function toggle(i: number): void {
  state.open = state.open === i ? null : i
}
</script>

<!-- The page's parts (components/ProgrammeBuilder/preview.html): the Activities section of the
     form beside the weeks, as ProgrammeBuilder lays them out from 1024px up, one under the other
     below. The page itself (`#/programmes/new`) checks the draft with the server and has the foot
     bar fixed to the window, so the style guide shows its parts: ActivityCard, ValueField and the
     undated ProgrammeGrid with a week over the limit. -->
<template>
  <ExampleGroup>
    <StateExample
      state="A new programme, Beginner 5×5 with one mistake: Deadlift grows 90 kg a week. Its card shows the problem, and weeks 6 to 8 of its row are in error-ink. Press a card to open it."
      class="w-full"
    >
      <div
        id="sg-programme-builder-limit"
        class="w-full lg:grid lg:grid-cols-[minmax(0,calc(var(--u)*520))_minmax(0,1fr)] lg:items-start lg:gap-x-[calc(var(--u)*48)]"
      >
        <section
          class="flex min-w-0 flex-col gap-4"
          aria-labelledby="sg-programme-builder-activities"
        >
          <h3
            id="sg-programme-builder-activities"
            class="font-sans text-(length:--set-h2) leading-tight font-semibold text-ink"
          >
            Activities
          </h3>
          <p class="body text-ink-secondary">Five of at most 30. Press one to change it.</p>
          <ul class="flex flex-col gap-3" aria-labelledby="sg-programme-builder-activities">
            <ActivityCard
              v-for="(a, i) in doc.activities"
              :key="a.key"
              :doc="doc"
              :session="session"
              :index="i"
              :open="state.open === i"
              :problems="problems(i)"
              @toggle="toggle(i)"
            />
          </ul>
        </section>
        <aside
          class="mt-6 flex min-w-0 flex-col gap-1.5 lg:mt-0"
          aria-labelledby="sg-programme-builder-weeks"
        >
          <h3
            id="sg-programme-builder-weeks"
            class="font-sans text-(length:--set-h2) leading-tight font-semibold text-ink"
          >
            The weeks
          </h3>
          <p class="caption text-ink-secondary">
            Weeks by number, at the default values. It updates a moment after each change.
          </p>
          <ProgrammeGrid
            class="mt-2"
            :grid="LIMIT_GRID"
            kind="strength"
            mode="start"
            undated
            label="The builder’s weeks, at the default values"
          />
        </aside>
      </div>
    </StateExample>
    <StateExample
      state="Before any plan, or while the draft can’t be expanded (a problem other than a week over a limit): the line over the weeks, which keep the last plan with no problems."
      class="w-full"
    >
      <InlineMessage id="sg-programme-builder-kept" tone="info"
        >The weeks show the last version with no problems.</InlineMessage
      >
    </StateExample>
  </ExampleGroup>
</template>
