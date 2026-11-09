import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import { ASK_COPY } from '@/lib/ask'
import { FOLDED } from '@/components/ui/side-panel'
import { useAskStore } from '@/stores/ask'
import { usePlannerStore } from '@/stores/planner'
import { SESSION_KEY, useSessionStore } from '@/stores/session'
import { ANSWER, PASSWORD, sse, type FakeApi } from '@/lib/__tests__/fakeApi'
import { USER, emptyState, signedIn } from '@/lib/__tests__/signedIn'

const NOW = new Date(2026, 10, 1, 9, 0)
const TODAY_S = Math.floor(NOW.getTime() / 1000)

let wrapper: VueWrapper
let api: FakeApi

/** Lets Reka's queued work and the fake API's replies settle. */
async function settle(): Promise<void> {
  await flushPromises()
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Mount the app signed in as alice, with Ask on unless `ask` says otherwise. */
async function mountApp({
  ask = true,
  goals,
  hash,
}: { ask?: boolean; goals?: string; hash?: string } = {}): Promise<VueWrapper> {
  if (hash) history.replaceState(null, '', `/${hash}`)
  const settings =
    goals === undefined ? null : { accent: '#30d158', dailyPick: 3, foodPick: 2, goals }
  api = signedIn({ ...emptyState(), settings })
  api.accounts.get(USER)!.settings = settings
  api.ask = ask
  const pinia = createPinia()
  setActivePinia(pinia)
  wrapper = mount(App, { global: { plugins: [pinia] }, attachTo: document.body })
  await settle()
  return wrapper
}

function askButton() {
  return wrapper.find('[data-testid="ask-button"]')
}

function page() {
  return wrapper.find('[data-testid="ask-page"]')
}

async function openAsk(): Promise<void> {
  await askButton().trigger('click')
  await settle()
}

async function backToWeek(): Promise<void> {
  location.hash = '#/'
  await settle()
}

function box() {
  return wrapper.get<HTMLTextAreaElement>('[data-testid="ask-question"]')
}

function send() {
  return wrapper.get<HTMLButtonElement>('[data-testid="ask-send"]')
}

function note(): string {
  return wrapper.get('[data-testid="ask-note"]').text()
}

function chip(): string {
  return wrapper.get('[data-testid="ask-quota"]').text()
}

async function ask(question: string): Promise<void> {
  await box().setValue(question)
  await wrapper.get('[data-testid="ask-form"]').trigger('submit')
  await settle()
}

function turns() {
  return wrapper.findAll('[data-slot="transcript-turn"]')
}

/** The open ConfirmDialog, by role; Reka renders it in a portal on document.body. */
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

function stubFolded(): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === FOLDED,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  localStorage.clear()
})

afterEach(() => {
  wrapper?.unmount()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  history.replaceState(null, '', '/')
})

describe('Ask in the bar', () => {
  it('shows only once the API says Ask is on, first of the actions, before Settings (K82)', async () => {
    await mountApp()
    const actions = wrapper
      .get('[data-slot="bar"]')
      .findAll('[data-slot="bar-action"]')
      .map((b) => b.text())
    expect(actions.slice(0, 2)).toEqual(['Ask', 'Settings'])
    expect(askButton().find('svg').exists()).toBe(true)
  })

  it('stays out of the bar while Ask is off', async () => {
    await mountApp({ ask: false })
    expect(askButton().exists()).toBe(false)
  })
})

