<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { usePlannerStore } from '@/stores/planner'
import { useDietStore } from '@/stores/diet'
import { useDetailsStore } from '@/stores/details'
import { dayMonth } from '@/lib/dates'
import { metDays as daysMet } from '@/lib/tracker'
import { MAX_DAILY_PICK, MIN_DAILY_PICK, type Food, type Mark } from '@/lib/storage'
import { SECTIONS } from '@/lib/trackerTypes'
import { SCREEN, SCREEN_GRID } from '@/lib/screens'
import { ChevronUp, Plus } from '@lucide/vue'
import { SectionHeader } from '@/components/ui/section-header'
import { IconButton } from '@/components/ui/icon-button'
import { sprintToScreen } from '@/composables/screenSprint'
import TrackerGrid from '@/components/TrackerGrid.vue'
import { Button } from '@/components/ui/button'
import { Stepper } from '@/components/ui/stepper'
import EditFoodDialog from '@/components/EditFoodDialog.vue'

const planner = usePlannerStore()
const diet = useDietStore()
const details = useDetailsStore()
/** The section's type: its names and its chips, which for a food are none (src/lib/trackerTypes.ts). */
const type = SECTIONS.diet

/**
 * The days whose marked foods reach foods a day (K57): their names turn green, underlined, as
 * exercises'. None while Daily goal is off (K85).
 */
const metDays = computed(() =>
  planner.dailyGoal ? daysMet(diet.dayCounts, planner.foodPick) : planner.days.map(() => false),
)
/** Foods a day, set on the title line in Edit plan (K56). */
const foodPick = computed({
  get: () => planner.foodPick,
  set: (value: number) => planner.changeFoodPick(value - planner.foodPick),
})

function marksFor(id: string): (Mark | null)[] {
  return planner.days.map((_, i) => diet.markOf(id, i))
}

/** A food's notes, from its details: one copy for every week (D2). */
function noteFor(item: { id: string }): string {
  return details.notesOf('diet', item.id)
}

const editing = ref<Food | null>(null)
/** The Add food dialog (K54): Edit food's dialog with nothing to edit. */
const adding = ref(false)

function edit(id: string): void {
  editing.value = diet.foods.find((f) => f.id === id) ?? null
}

// As in ExerciseGrid: close the dialog if another tab deletes the food, or if the week changes
// under it, rather than save into a week the user didn't open it for.
watch(
  () => diet.foods,
  (list) => {
    if (editing.value && !list.some((f) => f.id === editing.value!.id)) editing.value = null
  },
)
watch(
  () => planner.weekKey,
  () => {
    editing.value = null
    adding.value = false
  },
)
</script>

<!--
  The Food section: the same WeekGrid without chips (the food type has none), under its own
  SectionHeader, and in Edit plan Foods a day centred on the title line, reading "2 per day" (K56, K62, K63) and the Add food
  button under the grid (K54). On screen 56u of space
  sets it apart from Exercises, with no rule. On paper the heading and the grid stay on one page
  (F20): the header avoids a break after it, and the pair avoids a break inside. On the planner's
  screens it is the second screen, with nothing ruling it off.
-->
<template>
  <section
    class="relative mt-8 border-t border-line pt-8 print:mt-4 print:border-0 print:pt-4 screen:mt-[calc(var(--u)*56)] screen:border-0 screen:pt-0 full:mt-0 full:border-0"
    :class="SCREEN"
    data-planner-screen
    aria-labelledby="diet-heading"
  >
    <!-- The way back (PlannerScreen card, K42): an arrow on the screen's top, below the bar's
         strip and handle, sprinting to the top of Exercises. -->
    <IconButton
      label="Back to Exercises"
      class="absolute top-12 left-1/2 hidden -translate-x-1/2 text-ink-secondary hover:text-ink full:inline-flex short:hidden"
      data-noprint
      data-testid="to-exercises"
      @click="sprintToScreen('exercises-heading')"
      ><ChevronUp :size="24"
    /></IconButton>
    <div
      class="print:break-inside-avoid full:flex full:min-h-0 full:flex-1 full:flex-col folded:flex-none"
      data-print-keep
    >
      <SectionHeader
        :title="type.label"
        heading-id="diet-heading"
        :week="planner.configMode ? undefined : planner.label"
      >
        <template v-if="planner.configMode && planner.dailyGoal" #actions>
          <!-- Centred on the title line (K62), the Stepper alone, reading "− 3 per day +" (K63): its
             label, "Foods a day", is for a screen reader. -->
          <div data-slot="day-target" data-noprint>
            <Stepper
              v-model="foodPick"
              label="Foods a day"
              lower-label="Fewer foods a day"
              raise-label="More foods a day"
              :min="MIN_DAILY_PICK"
              :max="MAX_DAILY_PICK"
              hide-label
              suffix="per day"
              data-testid="foods-a-day"
            />
          </div>
        </template>
      </SectionHeader>
      <TrackerGrid
        :class="SCREEN_GRID"
        :label="type.itemLabel"
        :mark-set="planner.markSet"
        section="diet"
        :table-label="`${type.label}, week of ${dayMonth(planner.monday)}`"
        :items="diet.foods"
        :days="planner.days"
        :marks-for="marksFor"
        :details-for="type.details"
        :note-for="noteFor"
        editable
        :config-mode="planner.configMode"
        :met-days="metDays"
        data-testid="diet-grid"
        @toggle="diet.toggle"
        @remove="diet.removeFood"
        @edit="edit"
      >
        <template #corner>
          <span class="title-1 text-[24px] leading-7 text-ink">{{ type.label }}</span>
        </template>
      </TrackerGrid>
    </div>
    <!-- Adding opens the same dialog as editing (K54), at the page's control size. -->
    <Button
      v-if="planner.configMode"
      class="mt-[calc(var(--u)*24)] h-(--set-control) self-start px-(--set-control-pad) text-(length:--set-label) [&_svg]:size-(--set-icon)"
      data-noprint
      data-add
      data-testid="add-food"
      @click="adding = true"
      ><Plus :stroke-width="1.5" />Add food</Button
    >
    <EditFoodDialog v-if="editing" :food="editing" @close="editing = null" />
    <EditFoodDialog v-if="adding" @close="adding = false" />
  </section>
</template>
