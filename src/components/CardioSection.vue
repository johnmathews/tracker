<script setup lang="ts">
import { ref, watch } from 'vue'
import { usePlannerStore } from '@/stores/planner'
import { useCardioStore } from '@/stores/cardio'
import { useDetailsStore } from '@/stores/details'
import { dayMonth } from '@/lib/dates'
import type { Cardio, Mark } from '@/lib/storage'
import { SECTIONS } from '@/lib/trackerTypes'
import { SCREEN, SCREEN_GRID } from '@/lib/screens'
import { ChevronDown, ChevronUp, Plus } from '@lucide/vue'
import { SectionHeader } from '@/components/ui/section-header'
import { IconButton } from '@/components/ui/icon-button'
import { sprintToScreen } from '@/composables/screenSprint'
import TrackerGrid from '@/components/TrackerGrid.vue'
import { Button } from '@/components/ui/button'
import EditCardioDialog from '@/components/EditCardioDialog.vue'

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

const editing = ref<Cardio | null>(null)
/** The Add cardio dialog (K54): Edit cardio's dialog with nothing to edit. */
const adding = ref(false)

function edit(id: string): void {
  editing.value = cardio.items.find((c) => c.id === id) ?? null
}

// As in ExerciseGrid: close the dialog if another tab deletes the item, or if the week changes
// under it, rather than save into a week the user didn't open it for.
watch(
  () => cardio.items,
  (list) => {
    if (editing.value && !list.some((c) => c.id === editing.value!.id)) editing.value = null
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
  The Cardio section (K90): the WeekGrid with a time and a distance as chips, under its own
  SectionHeader, and in Edit plan the Add cardio button under the grid (K54). It has no daily
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
    <!-- The way back (PlannerScreen card, K42), as Food's: on the title's line just under the
         fixed week, sprinting to the top of Exercises. -->
    <IconButton
      label="Back to Exercises"
      class="absolute top-(--screen-gap-top) left-1/2 hidden -translate-x-1/2 text-ink-secondary hover:text-ink full:inline-flex short:hidden"
      data-noprint
      data-testid="to-exercises"
      @click="sprintToScreen('exercises-heading')"
      ><ChevronUp :size="24"
    /></IconButton>
    <div
      class="print:break-inside-avoid full:flex full:min-h-0 full:flex-1 full:flex-col folded:flex-none"
      data-print-keep
    >
      <SectionHeader :title="type.label" heading-id="cardio-heading" :week="planner.label" />
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
        editable
        :config-mode="planner.configMode"
        data-testid="cardio-grid"
        @toggle="cardio.toggle"
        @remove="cardio.removeCardio"
        @edit="edit"
      >
        <template #corner>
          <span class="title-1 text-[24px] leading-7 text-ink">{{ type.label }}</span>
        </template>
      </TrackerGrid>
    </div>
    <!-- The way on (PlannerScreen card, K42), as Exercises': an arrow at the foot, to Food. -->
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
      v-if="planner.configMode"
      class="mt-[calc(var(--u)*24)] h-(--set-control) self-start px-(--set-control-pad) text-(length:--set-label) [&_svg]:size-(--set-icon)"
      data-noprint
      data-add
      data-testid="add-cardio"
      @click="adding = true"
      ><Plus :stroke-width="1.5" />Add cardio</Button
    >
    <EditCardioDialog v-if="editing" :item="editing" @close="editing = null" />
    <EditCardioDialog v-if="adding" @close="adding = false" />
  </section>
</template>
