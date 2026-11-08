<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Maximize,
  MessageCircle,
  Minimize,
  Pencil,
  Printer,
  Settings,
} from '@lucide/vue'
import { usePlannerStore } from '@/stores/planner'
import { useSessionStore } from '@/stores/session'
import { weekRange } from '@/lib/dates'
import { BarAction } from '@/components/ui/bar-action'
import { BrandMark } from '@/components/ui/brand-mark'
import { IconButton } from '@/components/ui/icon-button'
import { useBarReveal } from '@/composables/barReveal'
import { useFullscreen } from '@/composables/fullscreen'

const props = defineProps<{
  /**
   * On the planner's screens the bar is out of sight (Header card, K25, K80): a long press or
   * the handle opens Edit plan, where it is in view, and focus floats it over the screen.
   */
  overlay?: boolean
}>()

const store = usePlannerStore()
const header = ref<HTMLElement | null>(null)
// A long press toggles Edit plan, on the screens and in Edit plan; the handle opens it (K80).
const reveal = useBarReveal(header, {
  overlay: toRef(() => props.overlay),
  holdable: toRef(() => props.overlay || store.configMode),
  onLongPress: () => store.setConfigMode(!store.configMode),
  onHandle: () => store.setConfigMode(true),
})
const fullscreen = useFullscreen()

const session = useSessionStore()
const otherWeek = computed(() => store.weekKey !== store.currentWeekKey)

function print(): void {
  window.print()
}

/** Settings is a page of its own (#/settings); App shows it on the hash change. */
function openSettings(): void {
  location.hash = '#/settings'
}

/** Ask is a page of its own too (#/ask). */
function openAsk(): void {
  location.hash = '#/ask'
}

/**
 * Today's cell in the first grid that shows today (Exercises, or Food when there are no
 * exercises); in another week, the first day; with no rows anywhere, the first grid's tab stop.
 */
function skipToToday(): void {
  const grids = [...document.querySelectorAll<HTMLElement>('[role="grid"]')]
  const first = (selector: string) =>
    grids.map((g) => g.querySelector<HTMLElement>(selector)).find((el) => el !== null)
  ;(
    first('button[aria-current="date"]') ??
    first('[data-slot="day-mark-button"]') ??
    first('[tabindex="0"]')
  )?.focus()
}
</script>

<!--
  The Header card (brand/design-system/project/components/Header), full width and as big as the
  week below it (K47): the wordmark, then "This week" while another week is on screen, beside
  the week navigation at the centre (K50), then the BarActions Edit plan (a toggle, filled while
  on; K48), Ask (which opens the Ask page, only while the API answers questions), Settings (which
  opens the Settings page), Print and, last, Full screen (K49). The Settings and Ask pages have no
  bar (K52): they link back to the week themselves. Every size is a `--bar-*`
  size from main.css, so
  the bar follows the screen. Folded, the planner's bar drops the wordmark, the week takes the
  first row (CSS order) and the actions share the second; the markup stays in the desktop order,
  which is the tab order.

  "Skip to today" comes first in the tab order (F15): hidden until it has focus, then shown over
  the wordmark with the focus ring; it puts focus on today's cell, past the Header.

  With `overlay` (the planner's screens) the bar is fixed above the top edge (Header card, Out of
  sight). A long press anywhere, or the handle at the top centre wherever a finger may be, opens
  Edit plan (K80), where the bar is sticky and the page sits below it, so it covers nothing; a
  long press there closes it again. Focus inside the bar slides it down over the screen, so it
  stays reachable by Tab: it is moved out of view, never hidden.
