<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRef, useTemplateRef } from 'vue'
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  LogOut,
  Maximize,
  MessageCircle,
  Minimize,
  Printer,
  Settings,
  UserRound,
} from '@lucide/vue'
import { usePlannerStore } from '@/stores/planner'
import { useSessionStore } from '@/stores/session'
import { weekRange } from '@/lib/dates'
import { BarAction } from '@/components/ui/bar-action'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Menu, MenuItem } from '@/components/ui/menu'
import { IconButton } from '@/components/ui/icon-button'
import { useBarReveal } from '@/composables/barReveal'
import { useFullscreen } from '@/composables/fullscreen'
import { useShortcuts } from '@/composables/shortcuts'
import { useSignOut } from '@/composables/signOut'

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

// Edit plan's screens fill the window under the sticky bar (K99): main.css reads its height as
// `--bar-height`, which changes when the bar wraps (folded) or the window is resized.
let barSize: ResizeObserver | undefined
function measureBar(): void {
  if (header.value) {
    document.documentElement.style.setProperty('--bar-height', `${header.value.offsetHeight}px`)
  }
}
onMounted(() => {
  measureBar()
  if (typeof ResizeObserver === 'undefined' || !header.value) return
  barSize = new ResizeObserver(measureBar)
  barSize.observe(header.value)
})
onBeforeUnmount(() => {
  barSize?.disconnect()
  document.documentElement.style.removeProperty('--bar-height')
})

const session = useSessionStore()
const otherWeek = computed(() => store.weekKey !== store.currentWeekKey)

function print(): void {
  window.print()
}

function toggleEditPlan(): void {
  store.setConfigMode(!store.configMode)
}

/** Settings is a page of its own (#/settings); App shows it on the hash change. */
function openSettings(): void {
  location.hash = '#/settings'
}

/** The profile menu (K106): Profile is a page of its own (#/profile), like Settings. */
function openProfile(): void {
  location.hash = '#/profile'
}
const profileButton = useTemplateRef<InstanceType<typeof BarAction>>('profileButton')
/** The Profile button, where focus returns once the sign-out question closes. */
function profileTarget(): HTMLElement | null {
  return (profileButton.value?.$el as HTMLElement | undefined) ?? null
}
/**
 * Sign out from the menu: at once, or after a question when changes haven't reached the server.
 * The bar has no room to say why a sign-out failed, so a failure opens the same question with the
 * reason, from which the person can try again.
 */
const signOut = useSignOut()
async function startSignOut(): Promise<void> {
  const problem = await signOut.start()
  if (problem) {
    signOut.error.value = problem
    signOut.asking.value = true
  }
}

// The week's keys (K91): E in and out of Edit plan, Esc out of full screen and then out of Edit
// plan, F full screen, P print and S Settings, as their buttons do.
useShortcuts(() => ({
  e: toggleEditPlan,
  escape: () => {
    if (fullscreen.active.value) void fullscreen.toggle()
    else if (store.configMode) store.setConfigMode(false)
    else return false
  },
  f: fullscreen.supported ? () => void fullscreen.toggle() : undefined,
  p: print,
  s: openSettings,
}))

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
  week below it (K47). The week navigation comes first, at the start, its label set as the page's
  title (K81), and the BarActions follow at the end: "This week" while another week is on screen,
  Ask (only while the API answers questions), Settings, Print and Full screen (K49). There is no
  wordmark and no Edit plan or Done button: the bar showing and Edit plan are one thing (K80),
  and a long press, E or Esc leave it (K91). The Settings and Ask pages have no bar (K52). Every size is a `--bar-*`
  size from main.css, so the bar follows the screen. Folded, the week takes the first row and the
  actions share the second; the markup stays in the desktop order, which is the tab order.

  "Skip to today" comes first in the tab order (F15), and "Edit plan" second, reading "Done" in
  Edit plan (K82, K91): each hidden until it has focus, then shown over the start of the bar with
  the focus ring.

  With `overlay` (the planner's screens) the bar is fixed above the top edge (Header card, Out of
  sight). A long press anywhere, or the handle at the top centre wherever a finger may be, opens
  Edit plan (K80), where the bar is sticky and the page sits below it, so it covers nothing; a
  long press there, E or Esc closes it again. Focus inside the bar slides it down over the screen,
  so it stays reachable by Tab: it is moved out of view, never hidden.
