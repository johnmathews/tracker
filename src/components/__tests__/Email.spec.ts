import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import { SESSION_KEY } from '@/stores/session'
import { describeProblem } from '@/lib/problems'
import { FakeApi } from '@/lib/__tests__/fakeApi'
import { USER, emptyState } from '@/lib/__tests__/signedIn'
import { CACHE_PREFIX } from '@/stores/sync'

const NOW = new Date(2026, 9, 23, 18, 0)
const SAM = 'sam@example.com'

let wrapper: VueWrapper
let api: FakeApi

function mountApp(): VueWrapper {
  const pinia = createPinia()
  setActivePinia(pinia)
  wrapper = mount(App, { global: { plugins: [pinia] }, attachTo: document.body })
  return wrapper
}

/** An API with mail on (unless told otherwise), where sam and alice exist but are signed out. */
function signedOut(mail = true): FakeApi {
  const a = new FakeApi()
  a.mail = mail
  a.addUser(SAM)
  a.addUser(USER)
  vi.stubGlobal('fetch', a.fetch)
  return a
}

/** A browser signed in as `name`, with an empty cache so the week renders at once. */
function signedInAs(name: string, mail = true): FakeApi {
  const a = signedOut(mail)
  a.signedIn = name
  localStorage.setItem(SESSION_KEY, JSON.stringify({ user: name }))
  localStorage.setItem(CACHE_PREFIX + name, JSON.stringify(emptyState()))
  return a
}

function heading(): string {
  return wrapper.get('h1').text()
}

function button(name: string) {
  return wrapper.findAll('button').find((b) => b.text() === name)
}

function link(name: string) {
  return wrapper.findAll('a').find((a) => a.text() === name)
}