-->
<template>
  <template v-if="overlay">
    <!-- The handle (Header card): a 40 × 5px pill in an 88 × 44px target. A raw button, since
         no primitive draws a handle; it is named for what it does, opening Edit plan (K80). It
         is for a finger, so it stays out of the Tab order: the keyboard brings the bar by focus,
         and the bar's own Edit plan button. -->
    <button
      type="button"
      aria-label="Edit plan"
      tabindex="-1"
      data-slot="bar-handle"
      class="fixed top-0 left-1/2 z-10 hidden h-11 w-22 -translate-x-1/2 touch-none [@media(any-pointer:coarse)]:block"
      data-noprint
      @pointerdown="reveal.onHandleDown"
      @pointermove="reveal.onHandleMove"
      @click="reveal.onHandleClick"
    >
      <span class="mx-auto mt-2 block h-1.25 w-10 rounded-full bg-control-border" />
    </button>
  </template>
  <header
    ref="header"
    data-slot="bar"
    class="top-0 z-20 border-b border-line bg-canvas"
    :class="
      overlay
        ? [
            'fixed inset-x-0 -translate-y-[110%] focus-within:translate-y-0 focus-within:shadow-overlay motion-safe:transition-transform motion-safe:duration-160 motion-safe:ease-out',
          ]
        : 'sticky'
    "
    data-noprint
  >
    <div class="absolute top-1.5 left-2 z-30">
      <!-- not-sr-only zeroes the link's padding, so the span carries it. -->
      <a
        href="#exercises-heading"
        class="sr-only rounded-md bg-panel text-base font-semibold text-ink underline underline-offset-4 shadow-overlay focus:not-sr-only focus:block"
        data-testid="skip-to-today"
        @click.prevent="skipToToday"
        ><span class="block px-3 py-2">Skip to today</span></a
      >
    </div>
    <!-- Three columns, the outer two equal, so the week sits at the bar's centre (Header card),
         on the page's own margins. Folded, a wrapping row: the week moves first and takes the
         whole line, and the two groups dissolve so every action shares the second line. -->
    <div
      class="grid grid-cols-[1fr_auto_1fr] items-center gap-x-4 px-(--screen-pad-x) py-(--bar-pad-y) folded:flex folded:flex-wrap folded:gap-x-(--bar-gap) folded:gap-y-1.5 folded:px-3 folded:pt-2 folded:pb-2.5"
    >
      <!-- The wordmark alone at the start, and "This week" at the end of the column, beside the
           week's arrows (K50). Folded, the planner's bar leaves the wordmark out (Header card):
           the week and the actions are what the bar is for. -->
      <div
        class="flex items-center justify-between gap-(--bar-gap) justify-self-stretch folded:contents"
      >
        <BrandMark class="h-(--bar-wordmark) folded:hidden" />
        <BarAction
          v-if="otherWeek"
          label="This week"
          class="folded:flex-1 folded:basis-0"
          @click="store.thisWeek"
          ><Calendar
        /></BarAction>
      </div>
      <nav
        class="flex items-center folded:order-first folded:basis-full folded:justify-center"
        aria-label="Week"
      >
        <IconButton
          label="Previous week"
          class="size-(--bar-arrow-box) [&_svg]:size-(--bar-arrow)"
          @click="store.prevWeek"
          ><ChevronLeft
        /></IconButton>
        <span
          class="min-w-[6.5em] px-2 text-center text-(length:--bar-week) leading-tight font-semibold whitespace-nowrap tabular-nums"
          aria-live="polite"
          data-testid="week-label"
        >
          {{ weekRange(store.monday) }}
        </span>
        <IconButton
          label="Next week"
          class="size-(--bar-arrow-box) [&_svg]:size-(--bar-arrow)"
          @click="store.nextWeek"
          ><ChevronRight
        /></IconButton>
      </nav>
      <!-- The actions, Edit plan first, just left of Settings (K50); folded, they share the
           second row equally, after "This week". -->
      <div class="flex items-stretch gap-(--bar-gap) justify-self-end folded:contents">
        <BarAction
          label="Edit plan"
          :pressed="store.configMode"
          class="folded:flex-1 folded:basis-0"
          data-testid="edit-plan-button"
          @click="store.setConfigMode(!store.configMode)"
          ><Pencil
        /></BarAction>
        <!-- Ask, just before Settings (the Ask mockup): only once the API has said it answers
             questions, so it never flashes in or out while the flag loads. Folded, the actions'
             row reads Edit plan, Ask, Settings. -->
        <BarAction
          v-if="session.ask === true"
          label="Ask"
          class="folded:flex-1 folded:basis-0"
          data-testid="ask-button"
          @click="openAsk"
          ><MessageCircle
        /></BarAction>
        <BarAction
          label="Settings"
          class="folded:flex-1 folded:basis-0"
          data-testid="settings-button"
          @click="openSettings"
          ><Settings
        /></BarAction>
        <!-- Printing from a phone is rare, and the bar has no room for it there. -->
        <BarAction label="Print…" class="max-sm:hidden folded:flex-1 folded:basis-0" @click="print"
          ><Printer
        /></BarAction>
        <!-- Full screen (K34), last, at the far right (K49): left out where the browser has
             none, as on an iPhone. -->
        <BarAction
          v-if="fullscreen.supported"
          :label="fullscreen.active.value ? 'Exit full screen' : 'Full screen'"
          class="folded:flex-1 folded:basis-0"
          data-testid="fullscreen-button"
          @click="fullscreen.toggle"
          ><Minimize v-if="fullscreen.active.value" /><Maximize v-else
        /></BarAction>
      </div>
    </div>
  </header>
</template>