-->
<template>
  <template v-if="overlay">
    <!-- The handle (Header card): a 40 × 5px pill in an 88 × 44px target. A raw button, since
         no primitive draws a handle; it is named for what it does, opening Edit plan (K80). It
         is for a finger, so it stays out of the Tab order: the keyboard has the bar's hidden
         "Edit plan" button (K82). -->
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
    <!-- The first two Tab stops, out of sight until each has focus, then shown over the start
         of the bar with the focus ring: "Skip to today" (F15), and "Edit plan", "Done" in Edit
         plan (K82, K91), so the keyboard reaches Edit plan and leaves it without a long press. -->
    <div class="absolute top-1.5 left-2 z-30">
      <!-- not-sr-only zeroes the link's padding, so the span carries it. -->
      <a
        href="#exercises-heading"
        class="sr-only rounded-md bg-panel text-base font-semibold text-ink underline underline-offset-4 shadow-overlay focus:not-sr-only focus:block"
        data-testid="skip-to-today"
        @click.prevent="skipToToday"
        ><span class="block px-3 py-2">Skip to today</span></a
      >
      <button
        type="button"
        class="sr-only cursor-pointer rounded-md bg-panel text-base font-semibold text-ink underline underline-offset-4 shadow-overlay focus:not-sr-only focus:block"
        aria-keyshortcuts="E"
        data-testid="edit-plan-button"
        @click="toggleEditPlan"
      >
        <span class="block px-3 py-2">{{ store.configMode ? 'Done' : 'Edit plan' }}</span>
      </button>
    </div>
    <!-- The week first, at the start, as the page's title (K81); the actions at the end. Folded,
         the week takes the whole first line, centred, and the actions share the second. -->
    <div
      class="flex items-center justify-between gap-x-4 px-(--screen-pad-x) py-(--bar-pad-y) folded:flex-wrap folded:gap-x-(--bar-gap) folded:gap-y-1.5 folded:px-3 folded:pt-2 folded:pb-2.5"
    >
      <nav class="flex items-center folded:basis-full folded:justify-center" aria-label="Week">
        <IconButton
          label="Previous week"
          class="size-(--bar-arrow-box) [&_svg]:size-(--bar-arrow)"
          @click="store.prevWeek"
          ><ChevronLeft
        /></IconButton>
        <span
          class="title-1 min-w-[6.5em] px-2 text-center text-(length:--bar-week) leading-tight whitespace-nowrap tabular-nums"
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
      <!-- The actions: "This week" first while another week is on screen (K81), then Ask (only
           once the API has said it answers questions, so it never flashes in or out), Settings,
           Print and Full screen, each naming its key (K91), and last Profile, which opens the
           profile menu (K106). Folded, they share the second row equally. -->
      <div class="flex items-stretch gap-(--bar-gap) folded:contents">
        <BarAction
          v-if="otherWeek"
          label="This week"
          class="folded:flex-1 folded:basis-0"
          @click="store.thisWeek"
          ><Calendar
        /></BarAction>
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
          aria-keyshortcuts="S"
          class="folded:flex-1 folded:basis-0"
          data-testid="settings-button"
          @click="openSettings"
          ><Settings
        /></BarAction>
        <!-- Printing from a phone is rare, and the bar has no room for it there. -->
        <BarAction
          label="Print…"
          aria-keyshortcuts="P"
          class="max-sm:hidden folded:flex-1 folded:basis-0"
          @click="print"
          ><Printer
        /></BarAction>
        <!-- Full screen (K34): left out where the browser has none, as on an iPhone. -->
        <BarAction
          v-if="fullscreen.supported"
          :label="fullscreen.active.value ? 'Exit full screen' : 'Full screen'"
          aria-keyshortcuts="F"
          class="folded:flex-1 folded:basis-0"
          data-testid="fullscreen-button"
          @click="fullscreen.toggle"
          ><Minimize v-if="fullscreen.active.value" /><Maximize v-else
        /></BarAction>
        <!-- The bar shows only while someone is signed in (App.vue), so there is a user. -->
        <Menu header-caption="Signed in as" :header="session.user!">
          <template #trigger>
            <BarAction
              ref="profileButton"
              label="Profile"
              class="folded:flex-1 folded:basis-0"
              data-testid="profile-button"
              ><CircleUserRound
            /></BarAction>
          </template>
          <MenuItem @select="openProfile"
            ><template #icon><UserRound /></template>Profile</MenuItem
          >
          <MenuItem @select="startSignOut"
            ><template #icon><LogOut /></template>Sign out</MenuItem
          >
        </Menu>
      </div>
    </div>
  </header>
  <ConfirmDialog
    v-model:open="signOut.asking.value"
    title="Sign out now?"
    :message="signOut.message.value"
    confirm-label="Sign out"
    :busy="signOut.busy.value"
    :error="signOut.error.value"
    :return-focus="profileTarget"
    @confirm="signOut.confirm"
  />
</template>
