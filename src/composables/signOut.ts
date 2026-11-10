import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { useSessionStore } from '@/stores/session'
import { useSyncStore } from '@/stores/sync'
import { describeProblem } from '@/lib/problems'
import { countOf } from '@/lib/words'

export type SignOut = {
  /** The ConfirmDialog's `open`: unsent changes, or a sign-out that failed from the bar's menu. */
  asking: Ref<boolean>
  busy: Ref<boolean>
  /** The ConfirmDialog's error: why the last confirmed sign-out failed. */
  error: Ref<string | undefined>
  /** The ConfirmDialog's message. */
  message: ComputedRef<string>
  /**
   * Sign out, or ask first when changes haven't reached the server, since signing out forgets
   * this device's outbox (session.logout → sync.forget). Returns why it failed, or null.
   */
  start: () => Promise<string | null>
  /** The ConfirmDialog's confirm: sign out now; the dialog stays open with the reason on failure. */
  confirm: () => Promise<void>
}

/** Signing out, shared by the Profile page and the bar's profile menu (K106). */
export function useSignOut(): SignOut {
  const session = useSessionStore()
  const sync = useSyncStore()
  const asking = ref(false)
  const busy = ref(false)
  const error = ref<string | undefined>(undefined)
  const message = computed(() => {
    const n = sync.pending
    if (!n) return 'Signing out needs the server, to end the session there.'
    return `${countOf(n, 'change', true)} on this device ${n === 1 ? 'hasn’t' : 'haven’t'} reached the server yet. Signing out now loses them.`
  })

  async function start(): Promise<string | null> {
    if (sync.pending) {
      error.value = undefined
      asking.value = true
      return null
    }
    const problem = await session.logout()
    return problem ? describeProblem(problem) : null
  }

  async function confirm(): Promise<void> {
    if (busy.value) return
    busy.value = true
    const problem = await session.logout()
    busy.value = false
    if (problem) error.value = describeProblem(problem)
    else asking.value = false
  }

  return { asking, busy, error, message, start, confirm }
}
