<script setup lang="ts">
import { computed } from 'vue'
import { usePlannerStore } from '@/stores/planner'
import { useDietStore } from '@/stores/diet'
import { useDetailsStore } from '@/stores/details'
import { dayMonth } from '@/lib/dates'
import { metDays as daysMet } from '@/lib/tracker'
import { MAX_DAILY_PICK, MIN_DAILY_PICK, type Mark } from '@/lib/storage'
import { SECTIONS } from '@/lib/trackerTypes'
import { SCREEN, SCREEN_GRID } from '@/lib/screens'
import { ChevronUp, Plus } from '@lucide/vue'
import { SectionHeader } from '@/components/ui/section-header'
import { IconButton } from '@/components/ui/icon-button'
import { sprintToScreen } from '@/composables/screenSprint'
import TrackerGrid from '@/components/TrackerGrid.vue'
import { Button } from '@/components/ui/button'
import { Stepper } from '@/components/ui/stepper'
import { newItemHref } from '@/lib/routes'

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

/** Edit plan's Add opens the new item page (K104), not a dialog. */
function add(): void {
  location.hash = newItemHref('diet')
}
</script>

<!--
  The Food section: the same WeekGrid without chips (the food type has none), under its own
  SectionHeader, and in Edit plan Foods a day centred on the title line, reading "2 per day" (K56, K62, K63) and the Add food
  button at the line's end (K113). On screen 56u of space
  sets it apart from Cardio, with no rule. On paper the heading and the grid stay on one page
  (F20): the header avoids a break after it, and the pair avoids a break inside. On the planner's
  screens it is the third screen, after Cardio (K90), under the fixed week (K88), with nothing
  ruling it off.
-->
<template>
  <section
    class="relative mt-8 border-t border-line pt-8 print:mt-0 print:break-before-page print:border-0 print:pt-0 screen:mt-[calc(var(--u)*56)] screen:border-0 screen:pt-0 full:mt-0 full:border-0"
    :class="SCREEN"
    data-planner-screen
    aria-labelledby="diet-heading"
  >
    <!-- The screen's top as a snap point of its own (K118): used on a touch screen only while the
         screen is freed for a swipe up onto it, so the swipe can't rest at its foot. -->
    <div
      aria-hidden="true"
      data-snap-top
      data-noprint
      class="pointer-events-none absolute top-0 left-0 size-px"
    />
    <!-- The way back (PlannerScreen card, K42): an arrow on the screen's top, on the title's line
         just under the fixed week (K88), sprinting to the top of Cardio, the screen before (K90). -->
    <IconButton
      label="Back to Cardio"
      class="absolute top-(--screen-gap-top) left-1/2 hidden -translate-x-1/2 text-ink-secondary hover:text-ink full:inline-flex edit:top-0.5 edit:inline-flex short:hidden"
      data-noprint
      data-testid="back-to-cardio"
      @click="sprintToScreen('cardio-heading')"
      ><ChevronUp :size="24"
    /></IconButton>
    <div
      class="print:break-inside-avoid full:flex full:min-h-0 full:flex-1 full:flex-col folded:flex-none"
      data-print-keep
    >
      <SectionHeader :title="type.label" heading-id="diet-heading" :week="planner.label">
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
        <!-- Add, at the end of the title line (K113), opens the new item page (K104), at the
             page's control size. -->
        <template v-if="planner.configMode" #end>
          <Button
            class="h-(--set-control) px-(--set-control-pad) text-(length:--set-label) [&_svg]:size-(--set-icon)"
            data-add
            aria-keyshortcuts="A"
            data-testid="add-food"
            @click="add"
            ><Plus :stroke-width="1.5" />Add food</Button
          >
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
        :config-mode="planner.configMode"
        :met-days="metDays"
        data-testid="diet-grid"
        @toggle="diet.toggle"
        @remove="diet.removeFood"
      >
        <template #corner>
          <span class="title-1 text-[24px] leading-7 text-ink">{{ type.label }}</span>
        </template>
      </TrackerGrid>
    </div>
  </section>
</template>
