import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import { SESSION_KEY } from '@/stores/session'
import { usePlannerStore } from '@/stores/planner'
import {
  CACHE_PREFIX,
  CONFLICT_NOTICE,
  OUTBOX_PREFIX,
  QUOTA_NOTICE,
  REFUSED_NOTICE,
  useSyncStore,
} from '@/stores/sync'
import { FakeApi, PASSWORD } from '@/lib/__tests__/fakeApi'
import { USER, signedIn } from '@/lib/__tests__/signedIn'

const NOW = new Date(2026, 9, 23, 18, 0)

let wrapper: VueWrapper
let api: FakeApi

function mountApp(): VueWrapper {
  const pinia = createPinia()
  setActivePinia(pinia)
  wrapper = mount(App, { global: { plugins: [pinia] }, attachTo: document.body })
  return wrapper
}

/** A browser with nothing remembered, and an API where alice exists but is signed out. */
function signedOut(): FakeApi {
  const a = new FakeApi()
  a.addUser(USER)
  vi.stubGlobal('fetch', a.fetch)
  return a
}

async function signIn(username: string, password: string): Promise<void> {
  await wrapper.get('#login-username').setValue(username)
  await wrapper.get('#login-password').setValue(password)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}

function heading(): string {
  return wrapper.get('h1').text()
}

function button(name: string) {
  return wrapper.findAll('button').find((b) => b.text() === name)!
}

/** Lets Reka's queued work (focus moves, presence, nextTick chains) settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** The Profile page, where the account and Sign out live (K106). */
async function openProfile(): Promise<void> {
  location.hash = '#/profile'
  await settle()
}

/** The open ConfirmDialog, by role; Reka renders it in a portal on document.body. */
function confirmation(): DOMWrapper<HTMLElement> | null {
  const el = document.querySelector<HTMLElement>('[role="alertdialog"]')
  return el ? new DOMWrapper(el) : null
}

function confirmButton(name: string) {
  return confirmation()!
    .findAll('button')
    .find((b) => b.text() === name)!
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  localStorage.clear()
  history.replaceState(null, '', '/')
})

afterEach(() => {
  wrapper?.unmount()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('signing in', () => {
  it('shows nothing until the server answers, then the sign-in form', async () => {
    api = signedOut()
    mountApp()
    expect(wrapper.find('form').exists()).toBe(false)
    await flushPromises()
    expect(heading()).toBe('Sign in')
    expect(wrapper.find('[aria-label="Week navigation"]').exists()).toBe(false)
  })

  it('signs in and shows the planner, remembering the user', async () => {
    api = signedOut()
    mountApp()
    await flushPromises()
    await signIn(` ${USER} `, PASSWORD)
    expect(heading()).toBe('19–25 October')
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!)).toEqual({ user: USER })
  })

  it.each([
    [
      'a wrong password',
      'invalid',
      undefined,
      'Wrong email or password. Check them and try again.',
    ],
    ['a locked account', 'locked', 600, 'Too many attempts. Try again in ten minutes.'],
    ['a lock about to end', 'locked', 30, 'Too many attempts. Try again in one minute.'],
    ['a busy server', 'busy', 1, 'The server is busy. Try again in a moment.'],
  ])('explains %s', async (_, code, retryAfter, message) => {
    api = signedOut()
    const status = { invalid: 401, locked: 423, busy: 503 }[code]!
    api.failNext('POST', '/auth/login', status, { error: code, retryAfter })
    mountApp()
    await flushPromises()
    await signIn(USER, PASSWORD)
    expect(wrapper.get('[data-testid="login-problem"]').text()).toBe(message)
    expect(heading()).toBe('Sign in')
  })

  it('marks the fields and returns to the password after a wrong password', async () => {
    api = signedOut()
    mountApp()
    await flushPromises()
    await signIn(USER, 'not the password')
    expect(wrapper.get('#login-password').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('#login-username').attributes('aria-describedby')).toBe('login-problem')
    expect(document.activeElement).toBe(wrapper.get('#login-password').element)
  })

  it('explains being offline', async () => {
    api = signedOut()
    mountApp()
    await flushPromises()
    api.offline = true
    await signIn(USER, PASSWORD)
    expect(wrapper.get('[role="alert"]').text()).toBe(
      'Can’t reach the server. Check the connection and try again.',
    )
  })

  it('asks to sign in again when the session ends, with the username filled in', async () => {
    api = signedIn()
    api.signedIn = null
    mountApp()
    await flushPromises()
    expect(heading()).toBe('Sign in')
    expect(wrapper.text()).toContain('Your session has ended.')
    expect((wrapper.get('#login-username').element as HTMLInputElement).value).toBe(USER)
  })

  it('ignores a second submit while the first is under way', async () => {
    api = signedOut()
    mountApp()
    await flushPromises()
    const release = api.hold()
    await wrapper.get('#login-username').setValue(USER)
    await wrapper.get('#login-password').setValue(PASSWORD)
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('button[type="submit"]').attributes('aria-busy')).toBe('true')
    expect(wrapper.get('button[type="submit"]').text()).toBe('Signing in…')
    release()
    await flushPromises()
    expect(api.paths('POST /auth/login')).toHaveLength(1)
  })
})

