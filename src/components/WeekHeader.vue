<script setup lang="ts">
import { computed } from 'vue'
import { useWindowScroll } from '@vueuse/core'
import { usePlannerStore } from '@/stores/planner'
import { Button } from '@/components/ui/button'

const store = usePlannerStore()
const { y } = useWindowScroll()
/** A screen has moved under the band: it shows its hairline (K88, F1). */
const under = computed(() => y.value > 0)
/** "View current week" shows in the band: another week, in the week view (K130). */
const showButton = computed(() => store.otherWeek && !store.configMode)
</script>

<!--
  The page's one h1: the week, as the Header writes it ("19–25 October"), or its number ("Week
  46"; K131), with the dates for a screen reader. On the planner's screens it is the page's title,
  fixed at the top centre while the trackers' screens move under it (K86, K88): the title serif at
  --fs-title in ink, on the canvas, with a hairline in `line` once a screen is under it. In Edit
  plan the bar has the week (K81) and on a short screen there is no room, so there it is only for
  a screen reader. On paper too: each section prints on a page of its own, with the week over it
  (SectionHeader, K97).

  While another week is on screen, "View current week" follows the title, the two centred together
  (K130). It shows only on the planner's screens, never on a short one or on paper, so it is
  never focusable out of sight. Folded, it sits under the title, and the band is a row taller
  while it shows (main.css, the week band).
-->
<template>
  <div
    data-slot="week-band"
    :data-under="under || undefined"
    :data-other-week="showButton || undefined"
    class="pb-8 print:sr-only screen:sr-only full:not-sr-only full:sticky full:top-0 full:z-[5] full:flex full:h-(--week-band) full:items-center full:justify-center full:border-b full:border-transparent full:bg-canvas full:px-(--screen-pad-x) full:pt-(--screen-pad-top) full:pb-(--week-pad-bottom) full:text-center full:data-under:border-line motion-safe:full:transition-colors folded:flex-col folded:gap-y-(--this-week-under) short:sr-only"
  >
    <h1
      data-slot="week-band-title"
      class="display whitespace-nowrap text-ink full:text-(length:--fs-title) full:leading-[1.1]"
    >
      {{ store.label
      }}<span v-if="store.weekTitle === 'number'" class="sr-only">, {{ store.dates }}</span>
    </h1>
    <Button
      v-if="showButton"
      class="hidden h-(--this-week-h) px-(--this-week-pad-x) text-(length:--this-week-text) full:ml-(--this-week-gap) full:inline-flex folded:ml-0 short:hidden"
      data-testid="band-this-week-button"
      data-noprint
      @click="store.thisWeek"
      >View current week</Button
    >
  </div>
</template>
