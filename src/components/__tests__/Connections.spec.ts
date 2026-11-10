import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import type { FakeApi, FakeConnection, FakeToken } from '@/lib/__tests__/fakeApi'
import { USER, signedIn } from '@/lib/__tests__/signedIn'

const NOW = new Date(2026, 10, 3, 14, 10)
const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  Math.floor(new Date(y, m, d, h, min).getTime() / 1000)

const CLAUDE: FakeConnection = {
  id: 'g1',
  clientName: 'Claude',
  clientHost: 'claude.ai',
  scope: 'write',
  createdAt: at(2026, 10, 3, 14, 2),
  lastUsedAt: at(2026, 10, 3, 14, 5),
  expiresAt: at(2027, 1, 1, 14, 2),
  isNew: true,
}
const CODE: FakeConnection = {
  id: 'g2',
  clientName: 'Claude Code',
  clientHost: 'claude.ai',
  scope: 'read',
  createdAt: at(2026, 9, 28, 9, 12),
  lastUsedAt: at(2026, 10, 2, 20, 0),
  expiresAt: at(2027, 0, 26, 9, 12),
  isNew: false,
}
const LAPTOP: FakeToken = {
  name: 'Laptop',
  prefix: 'Xq7mPa2L',
  scope: 'write',
  createdAt: at(2026, 9, 24),
  lastUsedAt: at(2026, 10, 1),
}
const SCRIPT: FakeToken = {
  name: 'Weekly report script',
  prefix: 'b9RkT0wc',
  scope: 'read',
  createdAt: at(2026, 9, 30),
  lastUsedAt: null,
}

let wrapper: VueWrapper
let api: FakeApi
let clipboard: { writeText: Mock<(text: string) => Promise<void>> }

/** Settings, signed in as alice, whose account holds these connections and tokens. */
async function openSettings({
  connections = [CLAUDE, CODE],
  tokens = [LAPTOP, SCRIPT],
}: { connections?: FakeConnection[]; tokens?: FakeToken[] } = {}): Promise<void> {
  history.replaceState(null, '', '/#/settings')
  api = signedIn()
  const account = api.accounts.get(USER)!
  account.connections = connections.map((c) => ({ ...c }))
  account.tokens = tokens.map((t) => ({ ...t }))
  await mountApp()
}

async function mountApp(): Promise<void> {
  const pinia = createPinia()
  setActivePinia(pinia)
  wrapper = mount(App, { global: { plugins: [pinia] }, attachTo: document.body })
  await settle()
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function section() {
  return wrapper.get('[data-testid="connections-section"]')
}

function button(name: string, within = section()) {
  return within.findAll('button').find((b) => b.text() === name)
}

/** Each row of a list as its name and its line of facts. */
function rows(testid: string): string[][] {
  return section()
    .get(`[data-testid="${testid}"]`)
    .findAll('li')
    .map((li) => [
      li.get('[data-slot="connection-name"]').text(),
      li.get('[data-slot="connection-facts"]').text(),
    ])
}

function confirmation(): DOMWrapper<HTMLElement> | null {
  const el = document.querySelector<HTMLElement>('[role="alertdialog"]')
  return el ? new DOMWrapper(el) : null
}

async function answer(name: string): Promise<void> {
  await confirmation()!
    .findAll('button')
    .find((b) => b.text() === name)!
    .trigger('click')
  await settle()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  localStorage.clear()
  sessionStorage.clear()
  clipboard = { writeText: vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined) }
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })
})

afterEach(() => {
  wrapper?.unmount()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  history.replaceState(null, '', '/')
})

