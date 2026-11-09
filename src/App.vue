<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import { usePlannerStore } from '@/stores/planner'
import AppNavbar from '@/components/AppNavbar.vue'
import WeekHeader from '@/components/WeekHeader.vue'
import SettingsPage from '@/components/SettingsPage.vue'
import AskPage from '@/components/AskPage.vue'
import ExerciseGrid from '@/components/ExerciseGrid.vue'
import DietSection from '@/components/DietSection.vue'
import LoginForm from '@/components/LoginForm.vue'
import PasswordForm from '@/components/PasswordForm.vue'
import SignupForm from '@/components/SignupForm.vue'
import ForgotForm from '@/components/ForgotForm.vue'
import ConfirmEmail from '@/components/ConfirmEmail.vue'
import ConnectPage from '@/components/ConnectPage.vue'
import EmailStatus from '@/components/EmailStatus.vue'
import SyncStatus from '@/components/SyncStatus.vue'
import ImportPrompt from '@/components/ImportPrompt.vue'
import { ConfirmHost } from '@/components/ui/confirm-dialog'
import { dismissConfirm } from '@/composables/useConfirm'
import { useMediaQuery } from '@/composables/useMediaQuery'
import { useScreenSprint } from '@/composables/screenSprint'
import { isDark } from '@/lib/theme'
import { useAskStore } from '@/stores/ask'
import { isItemHash, itemHref, markFromWeek, parseItemHash, type ItemRoute } from '@/lib/routes'
import { itemExists, useItemSource } from '@/composables/itemSource'
import ItemPage from '@/components/ItemPage.vue'
import { useSessionStore } from '@/stores/session'
import { useSyncStore } from '@/stores/sync'

const store = usePlannerStore()
const session = useSessionStore()
const sync = useSyncStore()
// Made here, not on the Ask page, so it forgets its conversation on any sign-out or user change.
useAskStore()
// Started before the first render: a remembered user is signed in synchronously, so the app
// shows their cached data straight away instead of flashing the sign-in screen.
void session.init()

/** An invite or reset link (`#/invite/<token>`, `#/reset/<token>`): its token, else null. */
function linkToken(): string | null {
  return /^#\/(?:invite|reset)\/([A-Za-z0-9_-]+)$/.exec(location.hash)?.[1] ?? null
}
const link = ref(linkToken())
/** `#/signup`, the create-an-account form: shown only while nobody is signed in. */
function isSignup(): boolean {
  return location.hash === '#/signup'
}
const signup = ref(isSignup())
/** `#/forgot`, the ask-for-a-reset-link form: shown only while nobody is signed in. */
function isForgot(): boolean {
  return location.hash === '#/forgot'
}
const forgot = ref(isForgot())
/** A confirm-your-email link (`#/confirm/<token>`): its token, else null. Works signed in or out. */
function confirmToken(): string | null {
  return /^#\/confirm\/([A-Za-z0-9_-]+)$/.exec(location.hash)?.[1] ?? null
}
const confirmLink = ref(confirmToken())
/**
 * The connect screen's address (`#/connect/<id>`, from the API's `/api/oauth/authorize`): the
 * pending request's id, else null. A link route like the confirm link: it shows signed in or out,
 * and a sign-out doesn't drop it, so a person arriving from Claude never loses the request (F10).
 */
function connectRequest(): string | null {
  return /^#\/connect\/([A-Za-z0-9_-]+)$/.exec(location.hash)?.[1] ?? null
}
const connectId = ref(connectRequest())

/**
 * The page the hash asks for: Settings at `#/settings`, Ask at `#/ask`, an item's page at
 * `#/item/<section>/<id>` (ItemPage card, D5), otherwise the planner.
 */
type Page = 'planner' | 'settings' | 'ask' | 'item'
function pageFor(): Page {
  if (location.hash === '#/settings') return 'settings'
  if (location.hash === '#/ask') return 'ask'
  return parseItemHash(location.hash) ? 'item' : 'planner'
}
/** Drop the hash from the address bar and history: the page it named doesn't apply. */
function dropHash(): void {
  history.replaceState(null, '', location.pathname + location.search)
}
// An item address naming no section or no good id opens the week (ItemPage card).
if (isItemHash(location.hash) && !parseItemHash(location.hash)) dropHash()
const page = ref<Page>(pageFor())
const item = ref<ItemRoute | null>(parseItemHash(location.hash))
/** The item whose page was open last, so Back can put focus on its name. */
let leftItem: ItemRoute | null = null
/**
 * The page on screen: Ask only while the API answers questions (F10). Until the flag has loaded
 * the week shows and `#/ask` stays, so a remembered Ask page opens once the flag says yes.
 */
