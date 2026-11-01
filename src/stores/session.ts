import { ref } from 'vue'
import { defineStore } from 'pinia'
import { request, type ApiError } from '@/lib/api'
import { isRecord, parseJson, readKey, removeKey, writeKey } from '@/lib/storage'
import { useDietStore } from '@/stores/diet'
import { usePlannerStore } from '@/stores/planner'
import { useSyncStore } from '@/stores/sync'

/** The last signed-in user, so a reload shows their cached data before the server answers. */
export const SESSION_KEY = 'tracker-session-v1'

/** Why a sign-in, a link or a sign-out did not work; the forms turn these into sentences. */
export type AuthProblem = {
  code:
    | 'invalid'
    | 'locked'
    | 'busy'
    | 'offline'
    | 'gone'
    | 'password'
    | 'email'
    | 'exists'
    | 'closed'
    | 'too-many'
    | 'too-soon'
    | 'confirmed'
    | 'no-email'
    | 'mail-off'
    | 'error'
  retryAfter?: number
}

/** Who the server says is signed in; `confirmed` only for an email account while mail is on. */
type Account = { username: string; confirmed?: boolean }

export type LinkKind = 'invite' | 'reset'

function problem(error: ApiError): AuthProblem {
  if (error.kind === 'offline') return { code: 'offline' }
  if (error.kind !== 'refused') return { code: 'error' }
  const known = [
    'invalid',
    'locked',
    'busy',
    'gone',
    'password',
    'email',
    'exists',
    'closed',
    'too-many',
    'too-soon',
    'confirmed',
    'no-email',
    'mail-off',
  ] as const
  const code = known.find((c) => c === error.code) ?? 'error'
  return error.retryAfter === undefined ? { code } : { code, retryAfter: error.retryAfter }
}

function savedUser(): string | null {
  const saved = parseJson(readKey(SESSION_KEY))
  return isRecord(saved) && typeof saved.user === 'string' ? saved.user : null
}