describe('the Ask page', () => {
  it('opens at #/ask with no bar, its heading focused, and goes back with focus on Ask', async () => {
    await mountApp()
    await openAsk()
    expect(location.hash).toBe('#/ask')
    expect(page().exists()).toBe(true)
    expect(wrapper.find('[data-slot="bar"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="exercise-grid"]').exists()).toBe(false)
    const heading = page().get('h1')
    expect(heading.text()).toBe('Ask')
    expect(document.activeElement).toBe(heading.element)
    expect(page().get('a[href="#/"]').text()).toBe('Back to the week')
    expect(page().get('[data-slot="side-panel-panel"]').attributes('aria-label')).toBe(
      'Conversation history',
    )
    await backToWeek()
    expect(page().exists()).toBe(false)
    expect(document.activeElement).toBe(askButton().element)
  })

  it('falls back to the week at #/ask while Ask is off, and drops the address', async () => {
    await mountApp({ ask: false, hash: '#/ask' })
    expect(page().exists()).toBe(false)
    expect(wrapper.find('[data-testid="exercise-grid"]').exists()).toBe(true)
    expect(location.hash).toBe('')
  })

  it('waits on the week while the flag is unknown, and opens once it loads online', async () => {
    history.replaceState(null, '', '/#/ask')
    api = signedIn()
    api.ask = true
    api.failNext('GET', '/auth/options', 502)
    const pinia = createPinia()
    setActivePinia(pinia)
    wrapper = mount(App, { global: { plugins: [pinia] }, attachTo: document.body })
    await settle()
    expect(useSessionStore().ask).toBeNull()
    expect(page().exists()).toBe(false)
    expect(location.hash).toBe('#/ask')
    window.dispatchEvent(new Event('online'))
    await settle()
    expect(page().exists()).toBe(true)
  })

  it('goes back to the week when Ask is turned off while it is open', async () => {
    await mountApp({ hash: '#/ask' })
    api.ask = false
    await ask('Am I doing enough?')
    expect(page().exists()).toBe(false)
    expect(askButton().exists()).toBe(false)
    expect(location.hash).toBe('')
  })

  it('lands on sign-in when signed out on Ask, and the next sign-in finds nothing of it', async () => {
    await mountApp({ hash: '#/ask' })
    await ask('Am I doing enough?')
    expect(turns()).toHaveLength(1)
    // Another tab signs out.
    api.signedIn = null
    localStorage.removeItem(SESSION_KEY)
    await useSessionStore().onStorage(SESSION_KEY)
    await settle()
    expect(wrapper.find('form').text()).toContain('Sign in')
    expect(location.hash).toBe('')
    expect(useAskStore().turns).toEqual([])
    await useSessionStore().login(USER, PASSWORD)
    await settle()
    expect(wrapper.find('[data-testid="exercise-grid"]').exists()).toBe(true)
    location.hash = '#/ask'
    await settle()
    expect(turns()).toHaveLength(0)
  })

  it('starts empty: what it reads, three questions to start from, the box, the chip and the note', async () => {
    await mountApp({ goals: 'Ten pull-ups in a row by March.', hash: '#/ask' })
    const empty = wrapper.get('[data-testid="ask-empty"]')
    expect(empty.text()).toContain(
      'Ask about your exercises, cardio and food: whether you’re doing enough for your goals, how steady the weeks are, what to change. The answer reads your plans and marks for the last eight weeks, and your goals in Settings.',
    )
    expect(empty.text()).not.toContain('Add your goals')
    expect(empty.findAll('button').map((b) => b.text())).toEqual([
      'Am I doing too much or too little?',
      'Is my diet good enough?',
      'How steady was this month?',
    ])
    expect(wrapper.get('label[for]').text()).toBe('Your question')
    expect(send().text()).toBe('Send')
    expect(chip()).toBe('30 questions left today')
    expect(note()).toBe(ASK_COPY.note)
    // A start question asks at once.
    await empty.findAll('button')[1]!.trigger('click')
    await settle()
    expect(turns()).toHaveLength(1)
    expect(turns()[0]!.text()).toContain('Is my diet good enough?')
    expect(wrapper.find('[data-testid="ask-empty"]').exists()).toBe(false)
  })

  it('names the box without an "Ask" beside it, and reads its intro at a normal measure (K83)', async () => {
    await mountApp({ hash: '#/ask' })
    const form = wrapper.get('[data-testid="ask-form"]')
    expect(form.attributes('aria-label')).toBe('Ask')
    expect(form.attributes('aria-labelledby')).toBeUndefined()
    expect(form.findAll('p').map((p) => p.text())).not.toContain('Ask')
    // The intro's measure is in its own text size, so 72ch is 72 of its characters.
    const intro = wrapper.get('[data-testid="ask-empty"]')
    expect(intro.classes()).toEqual(
      expect.arrayContaining(['max-w-[72ch]', 'text-(length:--set-text)']),
    )
  })

  it('offers Document and Conversation, Document first, and the device remembers the view (K84)', async () => {
    await mountApp({ hash: '#/ask' })
    const view = () => wrapper.get('[data-slot="transcript"]').attributes('data-view')
    const control = wrapper.get('[data-testid="ask-view"]')
    expect(control.get('[role="group"]').attributes('aria-label')).toBe('View')
    const segments = () => control.findAll('button')
    expect(segments().map((b) => b.text())).toEqual(['Document', 'Conversation'])
    expect(segments()[0]!.attributes('aria-pressed')).toBe('true')
    expect(view()).toBe('document')
    expect(page().attributes('data-view')).toBe('document')
    await segments()[1]!.trigger('click')
    await settle()
    expect(view()).toBe('conversation')
    expect(page().attributes('data-view')).toBe('conversation')
    expect(localStorage.getItem('tracker-ask-view-v1')).toBe('"conversation"')
    // Back to the week and to Ask again: still Conversation.
    await backToWeek()
    await openAsk()
    expect(view()).toBe('conversation')
    // A stored value it doesn't know falls back to Document.
    wrapper.unmount()
    localStorage.setItem('tracker-ask-view-v1', '"sideways"')
    await mountApp({ hash: '#/ask' })
    expect(view()).toBe('document')
    // So does one that isn't JSON at all.
    wrapper.unmount()
    localStorage.setItem('tracker-ask-view-v1', 'conversation')
    await mountApp({ hash: '#/ask' })
    expect(view()).toBe('document')
  })

  it('says when there are no goals yet, and links to them', async () => {
    await mountApp({ goals: '', hash: '#/ask' })
    const empty = wrapper.get('[data-testid="ask-empty"]')
    expect(empty.text()).toContain('for the last eight weeks.')
    expect(empty.text()).toContain(
      'Your goals in Settings are empty, so answers can only compare you with the times a week you set.',
    )
    expect(empty.get('a').text()).toBe('Add your goals')
    expect(empty.get('a').attributes('href')).toBe('#/settings')
  })

  it('says so on a new account too, which has no settings saved at all', async () => {
    await mountApp({ hash: '#/ask' })
    expect(usePlannerStore().goalsKnown).toBe(false)
    expect(wrapper.get('[data-testid="ask-empty"]').text()).toContain('Add your goals')
  })

  it('streams an answer into the conversation, then counts the question', async () => {
    await mountApp({ hash: '#/ask' })
    await ask('Am I doing enough?')
    expect(box().element.value).toBe('')
    expect(turns()).toHaveLength(1)
    expect(turns()[0]!.get('[data-slot="transcript-question"]').text()).toBe('Am I doing enough?')
    expect(turns()[0]!.get('[data-slot="transcript-answer"]').text()).toBe(ANSWER)
    expect(chip()).toBe('29 questions left today')
    // The new conversation joins the history, open.
    const open = wrapper.get('[data-slot="history-open"][aria-current="true"]')
    expect(open.text()).toBe('Am I doing enough?')
  })

  it('sends on Return in the box; Shift+Return and a Return that ends a composition do not', async () => {
    await mountApp({ hash: '#/ask' })
    await box().setValue('Am I doing enough?')
    const shifted = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true })
    box().element.dispatchEvent(shifted)
    const composing = new KeyboardEvent('keydown', {
      key: 'Enter',
      isComposing: true,
      cancelable: true,
    })
    box().element.dispatchEvent(composing)
    await settle()
    // Both leave the textarea to do its own thing: a new line, or the IME's pick.
    expect(shifted.defaultPrevented).toBe(false)
    expect(composing.defaultPrevented).toBe(false)
    expect(turns()).toHaveLength(0)
    expect(box().element.value).toBe('Am I doing enough?')

    const plain = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    box().element.dispatchEvent(plain)
    await settle()
    expect(plain.defaultPrevented).toBe(true)
    expect(box().element.value).toBe('')
    expect(turns()).toHaveLength(1)
    expect(turns()[0]!.get('[data-slot="transcript-question"]').text()).toBe('Am I doing enough?')
  })

  it('ignores Return while an answer is being written, keeping the next draft', async () => {
    await mountApp({ hash: '#/ask' })
    const control = api.streamNext()
    await box().setValue('Is my diet good enough?')
    void wrapper.get('[data-testid="ask-form"]').trigger('submit')
    await settle()
    control.push(sse('start', { remaining: 29, conversation: 'c5' }))
    await settle()
    await box().setValue('And my sleep?')
    const plain = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    box().element.dispatchEvent(plain)
    await settle()
    expect(plain.defaultPrevented).toBe(true)
    expect(send().text()).toBe('Stop')
    expect(box().element.value).toBe('And my sleep?')
    expect(turns()).toHaveLength(1)
    await send().trigger('click')
    await settle()
  })

  it('turns Send into Stop while answering, and Stop keeps what came', async () => {
    await mountApp({ hash: '#/ask' })
    const control = api.streamNext()
    await box().setValue('Is my diet good enough?')
    void wrapper.get('[data-testid="ask-form"]').trigger('submit')
    await settle()
    control.push(sse('start', { remaining: 29, conversation: 'c5' }))
    await settle()
    expect(send().text()).toBe('Stop')
    // AnswerProgress until the first words.
    expect(wrapper.find('[data-slot="answer-progress"]').exists()).toBe(true)
    control.push(sse('text', { delta: 'Fruit and nuts are on track.' }))
    await settle()
    await new Promise((r) => requestAnimationFrame(r))
    await nextTick()
    expect(turns()[0]!.text()).toContain('Fruit and nuts are on track.')
    await send().trigger('click')
    await settle()
    expect(send().text()).toBe('Send')
    expect(turns()[0]!.text()).toContain(ASK_COPY.stopped)
    expect(control.cancelled()).toBe(true)
  })

  it('says what happened when an answer fails, and asks again on Try again', async () => {
    await mountApp({ hash: '#/ask' })
    api.answerNext([sse('error', { error: 'busy' })])
    await ask('Am I doing enough?')
    expect(turns()[0]!.get('[role="alert"]').text()).toBe(ASK_COPY.busy)
    await turns()[0]!
      .findAll('button')
      .find((b) => b.text() === 'Try again')!
      .trigger('click')
    await settle()
    expect(turns()).toHaveLength(1)
    expect(turns()[0]!.text()).toContain(ANSWER)
  })

  it('turns the box off when no questions are left, and says when it opens again', async () => {
    await mountApp({ hash: '#/ask' })
    api.askRemaining = 0
    await useAskStore().loadQuota()
    await settle()
    expect(chip()).toBe('No questions left today')
    expect(box().element.disabled).toBe(true)
    expect(send().element.disabled).toBe(true)
    expect(note()).toBe('You can ask again within 24 hours.')
    // The time is known once a question was refused for it.
    api.askRemaining = 0
    api.askRetryAfter = 30 * 60
    const store = useAskStore()
    store.remaining = 1
    await nextTick()
    await ask('One more?')
    expect(note()).toBe('You can ask again from 09:30 today.')
    expect(box().element.value).toBe('One more?')
  })

  it('turns the box off offline, keeping the conversation, until the connection is back', async () => {
    await mountApp({ hash: '#/ask' })
    await ask('Am I doing enough?')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    window.dispatchEvent(new Event('offline'))
    await settle()
    expect(wrapper.get('[data-testid="ask-offline"]').text()).toBe(ASK_COPY.offline)
    expect(box().element.disabled).toBe(true)
    expect(turns()).toHaveLength(1)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    await settle()
    expect(wrapper.find('[data-testid="ask-offline"]').exists()).toBe(false)
    expect(box().element.disabled).toBe(false)
  })

  it('says when changes on this device weren’t in the answer (F11)', async () => {
    await mountApp({ hash: '#/ask' })
    api.failNext('PUT', '/ticks', 502)
    usePlannerStore().toggle('pu', 0)
    await nextTick()
    await ask('Did I train today?')
    expect(note()).toBe(
      'One change on this device isn’t synced yet, so the answer won’t include it.',
    )
  })

  it('says when a full account kept nothing', async () => {
    await mountApp({ hash: '#/ask' })
    api.answerNext([
      sse('text', { delta: 'Yes.' }),
      sse('done', { stop: 'end_turn', saved: false }),
    ])
    await ask('Am I doing enough?')
    expect(wrapper.get('[data-testid="ask-notice"]').text()).toBe(ASK_COPY.notSaved)
  })
})

