import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import { SESSION_KEY, useSessionStore } from '@/stores/session'
import { CACHE_PREFIX } from '@/stores/sync'
import { navigateTo } from '@/lib/connections'
import { FakeApi, PASSWORD } from '@/lib/__tests__/fakeApi'
import { USER, emptyState } from '@/lib/__tests__/signedIn'

// The consent screen leaves for the app's address; jsdom can't, so the call is recorded.
vi.mock('@/lib/connections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/connections')>()),
  navigateTo: vi.fn<(url: string) => void>(),
}))

const NOW = new Date(2026, 10, 3, 14, 0)
const SAM = 'sam@example.com'

let wrapper: VueWrapper
let api: FakeApi

/** An API where sam and alice exist, nobody is signed in, and claude.ai's request `req1` waits. */
function signedOut(): FakeApi {
  const a = new FakeApi()
  a.addUser(SAM)
  a.addUser(USER)
  a.addRequest('req1', { scope: 'read write' })
  vi.stubGlobal('fetch', a.fetch)
  return a
}

/** The same, signed in as sam with an empty cache. */
function signedInAsSam(): FakeApi {
  const a = signedOut()
  a.signedIn = SAM
  localStorage.setItem(SESSION_KEY, JSON.stringify({ user: SAM }))
  localStorage.setItem(CACHE_PREFIX + SAM, JSON.stringify(emptyState()))
  return a
}

