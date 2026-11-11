<script setup lang="ts">
import { usePlannerStore } from '@/stores/planner'
import { useCardioStore } from '@/stores/cardio'
import { useDetailsStore } from '@/stores/details'
import { dayMonth } from '@/lib/dates'
import type { Mark } from '@/lib/storage'
import { SECTIONS } from '@/lib/trackerTypes'
import { SCREEN, SCREEN_GRID } from '@/lib/screens'
import { ChevronDown, ChevronUp, Plus } from '@lucide/vue'
import { SectionHeader } from '@/components/ui/section-header'
import { IconButton } from '@/components/ui/icon-button'
import { sprintToScreen } from '@/composables/screenSprint'
import TrackerGrid from '@/components/TrackerGrid.vue'
import { Button } from '@/components/ui/button'
import { newItemHref } from '@/lib/routes'

const planner = usePlannerStore()
const cardio = useCardioStore()
const details = useDetailsStore()
/** The section's type: its names and its chips, a time and a distance (src/lib/trackerTypes.ts). */
const type = SECTIONS.cardio

function marksFor(id: string): (Mark | null)[] {
  return planner.days.map((_, i) => cardio.markOf(id, i))
}

/** An item's notes, from its details: one copy for every week (D2). */
function noteFor(item: { id: string }): string {
  return details.notesOf('cardio', item.id)
}

/** Edit plan's Add opens the new item page (K104), not a dialog. */
function add(): void {
  location.hash = newItemHref('cardio')
}
</script>

<!--
  The Cardio section (K90): the WeekGrid with a time and a distance as chips, under its own
  SectionHeader, and in Edit plan the Add cardio button at the end of its title line (K113). It has no daily
  target, so no Stepper on its title line and no day turns green. Set apart from Exercises as Food
  is: 56u of space on screen, a rule on paper, the heading kept with its grid (F20). On the
  planner's screens it is the second of three, under the fixed week (K88), with an arrow back to
  Exercises on its title line and one on to Food at its foot (K42).
-->
<template>
  <section
    class="relative mt-8 border-t border-line pt-8 print:mt-0 print:break-before-page print:border-0 print:pt-0 screen:mt-[calc(var(--u)*56)] screen:border-0 screen:pt-0 full:mt-0 full:border-0"
    :class="SCREEN"
    data-planner-screen
    aria-labelledby="cardio-heading"
  >
    <!-- The screen's top as a snap point of its own (K118): used on a touch screen only while the
         screen is freed for a swipe up onto it, so the swipe can't rest at its foot. -->
    <div
      aria-hidden="true"
      data-snap-top
      data-noprint
      class="pointer-events-none absolute top-0 left-0 size-px"
    />
    <!-- The way back (PlannerScreen card, K42), as Food's: on the title's line just under the
         fixed week, sprinting to the top of Exercises. -->
    <IconButton
      label="Back to Exercises"
      class="absolute top-(--screen-gap-top) left-1/2 hidden -translate-x-1/2 text-ink-secondary hover:text-ink full:inline-flex edit:top-0.5 edit:inline-flex short:hidden"
      data-noprint
      data-testid="to-exercises"
      @click="sprintToScreen('exercises-heading')"
      ><ChevronUp :size="24"
    /></IconButton>
    <div
      class="print:break-inside-avoid full:flex full:min-h-0 full:flex-1 full:flex-col folded:flex-none"
      data-print-keep
    >
      <SectionHeader :title="type.label" heading-id="cardio-heading" :week="planner.label">
        <!-- Add, at the end of the title line (K113), opens the new item page (K104), at the
             page's control size. -->
        <template v-if="planner.configMode" #end>
          <Button
            class="h-(--set-control) px-(--set-control-pad) text-(length:--set-label) [&_svg]:size-(--set-icon)"
            data-add
            aria-keyshortcuts="A"
            data-testid="add-cardio"
            @click="add"
            ><Plus :stroke-width="1.5" />Add cardio</Button
          >
        </template>
      </SectionHeader>
      <TrackerGrid
        :class="SCREEN_GRID"
        :label="type.itemLabel"
        :mark-set="planner.markSet"
        section="cardio"
        :table-label="`${type.label}, week of ${dayMonth(planner.monday)}`"
        :items="cardio.items"
        :days="planner.days"
        :marks-for="marksFor"
        :details-for="type.details"
        :note-for="noteFor"
        :config-mode="planner.configMode"
        data-testid="cardio-grid"
        @toggle="cardio.toggle"
        @remove="cardio.removeCardio"
      >
        <template #corner>
          <span class="title-1 text-[24px] leading-7 text-ink">{{ type.label }}</span>
        </template>
      </TrackerGrid>
    </div>
    <!-- The way on (PlannerScreen card, K42), as Exercises': an arrow at the foot, to Food. -->
    <!-- The screen's content starts at the top and the arrow keeps to its foot (K114). -->
    <div
      class="grid grid-cols-[1fr_auto_1fr] items-center full:mt-auto full:pt-[calc(var(--u)*10)] edit:mt-auto edit:pt-[calc(var(--u)*24)]"
      data-noprint
    >
      <IconButton
        label="Go to Food"
        class="col-start-2 hidden text-ink-secondary hover:text-ink full:inline-flex edit:inline-flex short:hidden"
        data-testid="to-food"
        @click="sprintToScreen('diet-heading')"
        ><ChevronDown :size="24"
      /></IconButton>
    </div>
  </section>
</template>
