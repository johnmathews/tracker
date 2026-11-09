<script setup lang="ts">
defineProps<{
  /** "Exercises", "Food": sentence case, no icon. */
  title: string
  /**
   * The week ("9–15 November"), on paper only: each section prints on a page of its own, under
   * the week in display (K97). On screen the fixed week above the screens has it (K88).
   */
  week?: string
  /** One optional line of plain instructions; small numbers as words. It doesn't print. */
  hint?: string
  /** The h2's id, for the section's aria-labelledby. */
  headingId: string
}>()
</script>

<!--
  The heading over a WeekGrid (brand/design-system/project/components/SectionHeader): on screen, the
  section's title in the serif a step under the week's (title-1 at --fs-section; K87), and the
  optional hint beneath in caption ink-secondary. The week is the page's title, which WeekHeader
  keeps fixed above the planner's screens (K86, K88), so it shows here only on paper, where each
  section has a page of its own under it in display (K97). On paper the title
  is title-1 at its own size. No figure: the sections' weekly figures were removed (K31). On paper
  the heading never ends a page without its grid (F20) and the hint stays off the sheet (F24). On
  the planner's screens the title grows with the screen; on a short screen the whole line moves
  into the WeekGrid's corner, so here it stays only for a screen reader.
-->
<template>
  <header
    data-slot="section-header"
    class="flex flex-wrap items-baseline gap-x-[max(24px,calc(var(--u)*28))] gap-y-3 pb-6 print:break-after-avoid print:pb-3 screen:grid screen:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] screen:items-center screen:pb-[calc(var(--u)*20)] folded:flex folded:pb-3 short:sr-only"
  >
    <!-- On paper, the week over each section's page (K97); on screen, the fixed week has it. It
         repeats the page's h1, so it is hidden from a screen reader. -->
    <p
      v-if="week"
      aria-hidden="true"
      data-slot="section-week"
      class="display hidden text-ink print:block print:basis-full print:pb-3"
    >
      {{ week }}
    </p>
    <div class="flex min-w-0 flex-col gap-1">
      <h2
        :id="headingId"
        class="title-1 text-ink screen:text-(length:--fs-section) screen:leading-tight"
      >
        {{ title }}
      </h2>
      <p v-if="hint" data-slot="section-hint" class="caption text-ink-secondary" data-noprint>
        {{ hint }}
      </p>
    </div>
    <!-- The section's actions, centred on the title line (Edit plan's daily target, K62): the line
         is three columns on screen, like the Header's, so they sit under the bar's week. Folded
         they follow the title, wrapping under it when the line is too narrow. -->
    <slot name="actions" />
  </header>
</template>
