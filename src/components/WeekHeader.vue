<script setup lang="ts">
import { computed } from 'vue'
import { useWindowScroll } from '@vueuse/core'
import { usePlannerStore } from '@/stores/planner'

const store = usePlannerStore()
const { y } = useWindowScroll()
/** A screen has moved under the band: it shows its hairline (K88, F1). */
const under = computed(() => y.value > 0)
</script>

<!--
  The page's one h1: the week, as the Header writes it ("19–25 October"). On the planner's screens
  it is the page's title, fixed at the top centre while Exercises and Food move under it (K86,
  K88): the title serif at --fs-title in ink, on the canvas, with a hairline in `line` once a
  screen is under it. In Edit plan the bar has the week (K81) and on a short screen there is no
  room, so there it is only for a screen reader. On paper it is set in display above the sections.
-->
<template>
  <div
    data-slot="week-band"
    :data-under="under || undefined"
    class="pb-8 print:pb-0 screen:sr-only full:not-sr-only full:sticky full:top-0 full:z-[5] full:h-(--week-band) full:border-b full:border-transparent full:bg-canvas full:px-(--screen-pad-x) full:pt-(--screen-pad-top) full:pb-(--week-pad-bottom) full:text-center full:data-under:border-line motion-safe:full:transition-colors short:sr-only"
  >
    <h1 class="display text-ink full:text-(length:--fs-title) full:leading-[1.1]">
      {{ store.label }}
    </h1>
  </div>
</template>