const shown = computed<Page>(() =>
  page.value === 'ask' && session.ask !== true ? 'planner' : page.value,
)
function onHash(): void {
  link.value = linkToken()
  confirmLink.value = confirmToken()
  connectId.value = connectRequest()
  signup.value = isSignup()
  forgot.value = isForgot()
  if (isItemHash(location.hash) && !parseItemHash(location.hash)) dropHash()
  const before = page.value
  leftItem = item.value ?? leftItem
  item.value = parseItemHash(location.hash)
  page.value = pageFor()
  // Opened from the week in this tab: its Back goes back through history (lib/routes).
  if (page.value === 'item' && before === 'planner') markFromWeek()
}
/** Drop the page from the address bar, so a reload opens the week. */
function forgetPage(): void {
  dropHash()
  item.value = null
  page.value = 'planner'
}
// Back from Settings or Ask, focus returns to the bar button that opened it; back from an item's
// page, to that item's name in its row (WeekGrid card).
const OPENERS: Record<'settings' | 'ask', string> = {
  settings: 'settings-button',
  ask: 'ask-button',
}
watch(shown, async (now, before) => {
  if (now !== 'planner' || before === 'planner') return
  await nextTick()
  if (before !== 'item')
    document.querySelector<HTMLElement>(`[data-testid="${OPENERS[before]}"]`)?.focus()
  else if (leftItem) {
    const href = itemHref(leftItem.section, leftItem.id)
    ;[...document.querySelectorAll<HTMLElement>('[data-slot="item-link"]')]
      .find((a) => a.getAttribute('href') === href)
      ?.focus()
  }
})
// Ask is off on this planner (no key, or turned off since): `#/ask` means the week.
watch(
  () => page.value === 'ask' && session.ask === false,
  (off) => {
    if (off) forgetPage()
  },
  { immediate: true },
)
// Signing out on Settings, Ask or an item's page lands on the sign-in screen, and the next sign-in
// on the week.
watch(
  () => session.status,
  (status) => {
    if (status === 'signed-out' && page.value !== 'planner') forgetPage()
  },
)
// An address naming no item in any week's plan opens the week instead (ItemPage card), once the
// data is here to say so; so does an item's page whose item another tab removed from every plan.
const itemSource = useItemSource()
watchEffect(() => {
  if (page.value !== 'item' || !sync.loaded) return
  if (itemExists(itemSource(item.value!.section), item.value!.id)) return
  dropHash()
  item.value = null
  page.value = 'planner'
})
/** Drop the token from the address bar and history, where a used or dead one has no place. */
function forgetToken(): void {
  history.replaceState(null, '', location.pathname + location.search)
}
function closeLink(): void {
  forgetToken()
  link.value = null
}
function closeConfirm(): void {
  forgetToken()
  confirmLink.value = null
}
function closeConnect(): void {
  forgetToken()
  connectId.value = null
}
function closeSignup(): void {
  history.replaceState(null, '', location.pathname + location.search)
  signup.value = false
}
function closeForgot(): void {
  history.replaceState(null, '', location.pathname + location.search)
  forgot.value = false
}
// Signed in, by this form or otherwise, the address no longer names a screen that applies.
watch(
  () => session.status === 'signed-in' && (signup.value || forgot.value),
  (stale) => {
    if (!stale) return
    if (signup.value) closeSignup()
    if (forgot.value) closeForgot()
  },
  { immediate: true },
)

// The planner's screens (PlannerScreen card, K24–K27): outside Edit plan and the other pages each
// section fills the screen, the page sprints between them and the bar keeps out of sight. The
// class on <html> turns on main.css's `full:` variant.
const screens = computed(
  () =>
    session.status === 'signed-in' &&
    !link.value &&
    !confirmLink.value &&
    !connectId.value &&
    shown.value === 'planner' &&
    !store.configMode,
)
watchEffect(() => document.documentElement.classList.toggle('planner-screens', screens.value))
// The page never rests showing part of both screens: it sprints from one to the other (K38).
useScreenSprint(screens)

// matchMedia is missing in some environments (jsdom), so "System" falls back to light there.
const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
watchEffect(() =>
  document.documentElement.classList.toggle('dark', isDark(store.theme, systemDark.value)),
)