describe('creating an account', () => {
  async function fill(email: string, password: string, confirm = password): Promise<void> {
    await wrapper.get('#signup-email').setValue(email)
    await wrapper.get('#signup-password').setValue(password)
    await wrapper.get('#signup-confirm').setValue(confirm)
  }

  async function submit(): Promise<void> {
    await wrapper.get('form').trigger('submit')
    await flushPromises()
  }

  function openSignup(): void {
    history.replaceState(null, '', '/#/signup')
  }

  it('is linked from sign-in, which asks for an email', async () => {
    api = signedOut()
    mountApp()
    await flushPromises()
    expect(wrapper.get('label[for="login-username"]').text()).toBe('Email')
    expect(wrapper.get('#login-username').attributes('inputmode')).toBe('email')
    expect(wrapper.text()).not.toContain('username')
    const link = wrapper.findAll('a').find((a) => a.text() === 'Create an account')!
    expect(link.attributes('href')).toBe('#/signup')
    expect(wrapper.text()).not.toContain('invitation')
    location.hash = '#/signup'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await flushPromises()
    expect(heading()).toBe('Create an account')
  })

  it('creates the account, signs in by its email, and clears the address bar', async () => {
    api = signedOut()
    openSignup()
    mountApp()
    await flushPromises()
    expect(heading()).toBe('Create an account')
    expect(wrapper.get('#signup-email').attributes('type')).toBe('email')
    expect(wrapper.get('#signup-email').attributes('autocomplete')).toBe('username')
    expect(wrapper.get('#signup-password-hint').text()).toBe('At least 10 characters.')
    await fill(' New@Example.com ', 'a long new password')
    await submit()
    expect(api.calls.find((c) => c.path === '/auth/signup')!.body).toEqual({
      email: 'New@Example.com',
      password: 'a long new password',
    })
    expect(heading()).toBe('19–25 October')
    expect(location.hash).toBe('')
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!)).toEqual({ user: 'new@example.com' })
  })

  it('checks the two passwords match before sending, and returns to the repeat field', async () => {
    api = signedOut()
    openSignup()
    mountApp()
    await flushPromises()
    await fill('new@example.com', 'a long new password', 'something else')
    await submit()
    expect(wrapper.get('#signup-confirm-error').text()).toBe(
      'The passwords don’t match. Type the same password in both fields.',
    )
    expect(document.activeElement).toBe(wrapper.get('#signup-confirm').element)
    expect(api.paths('/auth/signup')).toEqual([])
  })

  it.each([
    [
      'a malformed email',
      400,
      'email',
      undefined,
      '#signup-email-error',
      'Enter an email address, like name@example.com.',
    ],
    [
      'a taken email',
      409,
      'exists',
      undefined,
      '#signup-email-error',
      'There’s already an account for that email. Go to sign in.',
    ],
    [
      'a short password',
      400,
      'password',
      undefined,
      '#signup-password-error',
      'Use 10 to 256 characters.',
    ],
    [
      'sign-up being closed',
      403,
      'closed',
      undefined,
      '[data-testid="signup-problem"]',
      'New accounts are closed for now. Ask whoever runs this planner for an invite.',
    ],
    [
      'the hourly limit',
      429,
      'too-many',
      720,
      '[data-testid="signup-problem"]',
      'Too many new accounts at once. Try again in 12 minutes.',
    ],
    [
      'a busy server',
      503,
      'busy',
      1,
      '[data-testid="signup-problem"]',
      'The server is busy. Try again in a moment.',
    ],
  ])('explains %s where it belongs', async (_, status, code, retryAfter, where, message) => {
    api = signedOut()
    api.failNext('POST', '/auth/signup', status, { error: code, retryAfter })
    openSignup()
    mountApp()
    await flushPromises()
    await fill('new@example.com', 'a long new password')
    await submit()
    expect(wrapper.get(where).text()).toBe(message)
    expect(heading()).toBe('Create an account')
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(1)
  })

  it('moves to the email when the server refuses it, and clears the error once it changes', async () => {
    api = signedOut()
    api.addUser('new@example.com')
    openSignup()
    mountApp()
    await flushPromises()
    await fill('new@example.com', 'a long new password')
    await submit()
    expect(wrapper.get('#signup-email').attributes('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(wrapper.get('#signup-email').element)
    await wrapper.get('#signup-email').setValue('other@example.com')
    expect(wrapper.find('#signup-email-error').exists()).toBe(false)
  })

  it('explains being offline and keeps what was typed', async () => {
    api = signedOut()
    openSignup()
    mountApp()
    await flushPromises()
    api.offline = true
    await fill('new@example.com', 'a long new password')
    await submit()
    expect(wrapper.get('[data-testid="signup-problem"]').text()).toBe(
      'Can’t reach the server. Check the connection and try again.',
    )
    expect((wrapper.get('#signup-email').element as HTMLInputElement).value).toBe('new@example.com')
  })

  it('sends one sign-up however often the button is pressed', async () => {
    api = signedOut()
    openSignup()
    mountApp()
    await flushPromises()
    await fill('new@example.com', 'a long new password')
    const release = api.hold()
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('button[type="submit"]').text()).toBe('Creating account…')
    release()
    await flushPromises()
    expect(api.paths('/auth/signup')).toHaveLength(1)
  })

  it('goes back to sign in and takes #/signup out of the address bar', async () => {
    api = signedOut()
    openSignup()
    mountApp()
    await flushPromises()
    const back = wrapper.findAll('a').find((a) => a.text() === 'Go to sign in')!
    await back.trigger('click')
    await flushPromises()
    expect(heading()).toBe('Sign in')
    expect(location.hash).toBe('')
  })

  it('shows the planner, not the form, to someone already signed in', async () => {
    api = signedIn()
    openSignup()
    mountApp()
    await flushPromises()
    expect(heading()).toBe('19–25 October')
    expect(location.hash).toBe('')
  })
})

