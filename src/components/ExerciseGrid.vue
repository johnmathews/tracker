<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { usePlannerStore } from '@/stores/planner'
import { useDetailsStore } from '@/stores/details'
import type { Exercise, Mark } from '@/lib/storage'
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
import EditExerciseDialog from '@/components/EditExerciseDialog.vue'

const store = usePlannerStore()
const details = useDetailsStore()
/** The section's type: its names and its chips (src/lib/trackerTypes.ts). */
const type = SECTIONS.exercise

/** The days whose marked exercises reach the daily pick (K30): their names turn green, underlined (K60). */
const metDays = computed(() => daysMet(store.dayCounts, store.dailyPick))
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

const editing = ref<Exercise | null>(null)
/** The Add exercise dialog (K54): Edit exercise's dialog with nothing to edit. */
const adding = ref(false)

function edit(id: string): void {
  editing.value = store.exercises.find((e) => e.id === id) ?? null
}

// Another tab can delete the exercise while its dialog is open here; close it rather than leave
// a Save that can't apply.
watch(
  () => store.exercises,
  (list) => {
    if (editing.value && !list.some((e) => e.id === editing.value!.id)) editing.value = null
  },
)
// Saving edits the visible week, so if the week changes under an open dialog (the clock passing
// midnight on Sunday), close it rather than save into a week the user didn't open it for.
watch(
  () => store.weekKey,
  () => {
    editing.value = null
    adding.value = false
  },
)
</script>

<!-- The Exercises section (SectionHeader, WeekGrid and PlannerScreen cards): its heading and the
     week; in Edit plan the heading alone with Exercises a day centred on its line, reading "3 per day" (K56, K62, K63), and
     the Add exercise button under the grid (K54). On the planner's screens it is
     the first screen: the slot's messages and the page's h1 at its top, the arrow to Food at its
     foot. -->
<template>
  <section
    aria-labelledby="exercises-heading"
    class="pt-8 print:pt-4"
    :class="SCREEN"
    data-planner-screen
  >
    <slot />
    <SectionHeader
      :title="type.label"
      heading-id="exercises-heading"
      :week="store.configMode ? undefined : store.label"
    >
      <template v-if="store.configMode" #actions>
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
      editable
      :config-mode="store.configMode"
      :met-days="metDays"
      data-testid="exercise-grid"
      @toggle="store.toggle"
      @remove="store.removeExercise"
      @edit="edit"
    >
      <template #corner>
        <span class="title-1 text-[24px] leading-7 text-ink">{{ type.label }}</span>
      </template>
    </TrackerGrid>
    <!-- The way on (PlannerScreen card, K42): an arrow, no words, sprinting to the Food screen. -->
    <IconButton
      label="Go to Food"
      class="hidden self-center text-ink-secondary hover:text-ink full:mt-[calc(var(--u)*10)] full:inline-flex short:hidden"
      data-noprint
      data-testid="to-food"
      @click="sprintToScreen('diet-heading')"
      ><ChevronDown :size="24"
    /></IconButton>
    <!-- Adding opens the same dialog as editing (K54), at the page's control size. -->
    <Button
      v-if="store.configMode"
      class="mt-[calc(var(--u)*24)] h-(--set-control) self-start px-(--set-control-pad) text-(length:--set-label) [&_svg]:size-(--set-icon)"
      data-noprint
      data-add
      data-testid="add-exercise"
      @click="adding = true"
      ><Plus :stroke-width="1.5" />Add exercise</Button
    >
    <EditExerciseDialog v-if="editing" :exercise="editing" @close="editing = null" />
    <EditExerciseDialog v-if="adding" @close="adding = false" />
  </section>
</template>
