<script setup lang="ts">
defineProps<{
  /** "Exercises", "Food": sentence case, no icon. */
  title: string
  /**
   * The week, as the Header writes it ("19–25 October"): on the planner's screens it is the
   * screen's title, centred above the section's heading (K86). The page's h1 says it to a screen
   * reader, so this is hidden from one. Edit plan has the week in its bar (K81) and passes none; on
   * paper it is left out.
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
  week centred above as the screen's title (title-1 at --fs-title, ink; K86), then the section's
  title in the same serif a step smaller (title-1 at --fs-section; K87), and the optional hint
  beneath in caption ink-secondary. On paper the title is title-1 at its own size. No figure:
  the sections' weekly figures were removed (K31). On paper the heading never ends a
  page without its grid (F20) and the hint stays off the sheet (F24). On the planner's screens the
  title grows with the screen and the week follows it; on a short screen the whole line moves into
  the WeekGrid's corner, so here it stays only for a screen reader.
-->
<template>
  <header
    data-slot="section-header"
    class="flex flex-wrap items-baseline gap-x-[max(24px,calc(var(--u)*28))] gap-y-3 pb-6 print:break-after-avoid print:pb-3 screen:grid screen:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] screen:items-center screen:pb-[calc(var(--u)*20)] folded:flex folded:pb-3 short:sr-only"
  >
    <!-- The week, the screen's title (K86), across the whole line and centred. It repeats the
         page's h1, which a screen reader already has, so it is hidden from one. -->
    <p
      v-if="week"
      aria-hidden="true"
      data-slot="section-week"
      class="title-1 hidden text-ink screen:col-span-full screen:mb-[calc(var(--u)*12)] screen:block screen:text-center screen:text-(length:--fs-title) screen:leading-tight folded:mb-1 folded:basis-full"
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