describe('the history panel', () => {
  const day = 24 * 3600
  const turn = { question: 'Is my diet good enough?', answer: 'Mostly.', stop: 'end_turn' as const }

  async function withHistory(): Promise<void> {
    await mountApp({ hash: '#/ask' })
    api.addConversation(USER, {
      id: 'old',
      title: 'Should I add a rest day?',
      updatedAt: TODAY_S - 20 * day,
    })
    api.addConversation(USER, {
      id: 'week',
      title: 'How steady was October?',
      updatedAt: TODAY_S - 3 * day,
    })
    api.addConversation(USER, {
      id: 'today',
      title: 'Is my diet good enough?',
      updatedAt: TODAY_S - 60,
      turns: [{ ...turn, askedAt: TODAY_S - 60 }],
    })
    await useAskStore().loadList()
    await settle()
  }

  function items() {
    return wrapper.findAll('[data-slot="history-open"]')
  }

  it('lists past conversations by Today, Last week and Earlier, and opens one', async () => {
    await withHistory()
    expect(wrapper.findAll('[data-slot="history-list"] h3').map((h) => h.text())).toEqual([
      'Today',
      'Last week',
      'Earlier',
    ])
    await items()[0]!.trigger('click')
    await settle()
    expect(turns()).toHaveLength(1)
    expect(turns()[0]!.text()).toContain('Mostly.')
    expect(items()[0]!.attributes('aria-current')).toBe('true')
    // New conversation empties the page again.
    await wrapper
      .get('[data-slot="history-list"]')
      .findAll('button')
      .find((b) => b.text() === 'New conversation')!
      .trigger('click')
    await settle()
    expect(turns()).toHaveLength(0)
    expect(wrapper.find('[data-testid="ask-empty"]').exists()).toBe(true)
  })

  it('asks before deleting one; Cancel returns focus to its bin, Delete to the next one', async () => {
    await withHistory()
    const bin = () => wrapper.get<HTMLButtonElement>('[data-history-delete="today"]')
    bin().element.focus()
    await bin().trigger('click')
    await settle()
    expect(confirmation()!.get('h2').text()).toBe('Delete “Is my diet good enough?”?')
    await answer('Cancel')
    await new Promise((r) => setTimeout(r, 0))
    expect(document.activeElement).toBe(bin().element)
    await bin().trigger('click')
    await settle()
    await answer('Delete')
    await new Promise((r) => setTimeout(r, 0))
    expect(api.paths('DELETE')).toEqual(['DELETE /ask/conversations/today'])
    expect(items().map((i) => i.text())).toEqual([
      'How steady was October?',
      'Should I add a rest day?',
    ])
    expect(document.activeElement).toBe(wrapper.get('[data-history-delete="week"]').element)
    // The last one has none after it: focus goes to New conversation.
    await wrapper.get('[data-history-delete="old"]').trigger('click')
    await settle()
    await answer('Delete')
    await new Promise((r) => setTimeout(r, 0))
    expect(document.activeElement!.textContent).toContain('New conversation')
  })

  it('keeps the question open with the reason when a delete fails', async () => {
    await withHistory()
    await wrapper.get('[data-history-delete="today"]').trigger('click')
    await settle()
    api.offline = true
    await answer('Delete')
    expect(confirmation()!.get('[role="alert"]').text()).toBe(ASK_COPY.deleteOffline)
    api.offline = false
    await answer('Cancel')
  })

  it('deletes all conversations after asking, focus going to New conversation', async () => {
    await withHistory()
    const all = wrapper.get<HTMLButtonElement>('[data-slot="history-foot"] button')
    all.element.focus()
    await all.trigger('click')
    await settle()
    expect(confirmation()!.get('h2').text()).toBe('Delete all conversations?')
    // Cancel goes back to the button that asked.
    await answer('Cancel')
    await new Promise((r) => setTimeout(r, 0))
    expect(document.activeElement).toBe(all.element)
    await all.trigger('click')
    await settle()
    await answer('Delete all')
    await new Promise((r) => setTimeout(r, 0))
    expect(api.paths('DELETE')).toEqual(['DELETE /ask/conversations'])
    expect(items()).toHaveLength(0)
    expect(document.activeElement!.textContent).toContain('New conversation')
    expect(wrapper.find('[data-slot="history-empty"]').text()).toBe('Past conversations show here.')
  })

  it('hides to a strip with New conversation, and the device remembers it', async () => {
    await withHistory()
    await items()[0]!.trigger('click')
    await settle()
    await wrapper.get('button[aria-label="Hide history"]').trigger('click')
    await settle()
    const strip = wrapper.get('[data-slot="side-panel-strip"]')
    expect(localStorage.getItem('tracker-ask-panel-v1')).toBe('false')
    await strip.get('button[aria-label="New conversation"]').trigger('click')
    await settle()
    expect(turns()).toHaveLength(0)
  })

  it('on a phone, opens as a drawer from beside Back to the week, and closes on a pick', async () => {
    stubFolded()
    await withHistory()
    const toggle = wrapper.get('[data-testid="ask-panel-toggle"]')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    await settle()
    const drawer = document.querySelector<HTMLElement>('[data-slot="side-panel-drawer"]')!
    expect(drawer).not.toBeNull()
    drawer.querySelector<HTMLButtonElement>('[data-slot="history-open"]')!.click()
    await settle()
    expect(document.querySelector('[data-slot="side-panel-drawer"]')).toBeNull()
    expect(turns()).toHaveLength(1)
  })
})