// An open question (useConfirm) was about the signed-in user's data. When another tab signs in as
// someone else, or out, the stores change under it, so it closes unanswered rather than letting
// its verb act on the new user's data. Synchronous, so a switch from one user straight to another
// (null for a moment between) is never missed.
watch(
  () => session.user,
  () => dismissConfirm(),
  { flush: 'sync' },
)

function onVisible(): void {
  if (document.visibilityState !== 'visible') return
  store.refreshNow()
  void sync.refresh()
}
function onFocus(): void {
  void sync.refresh()
}
function onOnline(): void {
  void sync.flush()
  // The flag may not have loaded yet (offline at start), and the key may have changed meanwhile.
  void session.loadOptions()
}
function onStorage(ev: StorageEvent): void {
  if (ev.storageArea !== localStorage) return
  void session.onStorage(ev.key)
  sync.onStorage(ev.key)
}
function onTick(): void {
  store.refreshNow()
  // Another device's changes arrive within a minute even in a tab that is never refocused.
  if (document.visibilityState === 'visible') void sync.refresh()
}

// The minute tick catches midnight in a tab that stays visible (e.g. a wall display);
// visibilitychange catches it immediately when a backgrounded tab returns.
let tick: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', onFocus)
  window.addEventListener('online', onOnline)
  window.addEventListener('storage', onStorage)
  window.addEventListener('hashchange', onHash)
  tick = setInterval(onTick, 60_000)
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisible)
  window.removeEventListener('focus', onFocus)
  window.removeEventListener('online', onOnline)
  window.removeEventListener('storage', onStorage)
  window.removeEventListener('hashchange', onHash)
  clearInterval(tick)
  sync.stop()
})
</script>

<template>
  <ConnectPage
    v-if="connectId"
    :key="connectId"
    :request-id="connectId"
    @spent="forgetToken"
    @leave="closeConnect"
  />
  <ConfirmEmail
    v-else-if="confirmLink"
    :key="confirmLink"
    :token="confirmLink"
    @spent="forgetToken"
    @leave="closeConfirm"
  />
  <PasswordForm
    v-else-if="link"
    :key="link"
    :token="link"
    @done="closeLink"
    @spent="forgetToken"
    @leave="closeLink"
  />
  <template v-else-if="session.status === 'signed-in'">
    <!-- Settings, Ask and an item's page have no bar: each links back to the week (K52). -->
    <AppNavbar v-if="shown === 'planner'" :overlay="screens" />
    <!-- Settings, an item's page and Edit plan are full width on the page's margins, like the week
         (K51, K54, K64). Ask fills the screen beside its side panel and sets its own margins. -->
    <main
      class="print:max-w-none print:p-0 full:max-w-none full:p-0"
      :class="
        shown === 'ask'
          ? undefined
          : shown !== 'planner' || store.configMode
            ? 'px-(--screen-pad-x) pb-[calc(var(--u)*64)]'
            : 'mx-auto max-w-6xl px-4 pb-16 sm:px-6 lg:px-8'
      "
    >
      <AskPage v-if="shown === 'ask'" />
      <template v-else-if="shown === 'settings'">
        <SyncStatus />
        <EmailStatus />
        <SettingsPage />
      </template>
      <template v-else-if="shown === 'item' && sync.loaded">
        <SyncStatus />
        <EmailStatus />
        <ItemPage
          :key="`${item!.section}/${item!.id}`"
          :section="item!.section"
          :item-id="item!.id"
        />
      </template>
      <!-- On the planner the messages sit at the top of the first screen, under the week
           (PlannerScreen card). -->
      <template v-else-if="sync.loaded">
        <!-- The week, the page's title: fixed above the screens as they move under it (K88). -->
        <WeekHeader />
        <ExerciseGrid>
          <SyncStatus />
          <EmailStatus />
          <ImportPrompt v-if="session.user" :key="session.user" :user="session.user" />
        </ExerciseGrid>
        <DietSection />
      </template>
      <template v-else>
        <SyncStatus />
        <EmailStatus />
        <ImportPrompt v-if="session.user" :key="session.user" :user="session.user" />
      </template>
    </main>
  </template>
  <SignupForm v-else-if="session.status === 'signed-out' && signup" @leave="closeSignup" />
  <ForgotForm v-else-if="session.status === 'signed-out' && forgot" @leave="closeForgot" />
  <LoginForm v-else-if="session.status === 'signed-out'" />
  <!-- The one host for useConfirm(): removing a row and copying over next week's plan ask here. -->
  <ConfirmHost />
</template>