describe('invite and reset links', () => {
  it('sets a password from an invite, signs in, and clears the link', async () => {
    api = signedOut()
    api.links.set('tok_1', { kind: 'invite', username: 'bob' })
    history.replaceState(null, '', '/#/invite/tok_1')
    mountApp()
    await flushPromises()
    expect(heading()).toBe('Welcome, bob')
    await wrapper.get('#new-password').setValue('a long new password')
    await wrapper.get('#confirm-password').setValue('a long new password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(location.hash).toBe('')
    expect(heading()).toBe('19–25 October')
    expect(api.accounts.get('bob')!.password).toBe('a long new password')
  })

  it('sends one redeem however often the button is pressed', async () => {
    api = signedOut()
    api.links.set('tok_9', { kind: 'invite', username: 'hal' })
    history.replaceState(null, '', '/#/invite/tok_9')
    mountApp()
    await flushPromises()
    await wrapper.get('#new-password').setValue('a long new password')
    await wrapper.get('#confirm-password').setValue('a long new password')
    const release = api.hold()
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('button[type="submit"]').text()).toBe('Saving…')
    release()
    await flushPromises()
    expect(api.paths('/invites/redeem')).toHaveLength(1)
  })

  it('checks the two passwords match, and shows the server’s length rule', async () => {
    api = signedOut()
    api.links.set('tok_1', { kind: 'invite', username: 'bob' })
    history.replaceState(null, '', '/#/invite/tok_1')
    mountApp()
    await flushPromises()
    await wrapper.get('#new-password').setValue('a long new password')
    await wrapper.get('#confirm-password').setValue('something else')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toBe(
      'The passwords don’t match. Type the same password in both fields.',
    )
    expect(wrapper.get('#confirm-password').attributes('aria-describedby')).toBe(
      'confirm-password-error',
    )
    expect(api.paths('/invites/redeem')).toEqual([])
    await wrapper.get('#new-password').setValue('short')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false) // gone once the value changes
    await wrapper.get('#confirm-password').setValue('short')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    // The server's length rule is the password field's own error, in place of its hint.
    expect(wrapper.get('#new-password-error').text()).toBe('Use 10 to 256 characters.')
    expect(wrapper.get('#new-password').attributes('aria-invalid')).toBe('true')
    expect(wrapper.find('#new-password-hint').exists()).toBe(false)
    await wrapper.get('#new-password').setValue('a long new password')
    expect(wrapper.find('#new-password-error').exists()).toBe(false)
    expect(wrapper.get('#new-password').attributes('aria-describedby')).toBe('new-password-hint')
  })

  it('names the user on a reset link', async () => {
    api = signedOut()
    api.links.set('tok_2', { kind: 'reset', username: USER })
    history.replaceState(null, '', '/#/reset/tok_2')
    mountApp()
    await flushPromises()
    expect(heading()).toBe('Choose a new password')
    expect(wrapper.text()).toContain('This signs you out on every other device.')
  })

  it('says when a link is no good, and takes its token out of the address bar', async () => {
    api = signedOut()
    history.replaceState(null, '', '/#/invite/used')
    mountApp()
    expect(heading()).toBe('Checking the link…')
    await flushPromises()
    expect(heading()).toBe('Link not valid')
    expect(wrapper.get('[role="alert"]').text()).toBe(
      'This link has expired or was already used. Ask for a new one.',
    )
    expect(location.hash).toBe('')
    // F19: the card is not a dead end; its one way on is a link to sign in.
    expect(wrapper.find('button').exists()).toBe(false)
    const links = wrapper.findAll('a')
    expect(links.map((a) => a.text())).toEqual(['Go to sign in'])
    await links[0]!.trigger('click')
    await flushPromises()
    expect(heading()).toBe('Sign in')
  })

  it('offers to try again when the link could not be checked', async () => {
    api = signedOut()
    api.links.set('tok_4', { kind: 'invite', username: 'dave' })
    api.offline = true
    history.replaceState(null, '', '/#/invite/tok_4')
    mountApp()
    await flushPromises()
    expect(heading()).toBe('Couldn’t check the link')
    expect(location.hash).toBe('#/invite/tok_4') // it may still be good
    api.offline = false
    await button('Try again').trigger('click')
    await flushPromises()
    expect(heading()).toBe('Welcome, dave')
  })

  it('clears the token once a redeem finds the link already used', async () => {
    api = signedOut()
    api.links.set('tok_5', { kind: 'invite', username: 'erin' })
    history.replaceState(null, '', '/#/invite/tok_5')
    mountApp()
    await flushPromises()
    api.links.delete('tok_5') // used in another tab meanwhile
    await wrapper.get('#new-password').setValue('a long new password')
    await wrapper.get('#confirm-password').setValue('a long new password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[data-testid="link-problem"]').text()).toContain('expired')
    expect(location.hash).toBe('')
    // The form gives way to the spent-link card, with its way on.
    expect(heading()).toBe('Link not valid')
    expect(wrapper.findAll('a').map((a) => a.text())).toEqual(['Go to sign in'])
  })

  it('keeps the form and its input when the redeem cannot reach the server', async () => {
    api = signedOut()
    api.links.set('tok_10', { kind: 'invite', username: 'ivy' })
    history.replaceState(null, '', '/#/invite/tok_10')
    mountApp()
    await flushPromises()
    await wrapper.get('#new-password').setValue('a long new password')
    await wrapper.get('#confirm-password').setValue('a long new password')
    api.offline = true
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(heading()).toBe('Welcome, ivy')
    expect(wrapper.get('form [data-testid="link-problem"]').text()).toBe(
      'Can’t reach the server. Check the connection and try again.',
    )
    expect((wrapper.get('#new-password').element as HTMLInputElement).value).toBe(
      'a long new password',
    )
    expect(location.hash).toBe('#/invite/tok_10')
  })

  it('starts afresh when a second link arrives in the same tab', async () => {
    api = signedOut()
    api.links.set('tok_6', { kind: 'invite', username: 'fay' })
    api.links.set('tok_7', { kind: 'reset', username: USER })
    history.replaceState(null, '', '/#/invite/tok_6')
    mountApp()
    await flushPromises()
    expect(heading()).toBe('Welcome, fay')
    history.replaceState(null, '', '/#/reset/tok_7')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await flushPromises()
    expect(heading()).toBe('Choose a new password')
    expect(wrapper.text()).toContain(USER)
  })

  it('puts focus back on the repeat field when the passwords differ', async () => {
    api = signedOut()
    api.links.set('tok_8', { kind: 'invite', username: 'gus' })
    history.replaceState(null, '', '/#/invite/tok_8')
    mountApp()
    await flushPromises()
    await wrapper.get('#new-password').setValue('a long new password')
    await wrapper.get('#confirm-password').setValue('other')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(document.activeElement).toBe(wrapper.get('#confirm-password').element)
    expect(wrapper.get('#confirm-password').attributes('aria-invalid')).toBe('true')
  })

  it('opens a link pasted into a running tab', async () => {
    api = signedOut()
    api.links.set('tok_3', { kind: 'invite', username: 'carol' })
    mountApp()
    await flushPromises()
    history.replaceState(null, '', '/#/invite/tok_3')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await flushPromises()
    expect(heading()).toBe('Welcome, carol')
  })
})