async function open(hash = '#/connect/req1'): Promise<VueWrapper> {
  history.replaceState(null, '', `/${hash}`)
  const pinia = createPinia()
  setActivePinia(pinia)
  wrapper = mount(App, { global: { plugins: [pinia] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

function heading(): string {
  return wrapper.get('h1').text()
}

function button(name: string): DOMWrapper<HTMLButtonElement> {
  return wrapper.findAll<HTMLButtonElement>('button').find((b) => b.text() === name)!
}

function radio(name: string): DOMWrapper<HTMLElement> {
  return wrapper.findAll<HTMLElement>('[role="radio"]').find((r) => r.text().startsWith(name))!
}

function field(id: string) {
  return wrapper.get<HTMLInputElement>(`#${id}`)
}

function approvals() {
  return api.calls.filter((c) => c.path === '/oauth/requests/req1/approve')
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  localStorage.clear()
  vi.mocked(navigateTo).mockClear()
})

afterEach(() => {
  wrapper?.unmount()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  history.replaceState(null, '', '/')
})

describe('the consent screen (#/connect/<id>)', () => {
  it('shows a signed-out visitor the request, not the planner or sign-in', async () => {
    api = signedOut()
    await open()
    expect(heading()).toBe('Connect Claude')
    expect(wrapper.find('[data-testid="exercise-grid"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Sign in to see your plans')
    expect(wrapper.get('[data-testid="connect-warning"]').text()).toBe(
      'Only continue if you just asked Claude to connect to your tracker. If you didn’t, choose Cancel.',
    )
    const who = wrapper.get('[data-testid="connect-who"]')
    expect(who.findAll('dt').map((d) => d.text())).toEqual(['Asking', 'Then back to'])
    expect(who.findAll('dd').map((d) => d.text())).toEqual(['Claude, from claude.ai', 'claude.ai'])
    expect(field('connect-email').element.value).toBe('')
    expect(wrapper.text()).not.toContain('You’re signed in')
    expect(wrapper.get('[data-testid="connect-footnote"]').text()).toBe(
      'The connection lasts 90 days. You can remove it sooner in Settings › Connections.',
    )
  })

  it('picks Read only, whatever the app asked for', async () => {
    api = signedOut()
    await open()
    expect(wrapper.get('[role="radiogroup"]').attributes('aria-labelledby')).toBeTruthy()
    expect(wrapper.text()).toContain('What Claude can do')
    expect(radio('Read only').attributes('aria-checked')).toBe('true')
    expect(radio('Read and change').attributes('aria-checked')).toBe('false')
    expect(radio('Read only').text()).toContain('See your plans, marks and notes.')
    expect(radio('Read and change').text()).toContain('Also mark days, and add and edit items.')
  })

  it('fills the email when signed in, and says why the password is asked again', async () => {
    api = signedInAsSam()
    await open()
    expect(heading()).toBe('Connect Claude')
    expect(field('connect-email').element.value).toBe(SAM)
    expect(wrapper.text()).toContain(
      'You’re signed in, but connecting an app asks for your password again.',
    )
  })

  it('names the app from its metadata, and a loopback redirect as this computer', async () => {
    api = signedOut()
    api.addRequest('code1', { clientName: 'Claude Code', redirectHost: '127.0.0.1' })
    await open('#/connect/code1')
    expect(heading()).toBe('Connect Claude Code')
    expect(wrapper.text()).toContain('What Claude Code can do')
    expect(
      wrapper
        .get('[data-testid="connect-who"]')
        .findAll('dd')
        .map((d) => d.text()),
    ).toEqual(['Claude Code, from claude.ai', 'this computer (localhost)'])
  })

  it('sends the email, the password and Read only, then goes back to the app', async () => {
    api = signedOut()
    await open()
    await field('connect-email').setValue(` ${SAM} `)
    await field('connect-password').setValue(PASSWORD)
    await button('Connect').trigger('click')
    await flushPromises()
    expect(approvals().map((c) => c.body)).toEqual([
      { email: SAM, password: PASSWORD, write: false },
    ])
    expect(navigateTo).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/claude\.ai\/api\/mcp\/auth_callback\?code=/),
    )
    // Approving signs nobody in (D4).
    expect(useSessionStore().status).toBe('signed-out')
  })

  it('sends write: true once Read and change is picked', async () => {
    api = signedInAsSam()
    await open()
    await radio('Read and change').trigger('click')
    expect(radio('Read and change').attributes('aria-checked')).toBe('true')
    await field('connect-password').setValue(PASSWORD)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(approvals().map((c) => c.body)).toEqual([
      { email: SAM, password: PASSWORD, write: true },
    ])
    expect(api.accounts.get(SAM)!.connections.map((c) => c.scope)).toEqual(['write'])
  })

  it('shows a wrong password on both fields, and signs nobody out', async () => {
    api = signedInAsSam()
    await open()
    await field('connect-password').setValue('not the password')
    await button('Connect').trigger('click')
    await flushPromises()
    for (const id of ['connect-email', 'connect-password']) {
      expect(field(id).attributes('aria-invalid')).toBe('true')
      expect(field(id).attributes('aria-describedby')).toContain('connect-problem')
    }
    expect(wrapper.get('#connect-problem').text()).toBe(
      'Wrong email or password. Check them and try again.',
    )
    expect(wrapper.get('#connect-problem').attributes('role')).toBe('alert')
    expect(document.activeElement).toBe(field('connect-password').element)
    expect(navigateTo).not.toHaveBeenCalled()
    expect(useSessionStore().status).toBe('signed-in')
    expect(useSessionStore().user).toBe(SAM)
    expect(api.paths('/auth/logout')).toEqual([])
    expect(heading()).toBe('Connect Claude')
  })

  it('says when the account has as many connections as it may', async () => {
    api = signedOut()
    api.maxConnections = 0
    await open()
    await field('connect-email').setValue(SAM)
    await field('connect-password').setValue(PASSWORD)
    await button('Connect').trigger('click')
    await flushPromises()
    expect(wrapper.get('#connect-problem').text()).toBe(
      'You have ten connections, the most there can be. Remove one in Settings › Connections, then try again.',
    )
    expect(field('connect-password').attributes('aria-invalid')).toBeUndefined()
  })

  it('words the lockout as sign-in does', async () => {
    api = signedOut()
    api.failNext('POST', '/oauth/requests/req1/approve', 423, {
      error: 'locked',
      retryAfter: 900,
    })
    await open()
    await field('connect-email').setValue(SAM)
    await field('connect-password').setValue(PASSWORD)
    await button('Connect').trigger('click')
    await flushPromises()
    expect(wrapper.get('#connect-problem').text()).toBe(
      'Too many attempts. Try again in 15 minutes.',
    )
  })

  it('connects once however often Connect is pressed, and says it is busy', async () => {
    api = signedOut()
    await open()
    await field('connect-email').setValue(SAM)
    await field('connect-password').setValue(PASSWORD)
    const release = api.holdNext('POST', '/oauth/requests/req1/approve')
    await button('Connect').trigger('click')
    const busy = button('Connecting…')
    expect(busy.attributes('aria-busy')).toBe('true')
    await busy.trigger('click')
    release()
    await flushPromises()
    expect(approvals()).toHaveLength(1)
    expect(navigateTo).toHaveBeenCalledTimes(1)
  })

  it('cancels with a JSON body and goes back to the app with access_denied', async () => {
    api = signedOut()
    await open()
    await button('Cancel').trigger('click')
    await flushPromises()
    const deny = api.calls.filter((c) => c.path === '/oauth/requests/req1/deny')
    expect(deny.map((c) => c.body)).toEqual([{}])
    expect(navigateTo).toHaveBeenCalledWith(expect.stringContaining('error=access_denied'))
    expect(api.oauthRequests.has('req1')).toBe(false)
  })

  it('stays on screen and says why when Cancel can’t reach the server', async () => {
    api = signedOut()
    await open()
    api.offline = true
    await button('Cancel').trigger('click')
    await flushPromises()
    expect(navigateTo).not.toHaveBeenCalled()
    expect(wrapper.get('#connect-problem').text()).toBe(
      'Can’t reach the server. Check the connection and try again.',
    )
    expect(button('Cancel').attributes('aria-busy')).toBeUndefined()
  })

  it('says a turned-off account can’t connect, and words an unknown failure plainly', async () => {
    api = signedOut()
    api.failNext('POST', '/oauth/requests/req1/approve', 403, { error: 'disabled' })
    await open()
    await field('connect-email').setValue(SAM)
    await field('connect-password').setValue(PASSWORD)
    await button('Connect').trigger('click')
    await flushPromises()
    expect(wrapper.get('#connect-problem').text()).toBe(
      'This account is turned off. Ask whoever runs this planner.',
    )
    api.failNext('POST', '/oauth/requests/req1/approve', 500)
    await button('Connect').trigger('click')
    await flushPromises()
    expect(navigateTo).not.toHaveBeenCalled()
    expect(wrapper.get('#connect-problem').text()).not.toBe(
      'This account is turned off. Ask whoever runs this planner.',
    )
    expect(field('connect-password').attributes('aria-invalid')).toBeUndefined()
  })

  it('says the link has expired when it ends before Cancel', async () => {
    api = signedOut()
    await open()
    api.oauthRequests.delete('req1')
    await button('Cancel').trigger('click')
    await flushPromises()
    expect(navigateTo).not.toHaveBeenCalled()
    expect(heading()).toBe('This link has expired')
  })

  it('says an unknown or used link has expired, with no form', async () => {
    api = signedOut()
    await open('#/connect/gone')
    expect(heading()).toBe('This link has expired')
    expect(wrapper.text()).toContain(
      'It was already used, or it’s more than ten minutes old. Go back to the app and connect again.',
    )
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.find('input[type="password"]').exists()).toBe(false)
    // The dead id leaves the address bar; the link leads on.
    expect(location.hash).toBe('')
    await wrapper
      .findAll('a')
      .find((a) => a.text() === 'Go to sign in')!
      .trigger('click')
    await flushPromises()
    expect(heading()).toBe('Sign in')
  })

  it('shows the expired card when the request ends while the form is open', async () => {
    api = signedOut()
    await open()
    api.oauthRequests.clear()
    await field('connect-email').setValue(SAM)
    await field('connect-password').setValue(PASSWORD)
    await button('Connect').trigger('click')
    await flushPromises()
    expect(heading()).toBe('This link has expired')
  })

  it('offers to try again when the request could not be read', async () => {
    api = signedOut()
    api.offline = true
    await open()
    expect(heading()).toBe('Couldn’t check the link')
    expect(wrapper.text()).toContain('Can’t reach the server. Check the connection and try again.')
    expect(location.hash).toBe('#/connect/req1')
    api.offline = false
    await button('Try again').trigger('click')
    await flushPromises()
    expect(heading()).toBe('Connect Claude')
  })

  it('stays on screen when another tab signs out (F10)', async () => {
    api = signedInAsSam()
    await open()
    localStorage.removeItem(SESSION_KEY)
    window.dispatchEvent(
      new StorageEvent('storage', { key: SESSION_KEY, storageArea: localStorage }),
    )
    await flushPromises()
    expect(useSessionStore().status).toBe('signed-out')
    expect(heading()).toBe('Connect Claude')
    expect(location.hash).toBe('#/connect/req1')
  })
})
