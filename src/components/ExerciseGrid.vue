<script setup lang="ts">
import { computed } from 'vue'
import { usePlannerStore } from '@/stores/planner'
import { useDetailsStore } from '@/stores/details'
import type { Mark } from '@/lib/storage'
import { SECTIONS } from '@/lib/trackerTypes'
import { metDays as daysMet } from '@/lib/tracker'
import { dayMonth } from '@/lib/dates'
import { ChevronDown, Plus } from '@lucide/vue'
import { SCREEN, SCREEN_GRID } from '@/lib/screens'
import { IconButton } from '@/components/ui/icon-button'
import { sprintToScreen } from '@/composables/screenSprint'
import { SectionHeader } from '@/components/ui/section-header'
import TrackerGrid from '@/components/TrackerGrid.vue'
import { Button } from '@/components/ui/button'
import { Stepper } from '@/components/ui/stepper'
import { MAX_DAILY_PICK, MIN_DAILY_PICK } from '@/lib/storage'
import { newItemHref } from '@/lib/routes'

const store = usePlannerStore()
const details = useDetailsStore()
/** The section's type: its names and its chips (src/lib/trackerTypes.ts). */
const type = SECTIONS.exercise

/**
 * The days whose marked exercises reach the daily pick (K30): their names turn green, underlined
 * (K60). None while Daily goal is off (K85).
 */
const metDays = computed(() =>
  store.dailyGoal ? daysMet(store.dayCounts, store.dailyPick) : store.days.map(() => false),
)
/** Exercises a day, set on the title line in Edit plan (K56). */
const dailyPick = computed({
  get: () => store.dailyPick,
  set: (value: number) => store.changeDailyPick(value - store.dailyPick),
})

function marksFor(id: string): (Mark | null)[] {
  return store.days.map((_, i) => store.markOf(id, i))
}

/** An exercise's notes, from its details: one copy for every week (D2). */
function noteFor(item: { id: string }): string {
  return details.notesOf('exercise', item.id)
}

/** Edit plan's Add opens the new item page (K104), not a dialog. */
function add(): void {
  location.hash = newItemHref('exercise')
}
</script>

<!-- The Exercises section (SectionHeader, WeekGrid and PlannerScreen cards): its heading; in Edit
     plan with Exercises a day centred on its line, reading "3 per day" (K56, K62, K63), and the Add
     exercise button under the grid (K54). On the planner's screens it is the first screen, under
     the fixed week (K88): the slot's messages at its top, the arrow to Cardio at its foot. -->
<template>
  <section
    aria-labelledby="exercises-heading"
    class="pt-8 print:pt-0"
    :class="SCREEN"
    data-planner-screen
  >
    <slot />
    <SectionHeader :title="type.label" heading-id="exercises-heading" :week="store.label">
      <template v-if="store.configMode && store.dailyGoal" #actions>
        <!-- Centred on the title line (K62), the Stepper alone, reading "− 3 per day +" (K63): its
             label, "Exercises a day", is for a screen reader. -->
        <div data-slot="day-target" data-noprint>
          <Stepper
            v-model="dailyPick"
            label="Exercises a day"
            lower-label="Fewer exercises a day"
            raise-label="More exercises a day"
            :min="MIN_DAILY_PICK"
            :max="MAX_DAILY_PICK"
            hide-label
            suffix="per day"
            data-testid="exercises-a-day"
          />
        </div>
      </template>
    </SectionHeader>
    <TrackerGrid
      :class="SCREEN_GRID"
      :label="type.itemLabel"
      :mark-set="store.markSet"
      section="exercise"
      :table-label="`${type.label}, week of ${dayMonth(store.monday)}`"
      :items="store.exercises"
      :days="store.days"
      :marks-for="marksFor"
      :details-for="type.details"
      :note-for="noteFor"
      :config-mode="store.configMode"
      :met-days="metDays"
      data-testid="exercise-grid"
      @toggle="store.toggle"
      @remove="store.removeExercise"
    >
      <template #corner>
        <span class="title-1 text-[24px] leading-7 text-ink">{{ type.label }}</span>
      </template>
    </TrackerGrid>
    <!-- The way on (PlannerScreen card, K42): an arrow, no words, sprinting to the Cardio screen,
         the next of three (K90). -->
    <!-- In Edit plan the arrow is centred on Add's line, under the grid (K99). -->
    <div
      class="grid grid-cols-[1fr_auto_1fr] items-center full:mt-[calc(var(--u)*10)] edit:mt-[calc(var(--u)*24)]"
      data-noprint
    >
      <!-- Add opens the new item page (K104), at the page's control size. -->
      <Button
        v-if="store.configMode"
        class="col-start-1 h-(--set-control) justify-self-start px-(--set-control-pad) text-(length:--set-label) [&_svg]:size-(--set-icon)"
        data-add
        data-testid="add-exercise"
        @click="add"
        ><Plus :stroke-width="1.5" />Add exercise</Button
      >
      <IconButton
        label="Go to Cardio"
        class="col-start-2 hidden text-ink-secondary hover:text-ink full:inline-flex edit:inline-flex short:hidden"
        data-testid="to-cardio"
        @click="sprintToScreen('cardio-heading')"
        ><ChevronDown :size="24"
      /></IconButton>
    </div>
  </section>
</template>