describe('signing out', () => {
  it('shows who is signed in and signs out, forgetting the data', async () => {
    api = signedIn()
    mountApp()
    await flushPromises()
    await openProfile()
    expect(wrapper.get('[data-testid="signed-in-as"]').text()).toBe(`Signed in as ${USER}`)
    await button('Sign out').trigger('click')
    await flushPromises()
    expect(heading()).toBe('Sign in')
    expect(localStorage.getItem(CACHE_PREFIX + USER)).toBeNull()
  })

  it('asks first when changes have not synced', async () => {
    api = signedIn()
    mountApp()
    await flushPromises()
    api.offline = true
    await wrapper.findAll('button[aria-label^="Squats,"]')[0]!.trigger('click')
    await flushPromises()
    api.offline = false
    await openProfile()
    await button('Sign out').trigger('click')
    await settle()
    // Signing out forgets this device's unsent changes, so it asks first.
    expect(confirmation()!.get('h2').text()).toBe('Sign out now?')
    expect(confirmation()!.text()).toContain(
      'Two changes on this device haven’t reached the server yet. Signing out now loses them.',
    )
    await confirmButton('Cancel').trigger('click')
    await settle()
    expect(confirmation()).toBeNull()
    expect(api.paths('/auth/logout')).toEqual([])
    // Focus goes back to Sign out, the control the question came from, still on the page.
    expect(document.activeElement).toBe(button('Sign out').element)
  })

  it('signs out after a confirm, in the singular for one change', async () => {
    api = signedIn()
    mountApp()
    await flushPromises()
    api.offline = true
    // One change that can't reach the server: a daily target, set in Edit plan (K56).
    await wrapper.get('[data-testid="edit-plan-button"]').trigger('click')
    await wrapper.get('button[aria-label="More exercises a day"]').trigger('click')
    await flushPromises()
    api.offline = false
    await openProfile()
    await button('Sign out').trigger('click')
    await settle()
    expect(confirmation()!.text()).toContain(
      'One change on this device hasn’t reached the server yet. Signing out now loses them.',
    )
    const release = api.hold()
    await confirmButton('Sign out').trigger('click')
    await confirmButton('Sign out').trigger('click') // a second press while the first is under way
    expect(confirmButton('Sign out').attributes('aria-busy')).toBe('true')
    release()
    await settle()
    expect(api.paths('/auth/logout')).toHaveLength(1)
    expect(confirmation()).toBeNull()
    expect(heading()).toBe('Sign in')
  })

  it('keeps the question open and says why when signing out fails there', async () => {
    api = signedIn()
    mountApp()
    await flushPromises()
    api.offline = true
    await wrapper.findAll('button[aria-label^="Squats,"]')[0]!.trigger('click')
    await flushPromises()
    await openProfile()
    await button('Sign out').trigger('click')
    await settle()
    await confirmButton('Sign out').trigger('click')
    await settle()
    expect(confirmation()!.get('[role="alert"]').text()).toBe(
      'Can’t reach the server. Check the connection and try again.',
    )
    expect(confirmButton('Sign out').attributes('aria-busy')).toBeUndefined()
    expect(heading()).toBe('Profile')
  })

  it('refuses while offline, and says why', async () => {
    api = signedIn()
    mountApp()
    await flushPromises()
    api.offline = true
    await openProfile()
    await button('Sign out').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="sign-out-problem"]').text()).toBe(
      'Can’t reach the server. Check the connection and try again.',
    )
    expect(wrapper.get('[data-testid="sign-out-problem"]').attributes('role')).toBe('alert')
    // Still signed in, still on the Profile page.
    expect(heading()).toBe('Profile')
  })
})