/** As a link opened in a running tab: one hashchange (setting location.hash would queue another). */
async function go(hash: string): Promise<void> {
  history.replaceState(null, '', `/${hash}`)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  await flushPromises()
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

describe('forgot your password', () => {
  it('is offered on sign-in only when the planner sends email', async () => {
    api = signedOut(false)
    mountApp()
    await flushPromises()
    expect(heading()).toBe('Sign in')
    expect(link('Forgot your password?')).toBeUndefined()
    wrapper.unmount()
    api = signedOut(true)
    mountApp()
    await flushPromises()
    expect(link('Forgot your password?')!.attributes('href')).toBe('#/forgot')
  })

  it('asks for the email and says the same whatever the answer', async () => {
    api = signedOut()
    mountApp()
    await flushPromises()
    await go('#/forgot')
    expect(heading()).toBe('Reset your password')
    expect(wrapper.get('#forgot-email').attributes('type')).toBe('email')
    expect(wrapper.find('#forgot-email-hint').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('username')
    await wrapper.get('#forgot-email').setValue(' nobody@example.com ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(api.forgotten).toEqual(['nobody@example.com'])
    expect(wrapper.get('[data-testid="forgot-sent"]').text()).toBe(
      'If there’s an account for nobody@example.com, a link to choose a new password is on its way. It works for one hour.',
    )
    expect(wrapper.find('form').exists()).toBe(false)
    await link('Go to sign in')!.trigger('click')
    await flushPromises()
    expect(heading()).toBe('Sign in')
    expect(location.hash).toBe('')
  })

  it('puts a malformed email on the field, and anything else above the button', async () => {
    api = signedOut()
    history.replaceState(null, '', '/#/forgot')
    mountApp()
    await flushPromises()
    await wrapper.get('#forgot-email').setValue('sam@nowhere')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('#forgot-email-error').text()).toBe(describeProblem({ code: 'email' }))
    expect(document.activeElement?.id).toBe('forgot-email')
    await wrapper.get('#forgot-email').setValue('sam@example.com')
    expect(wrapper.find('#forgot-email-error').exists()).toBe(false)
    api.offline = true
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[data-testid="forgot-problem"]').text()).toBe(
      describeProblem({ code: 'offline' }),
    )
  })

  it('sends one request however often the button is pressed', async () => {
    api = signedOut()
    history.replaceState(null, '', '/#/forgot')
    mountApp()
    await flushPromises()
    await wrapper.get('#forgot-email').setValue(SAM)
    const go = api.holdNext('POST', '/auth/forgot')
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    expect(button('Sending link…')!.attributes('aria-busy')).toBe('true')
    go()
    await flushPromises()
    expect(api.paths('/auth/forgot')).toEqual(['POST /auth/forgot'])
  })

  it('shows the planner, not the form, to someone signed in', async () => {
    api = signedInAs(USER)
    history.replaceState(null, '', '/#/forgot')
    mountApp()
    await flushPromises()
    expect(heading()).toBe('19–25 October')
    expect(location.hash).toBe('')
  })
})

describe('confirming an email', () => {
  it('asks a new account to confirm, and sends the link again once', async () => {
    api = signedOut()
    history.replaceState(null, '', '/#/signup')
    mountApp()
    await flushPromises()
    await wrapper.get('#signup-email').setValue('new@example.com')
    await wrapper.get('#signup-password').setValue('a long new password')
    await wrapper.get('#signup-confirm').setValue('a long new password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const banner = wrapper.get('[data-testid="email-status"]')
    expect(banner.text()).toContain('Confirm your email.')
    expect(banner.text()).toContain('The link is in the email sent to new@example.com.')
    await button('Send it again')!.trigger('click')
    await flushPromises()
    expect(api.paths('/auth/confirm/resend')).toEqual(['POST /auth/confirm/resend'])
    expect(wrapper.get('[data-testid="email-status"]').text()).toContain(
      'A new link is on its way to new@example.com.',
    )
    expect(button('Send it again')).toBeUndefined()
  })

  it('says how long to wait when it is too soon', async () => {
    api = signedInAs(SAM)
    mountApp()
    await flushPromises()
    api.failNext('POST', '/auth/confirm/resend', 429, { error: 'too-soon', retryAfter: 45 })
    await button('Send it again')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="email-status"]').text()).toContain(
      'Can’t send another email yet. Try again in one minute.',
    )
    expect(button('Send it again')).toBeDefined()
  })

  it('goes once the email turns out to be confirmed already', async () => {
    api = signedInAs(SAM)
    mountApp()
    await flushPromises()
    api.confirmed.add(SAM)
    await button('Send it again')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="email-status"]').exists()).toBe(false)
  })

  it('shows no banner to a confirmed, invited or mail-less account', async () => {
    for (const [name, mail, confirmed] of [
      [SAM, true, true],
      [USER, true, false],
      [SAM, false, false],
    ] as const) {
      api = signedInAs(name, mail)
      if (confirmed) api.confirmed.add(name)
      mountApp()
      await flushPromises()
      expect(heading()).toBe('19–25 October')
      expect(wrapper.find('[data-testid="email-status"]').exists()).toBe(false)
      wrapper.unmount()
      localStorage.clear()
    }
  })

  it('confirms from the link while signed in, and the banner goes', async () => {
    api = signedInAs(SAM)
    api.confirmLinks.set('tok_c', SAM)
    mountApp()
    await flushPromises()
    expect(wrapper.find('[data-testid="email-status"]').exists()).toBe(true)
    await go('#/confirm/tok_c')
    expect(heading()).toBe('Email confirmed')
    expect(wrapper.get('[data-testid="confirm-done"]').text()).toBe(
      'Password resets for sam@example.com will reach you there.',
    )
    expect(location.hash).toBe('')
    await link('Go to the week')!.trigger('click')
    await flushPromises()
    expect(heading()).toBe('19–25 October')
    expect(wrapper.find('[data-testid="email-status"]').exists()).toBe(false)
  })

  it('confirms from the link while signed out, then leads to sign in', async () => {
    api = signedOut()
    api.confirmLinks.set('tok_d', SAM)
    history.replaceState(null, '', '/#/confirm/tok_d')
    mountApp()
    expect(heading()).toBe('Confirming your email…')
    await flushPromises()
    expect(heading()).toBe('Email confirmed')
    expect(api.confirmed.has(SAM)).toBe(true)
    await link('Go to sign in')!.trigger('click')
    await flushPromises()
    expect(heading()).toBe('Sign in')
  })

  it('says when a link is no good, with where to get a new one', async () => {
    api = signedOut()
    history.replaceState(null, '', '/#/confirm/used')
    mountApp()
    await flushPromises()
    expect(heading()).toBe('Link not valid')
    expect(wrapper.get('[role="alert"]').text()).toBe(
      'This link has expired or was already used. Sign in and choose “Send it again” for a new one.',
    )
    expect(location.hash).toBe('')
    expect(button('Try again')).toBeUndefined()
    await link('Go to sign in')!.trigger('click')
    await flushPromises()
    expect(heading()).toBe('Sign in')
  })

  it('points a signed-in person at the banner for a new link', async () => {
    api = signedInAs(SAM)
    history.replaceState(null, '', '/#/confirm/used')
    mountApp()
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe(
      'This link has expired or was already used. Choose “Send it again” for a new one.',
    )
    await link('Go to the week')!.trigger('click')
    await flushPromises()
    expect(heading()).toBe('19–25 October')
  })

  it('sends one new link however often the button is pressed', async () => {
    api = signedInAs(SAM)
    mountApp()
    await flushPromises()
    const release = api.holdNext('POST', '/auth/confirm/resend')
    await button('Send it again')!.trigger('click')
    await button('Sending…')!.trigger('click')
    expect(button('Sending…')!.attributes('aria-busy')).toBe('true')
    release()
    await flushPromises()
    expect(api.paths('/auth/confirm/resend')).toEqual(['POST /auth/confirm/resend'])
  })

  it('offers to try again when the link could not be checked', async () => {
    api = signedInAs(SAM)
    api.confirmLinks.set('tok_e', SAM)
    api.offline = true
    history.replaceState(null, '', '/#/confirm/tok_e')
    mountApp()
    await flushPromises()
    expect(heading()).toBe('Couldn’t check the link')
    expect(location.hash).toBe('#/confirm/tok_e') // it may still be good
    api.offline = false
    await button('Try again')!.trigger('click')
    await flushPromises()
    expect(heading()).toBe('Email confirmed')
  })
})

describe('problems', () => {
  it('words the new refusals', () => {
    expect(describeProblem({ code: 'too-soon', retryAfter: 600 })).toBe(
      'Can’t send another email yet. Try again in ten minutes.',
    )
    expect(describeProblem({ code: 'too-soon', retryAfter: 3 * 3600 })).toBe(
      'Can’t send another email yet. Try again in three hours.',
    )
    expect(describeProblem({ code: 'too-soon' })).toBe(
      'Can’t send another email yet. Try again in one minute.',
    )
    expect(describeProblem({ code: 'confirmed' })).toBe('Your email is already confirmed.')
    expect(describeProblem({ code: 'mail-off' })).toBe(
      'This planner doesn’t send email. Ask whoever runs it for a reset link.',
    )
  })
})