export const useSessionStore = defineStore('session', () => {
  const sync = useSyncStore()
  const planner = usePlannerStore()
  const diet = useDietStore()

  /** `checking` only until the first answer when no user is remembered on this device. */
  const status = ref<'checking' | 'signed-out' | 'signed-in'>('checking')
  const user = ref<string | null>(null)
  /** The session ended by itself (expired or revoked), rather than by signing out. */
  const expired = ref(false)
  /** Whether the signed-in account's email is confirmed; null when that doesn't apply. */
  const confirmed = ref<boolean | null>(null)
  /** Whether this planner sends email, so the sign-in screen can offer a reset by email. */
  const mail = ref(false)
  /**
   * Whether this planner answers questions (Ask, docs/api.md §3.2): null until the server has
   * said, so the bar's Ask button neither flashes on nor off while it loads.
   */
  const ask = ref<boolean | null>(null)

  function begin(name: string, account?: Account): void {
    // A different user's data must never show, even for a moment.
    if (user.value !== null && user.value !== name) {
      planner.clear()
      diet.clear()
    }
    user.value = name
    status.value = 'signed-in'
    expired.value = false
    if (account) confirmed.value = account.confirmed ?? null
    writeKey(SESSION_KEY, { user: name })
    sync.start(name, lost)
    // A remembered user never sees the sign-in form, which used to be the only reader (F9).
    void loadOptions()
  }

  /** The server stopped accepting the session: ask to sign in again, keeping unsent changes. */
  function lost(): void {
    sync.stop()
    status.value = 'signed-out'
    expired.value = true
  }

  /** On load: trust a remembered user straight away, then let the server confirm or refuse. */
  async function init(): Promise<void> {
    const remembered = savedUser()
    if (remembered) begin(remembered)
    const res = await request<Account>('GET', '/auth/me')
    if (res.ok) {
      if (res.data.username !== user.value || status.value !== 'signed-in') {
        begin(res.data.username, res.data)
      } else confirmed.value = res.data.confirmed ?? null
      return
    }
    if (res.error.kind === 'auth' && remembered) lost()
    else if (!remembered) status.value = 'signed-out'
    // Offline with a remembered user: keep working from the cache until the server is back.
  }

  async function signedIn(res: Awaited<ReturnType<typeof request<Account>>>) {
    if (!res.ok) return problem(res.error)
    begin(res.data.username, res.data)
    return null
  }

  async function login(username: string, password: string): Promise<AuthProblem | null> {
    return signedIn(await request<Account>('POST', '/auth/login', { username, password }))
  }

  /** Create an account named by its email (docs/api.md §4) and sign in as it. */
  async function signup(email: string, password: string): Promise<AuthProblem | null> {
    return signedIn(await request<Account>('POST', '/auth/signup', { email, password }))
  }

  async function lookup(
    token: string,
  ): Promise<{ kind: LinkKind; username: string } | AuthProblem> {
    const res = await request<{ kind: LinkKind; username: string }>('POST', '/invites/lookup', {
      token,
    })
    return res.ok ? res.data : problem(res.error)
  }

  async function redeem(token: string, password: string): Promise<AuthProblem | null> {
    return signedIn(await request<Account>('POST', '/invites/redeem', { token, password }))
  }

  /**
   * Ask the server whether it sends email (docs/api.md §4.1), where unknown counts as no, and
   * whether it answers questions (§3.2), which stays as it was when the server can't be read.
   * Called after every sign-in and when the browser comes back online.
   */
  async function loadOptions(): Promise<void> {
    const res = await request<{ mail: boolean; ask?: boolean }>('GET', '/auth/options')
    mail.value = res.ok && res.data.mail === true
    if (res.ok) ask.value = res.data.ask === true
  }

  /** The API said Ask is off (503 `ask-off`): the key was unset since the options were read. */
  function askOff(): void {
    ask.value = false
  }

  /** Ask for a reset link by email. The answer is the same whether or not the account exists. */
  async function forgot(email: string): Promise<AuthProblem | null> {
    const res = await request('POST', '/auth/forgot', { email })
    return res.ok ? null : problem(res.error)
  }

  /** Use a confirmation link; it works signed in or out, on any device. */
  async function confirmEmail(token: string): Promise<{ username: string } | AuthProblem> {
    const res = await request<Account>('POST', '/auth/confirm', { token })
    if (!res.ok) return problem(res.error)
    if (res.data.username === user.value) confirmed.value = true
    return { username: res.data.username }
  }

  /** Send the signed-in account a new confirmation link. */
  async function resendConfirmation(): Promise<AuthProblem | null> {
    const res = await request('POST', '/auth/confirm/resend', {})
    if (res.ok) return null
    const p = problem(res.error)
    // Confirmed meanwhile, in another tab or on another device: the banner can go.
    if (p.code === 'confirmed') confirmed.value = true
    return p
  }

  /**
   * Sign out and forget this user's data on the device. Refused while offline: the session
   * cookie is HttpOnly, so only the server can end it, and leaving it valid would sign the user
   * straight back in on the next visit.
   */
  async function logout(): Promise<AuthProblem | null> {
    const res = await request('POST', '/auth/logout', {})
    if (!res.ok && res.error.kind !== 'auth') return problem(res.error)
    const name = user.value
    sync.stop()
    if (name) sync.forget(name)
    planner.clear()
    diet.clear()
    removeKey(SESSION_KEY)
    user.value = null
    confirmed.value = null
    status.value = 'signed-out'
    expired.value = false
    return null
  }

  /**
   * Another tab signed in or out (a `storage` event on the session key). Follow it at once, so
   * this tab never keeps showing, or writing as, a user who is no longer the one signed in.
   */
  async function onStorage(key: string | null): Promise<void> {
    if (key !== SESSION_KEY && key !== null) return
    const remembered = savedUser()
    if (remembered === user.value && status.value === 'signed-in') return
    sync.stop()
    planner.clear()
    diet.clear()
    user.value = null
    confirmed.value = null
    expired.value = false
    status.value = 'signed-out'
    if (remembered) await init()
  }

  return {
    status,
    user,
    expired,
    confirmed,
    mail,
    ask,
    init,
    login,
    signup,
    lookup,
    redeem,
    loadOptions,
    askOff,
    forgot,
    confirmEmail,
    resendConfirmation,
    logout,
    onStorage,
  }
})