describe('other tabs', () => {
  it('follows another tab signing out, and another signing in as someone else', async () => {
    api = signedIn()
    api.addUser('bob')
    mountApp()
    await flushPromises()
    localStorage.removeItem(SESSION_KEY)
    api.signedIn = null
    window.dispatchEvent(
      new StorageEvent('storage', { key: SESSION_KEY, storageArea: localStorage }),
    )
    await flushPromises()
    expect(heading()).toBe('Sign in')
    localStorage.setItem(SESSION_KEY, JSON.stringify({ user: 'bob' }))
    api.signedIn = 'bob'
    window.dispatchEvent(
      new StorageEvent('storage', { key: SESSION_KEY, storageArea: localStorage }),
    )
    await flushPromises()
    expect(heading()).toBe('19–25 October')
    await openProfile()
    expect(wrapper.get('[data-testid="signed-in-as"]').text()).toBe('Signed in as bob')
  })
})

describe('sync status', () => {
  function status() {
    return wrapper.find('[data-testid="sync-status"]')
  }

  it('says it is loading when the device has no copy yet', async () => {
    api = signedIn()
    localStorage.removeItem(CACHE_PREFIX + USER)
    api.stall('GET', '/state')
    mountApp()
    await flushPromises()
    expect(status().text()).toBe('Loading your data…')
    expect(status().attributes('data-state')).toBe('loading')
    expect(wrapper.find('[data-testid="exercise-grid"]').exists()).toBe(false)
  })

  it('offers a retry when there is no copy and no connection', async () => {
    api = signedIn()
    localStorage.removeItem(CACHE_PREFIX + USER)
    api.offline = true
    mountApp()
    await flushPromises()
    expect(status().text()).toBe(
      'Can’t reach the server. This device has no saved copy of your data yet. Retry',
    )
    api.offline = false
    const release = api.hold()
    await status().get('button').trigger('click')
    // Trying again: the banner says so at once, without the offline icon or Retry.
    expect(status().text()).toBe('Loading your data…')
    expect(status().attributes('data-tone')).toBe('neutral')
    expect(status().find('svg').exists()).toBe(false)
    release()
    await flushPromises()
    expect(status().exists()).toBe(false)
    expect(wrapper.find('[data-testid="exercise-grid"]').exists()).toBe(true)
  })

  it('counts unsynced changes while offline, and says nothing once they sync', async () => {
    api = signedIn()
    mountApp()
    await flushPromises()
    api.offline = true
    await wrapper.findAll('button[aria-label^="Squats,"]')[0]!.trigger('click')
    await flushPromises()
    expect(status().get('p').text()).toBe(
      'Not synced. Two changes are saved on this device and will sync when you’re back online.',
    )
    expect(JSON.parse(localStorage.getItem(OUTBOX_PREFIX + USER)!)).toHaveLength(2)
    api.offline = false
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(status().exists()).toBe(false)
  })

  it('uses the singular for one waiting change', async () => {
    api = signedIn()
    mountApp()
    await flushPromises()
    api.offline = true
    usePlannerStore().changeDailyPick(1)
    await flushPromises()
    expect(status().get('p').text()).toBe(
      'Not synced. One change is saved on this device and will sync when you’re back online.',
    )
  })

  it('says it is showing the saved copy when offline with nothing queued', async () => {
    api = signedIn()
    api.offline = true
    mountApp()
    await flushPromises()
    expect(status().get('p').text()).toBe('Offline. Showing the data saved on this device.')
  })

  it('tells offline and a lost change apart by tone and icon, not only words (F27)', async () => {
    api = signedIn()
    api.offline = true
    mountApp()
    await flushPromises()
    const offline = status()
    expect(offline.attributes('data-tone')).toBe('neutral')
    expect(offline.get('svg').classes()).toContain('lucide-cloud-off')
    useSyncStore().notice = CONFLICT_NOTICE
    await flushPromises()
    const conflict = wrapper.get('[data-testid="sync-notice"]')
    expect(conflict.attributes('data-tone')).toBe('error')
    expect(conflict.get('svg').classes()).toContain('lucide-circle-alert')
  })

  it('shows a conflict notice until dismissed', async () => {
    api = signedIn()
    mountApp()
    await flushPromises()
    useSyncStore().notice = CONFLICT_NOTICE
    await flushPromises()
    const notice = wrapper.get('[data-testid="sync-notice"]')
    expect(notice.get('p').text()).toBe(`Your change wasn’t kept. ${CONFLICT_NOTICE}`)
    await notice.get('button').trigger('click')
    expect(wrapper.find('[data-testid="sync-notice"]').exists()).toBe(false)
  })

  it('says a change refused for quota was not saved because the account is full', async () => {
    api = signedIn()
    mountApp()
    await flushPromises()
    useSyncStore().notice = QUOTA_NOTICE
    await flushPromises()
    const notice = wrapper.get('[data-testid="sync-notice"]')
    expect(notice.attributes('data-tone')).toBe('error')
    expect(notice.get('p').text()).toBe(
      'Your change wasn’t saved. Your account is full, so it was undone here. Ask whoever runs this planner for more room.',
    )
  })

  it('says a refused change was not saved, and what to do', async () => {
    api = signedIn()
    mountApp()
    await flushPromises()
    useSyncStore().notice = REFUSED_NOTICE
    await flushPromises()
    const notice = wrapper.get('[data-testid="sync-notice"]')
    expect(notice.attributes('data-tone')).toBe('error')
    expect(notice.get('p').text()).toBe(
      'Your change wasn’t saved. The server refused it, so it was undone here. Reload to see what was saved.',
    )
  })

  it('shows any other notice as it is, still in the error tone', async () => {
    api = signedIn()
    mountApp()
    await flushPromises()
    useSyncStore().notice = 'Something else happened to a change.'
    await flushPromises()
    const notice = wrapper.get('[data-testid="sync-notice"]')
    expect(notice.attributes('data-tone')).toBe('error')
    expect(notice.get('p').text()).toBe('Something else happened to a change.')
  })

  it('leaves a hidden tab alone, and ignores sessionStorage events', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(NOW)
    api = signedIn()
    mountApp()
    await flushPromises()
    const reads = () => api.paths('GET /state').length
    const start = reads()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(60_000)
    window.dispatchEvent(
      new StorageEvent('storage', { key: CACHE_PREFIX + USER, storageArea: sessionStorage }),
    )
    await flushPromises()
    expect(reads()).toBe(start)
    visibility.mockRestore()
  })

  it('reads the server on focus, when visible again, and every minute', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(NOW)
    api = signedIn()
    mountApp()
    await flushPromises()
    const reads = () => api.paths('GET /state').length
    const start = reads()
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(reads()).toBe(start + 1)
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    expect(reads()).toBe(start + 2)
    vi.advanceTimersByTime(60_000)
    await flushPromises()
    expect(reads()).toBe(start + 3)
  })
})