describe('Settings › Connections', () => {
  it('is the last row, after Your data (K106)', async () => {
    await openSettings()
    expect(
      wrapper
        .get('[data-testid="settings-page"]')
        .findAll('h2')
        .map((h) => h.text()),
    ).toEqual(['Appearance', 'Daily goal', 'Your data', 'Connections'])
    expect(
      section()
        .findAll('h3')
        .map((h) => h.text()),
    ).toEqual(['Apps', 'Tokens'])
  })

  it('gives the address to paste, with Copy, and how to connect each app', async () => {
    await openSettings()
    const address = `${location.origin}/api/mcp`
    expect(section().get('[data-testid="mcp-address"]').text()).toBe(address)
    await button('Copy', section().get('[data-testid="mcp-address-tile"]'))!.trigger('click')
    await settle()
    expect(clipboard.writeText).toHaveBeenCalledWith(address)
    expect(button('Copied', section().get('[data-testid="mcp-address-tile"]'))).toBeDefined()
    const how = section().get('[data-testid="connect-how"]').text()
    expect(how).toContain('in Claude’s Settings › Connectors, choose Add custom connector')
    expect(how).toContain(`claude mcp add --transport http tracker ${address}`)
    expect(how).toContain('in ChatGPT’s Plugins, choose + then Add custom MCP server')
    expect(section().get('[data-testid="connect-how"] code').classes()).toContain('font-mono')
  })

  it('lists the apps and the tokens, each with a line of facts', async () => {
    await openSettings()
    expect(rows('apps-list')).toEqual([
      [
        'Claude · claude.ai',
        'New · Read and change · connected 3 Nov at 14:02 · last used today at 14:05 · ends 1 Feb',
      ],
      [
        'Claude Code · claude.ai',
        'Read only · connected 28 Oct at 09:12 · last used yesterday · ends 26 Jan',
      ],
    ])
    expect(rows('tokens-list')).toEqual([
      ['Laptop', 'trk_Xq7mPa2L… · Read and change · created 24 Oct · last used 1 Nov'],
      ['Weekly report script', 'trk_b9RkT0wc… · Read only · created 30 Oct · never used'],
    ])
    expect(api.calls.find((c) => c.path === '/tokens')!.expectedUser).toBe(USER)
    expect(api.calls.find((c) => c.path === '/connections')!.expectedUser).toBe(USER)
  })

  it('says so when nothing is connected and there are no tokens', async () => {
    await openSettings({ connections: [], tokens: [] })
    expect(section().text()).toContain('No apps are connected.')
    expect(section().text()).toContain('No tokens yet.')
    expect(section().find('[data-testid="connection-banner"]').exists()).toBe(false)
  })

  it('creates a token and shows it once, with Copy, above the list that gains it', async () => {
    await openSettings()
    await button('Create token')!.trigger('click')
    const form = section().get('[data-testid="token-form"]')
    await form.get('input').setValue('Desktop')
    await form
      .findAll('button')
      .find((b) => b.text() === 'Read and change')!
      .trigger('click')
    await form.trigger('submit')
    await settle()
    expect(api.calls.filter((c) => c.method === 'POST' && c.path === '/tokens')).toEqual([
      expect.objectContaining({ body: { name: 'Desktop', scope: 'write' }, expectedUser: USER }),
    ])
    const shown = section().get('[data-testid="token-shown"]')
    const token = api.accounts.get(USER)!.tokens[0]!
    const plain = shown.get('[data-testid="token-plain"]').text()
    expect(plain).toMatch(new RegExp(`^trk_${token.prefix}`))
    expect(shown.text()).toContain('Copy your new token now. It won’t be shown again.')
    expect(shown.text()).toContain(`Authorization: Bearer ${plain.slice(0, 12)}…`)
    expect(document.activeElement).toBe(shown.element)
    await button('Copy', shown)!.trigger('click')
    await settle()
    expect(clipboard.writeText).toHaveBeenCalledWith(plain)
    expect(rows('tokens-list')[0]).toEqual([
      'Desktop',
      `trk_${token.prefix}… · Read and change · created today · never used`,
    ])
    await button('Done', shown)!.trigger('click')
    expect(section().find('[data-testid="token-shown"]').exists()).toBe(false)
    expect(section().text()).not.toContain(plain)
    expect(button('Create token')).toBeDefined()
  })

  it('asks for a name before creating', async () => {
    await openSettings()
    await button('Create token')!.trigger('click')
    await section().get('[data-testid="token-form"]').trigger('submit')
    await settle()
    expect(section().get('[data-testid="token-form"]').text()).toContain(
      'Give the token a name, like Laptop.',
    )
    expect(api.calls.filter((c) => c.method === 'POST' && c.path === '/tokens')).toEqual([])
  })

  it('says when the account has as many tokens as it may', async () => {
    await openSettings()
    api.maxTokens = 2
    await button('Create token')!.trigger('click')
    await section().get('[data-testid="token-form"] input').setValue('Desktop')
    await section().get('[data-testid="token-form"]').trigger('submit')
    await settle()
    expect(section().get('[data-testid="token-problem"]').text()).toBe(
      'You have 20 tokens, the most there can be. Remove one you don’t use, then create this one.',
    )
    expect(section().find('[data-testid="token-form"]').exists()).toBe(true)
  })

  it('cancels creating without a call', async () => {
    await openSettings()
    await button('Create token')!.trigger('click')
    await button('Cancel', section().get('[data-testid="token-form"]'))!.trigger('click')
    expect(section().find('[data-testid="token-form"]').exists()).toBe(false)
    expect(api.calls.filter((c) => c.method === 'POST')).toEqual([])
  })

  it('asks before removing a token, and the row goes', async () => {
    await openSettings()
    const remove = section()
      .get('[data-testid="tokens-list"]')
      .find('button[aria-label="Remove Laptop"]')
    await remove.trigger('click')
    await settle()
    expect(confirmation()!.get('h2').text()).toBe('Remove Laptop?')
    expect(confirmation()!.text()).toContain(
      'Anything using this token stops working at once. You can create a new one.',
    )
    await answer('Cancel')
    expect(api.paths('DELETE')).toEqual([])
    expect(rows('tokens-list')).toHaveLength(2)
    await remove.trigger('click')
    await settle()
    await answer('Remove')
    expect(api.paths('DELETE')).toEqual(['DELETE /tokens/Xq7mPa2L'])
    expect(rows('tokens-list').map((r) => r[0])).toEqual(['Weekly report script'])
  })

  it('asks before disconnecting an app, and the row goes', async () => {
    await openSettings()
    await section()
      .get('[data-testid="apps-list"]')
      .get('button[aria-label="Remove Claude Code"]')
      .trigger('click')
    await settle()
    expect(confirmation()!.get('h2').text()).toBe('Disconnect Claude Code?')
    await answer('Disconnect')
    expect(api.paths('DELETE')).toEqual(['DELETE /connections/g2'])
    expect(rows('apps-list').map((r) => r[0])).toEqual(['Claude · claude.ai'])
  })

  it('keeps the row, and says why, when the server can’t be reached', async () => {
    await openSettings()
    await section().get('button[aria-label="Remove Laptop"]').trigger('click')
    await settle()
    api.offline = true
    await answer('Remove')
    expect(confirmation()!.text()).toContain(
      'Can’t reach the server, so nothing was removed. Try again when you’re online.',
    )
    expect(rows('tokens-list')).toHaveLength(2)
  })

  it('shows a banner for an app connected just now, until dismissed', async () => {
    await openSettings()
    const banner = section().get('[data-testid="connection-banner"]')
    expect(banner.text()).toContain(
      'Claude was connected just now, with read and change. If that wasn’t you, remove it and change your password.',
    )
    await button('Dismiss', banner)!.trigger('click')
    expect(section().find('[data-testid="connection-banner"]').exists()).toBe(false)
    // "New" stays on the row; the banner stays away in this tab.
    expect(rows('apps-list')[0]![1]).toMatch(/^New · /)
    wrapper.unmount()
    await mountApp()
    expect(section().find('[data-testid="connection-banner"]').exists()).toBe(false)
  })

  it('shows the banner when the tab’s record of dismissed banners is unreadable', async () => {
    sessionStorage.setItem('tracker-connections-seen-v1', '{not json')
    await openSettings()
    expect(section().find('[data-testid="connection-banner"]').exists()).toBe(true)
  })

  it('removes the new app from its banner, asking first', async () => {
    await openSettings({ connections: [{ ...CLAUDE, scope: 'read' }], tokens: [] })
    const banner = section().get('[data-testid="connection-banner"]')
    expect(banner.text()).toContain('with read only.')
    await button('Remove', banner)!.trigger('click')
    await settle()
    expect(confirmation()!.get('h2').text()).toBe('Disconnect Claude?')
    await answer('Disconnect')
    expect(api.paths('DELETE')).toEqual(['DELETE /connections/g1'])
    expect(section().find('[data-testid="connection-banner"]').exists()).toBe(false)
    expect(section().text()).toContain('No apps are connected.')
  })

  it('says when the address can’t be copied, and says Copied for two seconds when it can', async () => {
    await openSettings()
    clipboard.writeText.mockRejectedValueOnce(new Error('denied'))
    await button('Copy')!.trigger('click')
    await settle()
    expect(section().get('[data-testid="copy-problem"]').text()).toBe(
      'Couldn’t copy. Select the text and copy it yourself.',
    )
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    await button('Copy')!.trigger('click')
    await flushPromises()
    expect(section().find('[data-testid="copy-problem"]').exists()).toBe(false)
    expect(section().get('[data-testid="copy-status"]').text()).toBe('Copied.')
    vi.advanceTimersByTime(2000)
    await flushPromises()
    expect(section().get('[data-testid="copy-status"]').text()).toBe('')
  })

  it('marks a name the server refuses, and says when the server fails', async () => {
    await openSettings()
    await button('Create token')!.trigger('click')
    const form = () => section().get('[data-testid="token-form"]')
    await form().get('input').setValue('Desktop')
    api.failNext('POST', '/tokens', 400, { error: 'token-name' })
    await form().trigger('submit')
    await settle()
    expect(form().text()).toContain('Use 1 to 64 characters, with no line breaks.')
    api.failNext('POST', '/tokens', 500)
    await form().trigger('submit')
    await settle()
    expect(section().get('[data-testid="token-problem"]').text()).toBe(
      'The server had a problem, so no token was created. Try again in a while.',
    )
  })

  it('takes the row away when another tab removed it first', async () => {
    await openSettings({ connections: [], tokens: [LAPTOP] })
    await section().get('button[aria-label="Remove Laptop"]').trigger('click')
    await settle()
    api.failNext('DELETE', `/tokens/${LAPTOP.prefix}`, 404, { error: 'no-token' })
    await answer('Remove')
    expect(confirmation()).toBeNull()
    expect(section().text()).toContain('No tokens yet.')
  })

  it('keeps the row when the server fails a removal', async () => {
    await openSettings()
    await section().get('button[aria-label="Remove Laptop"]').trigger('click')
    await settle()
    api.failNext('DELETE', `/tokens/${LAPTOP.prefix}`, 500)
    await answer('Remove')
    expect(confirmation()!.text()).toContain(
      'The server had a problem, so nothing was removed. Try again in a while.',
    )
    expect(rows('tokens-list')).toHaveLength(2)
  })

  it('says when the lists can’t be read, and tries again', async () => {
    history.replaceState(null, '', '/#/settings')
    api = signedIn()
    api.failNext('GET', '/tokens', 502)
    await mountApp()
    expect(section().get('[data-testid="connections-problem"]').text()).toBe(
      'Can’t reach the server, so your apps and tokens can’t be listed. Try again when you’re online.',
    )
    await button('Try again')!.trigger('click')
    await settle()
    expect(section().find('[data-testid="connections-problem"]').exists()).toBe(false)
    expect(section().text()).toContain('No tokens yet.')
  })
})
