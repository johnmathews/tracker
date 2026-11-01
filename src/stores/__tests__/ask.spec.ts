import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ASK_COPY } from '@/lib/ask'
import { useAskStore } from '@/stores/ask'
import { SESSION_KEY, useSessionStore } from '@/stores/session'
import { useSyncStore } from '@/stores/sync'
import { usePlannerStore } from '@/stores/planner'
import { ANSWER, sse, type FakeApi } from '@/lib/__tests__/fakeApi'
import { USER, signedIn } from '@/lib/__tests__/signedIn'

/** Just after midnight on 1 November, local time: the UTC date is still 31 October here. */
const NOW = new Date(2026, 10, 1, 0, 30)
const SECONDS = Math.floor(NOW.getTime() / 1000)

let api: FakeApi

async function start() {
  api = signedIn()
  api.ask = true
  const session = useSessionStore()
  await session.init()
  await flushPromises()
  return { session, ask: useAskStore(), sync: useSyncStore() }
}

/** The body of the last question sent. */
function lastQuestion(): Record<string, unknown> {
  return api.calls.filter((c) => c.method === 'POST' && c.path === '/ask').at(-1)!.body as Record<
    string,
    unknown
  >
}

const turn = { question: 'Is my diet good enough?', answer: 'Mostly.', stop: 'end_turn' as const }

describe('the ask store', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    useSyncStore().stop()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads the questions left and the history, the one updated last first', async () => {
    const { ask } = await start()
    api.askRemaining = 27
    api.addConversation(USER, { id: 'old', title: 'Old', updatedAt: 10 })
    api.addConversation(USER, { id: 'new', title: 'New', updatedAt: 20 })
    await ask.loadQuota()
    await ask.loadList()
    expect([ask.remaining, ask.limit]).toEqual([27, 30])
    expect(ask.conversations).toEqual([
      { id: 'new', title: 'New', updatedAt: 20 },
      { id: 'old', title: 'Old', updatedAt: 10 },
    ])
    expect(api.calls.find((c) => c.path === '/ask')!.expectedUser).toBe(USER)
  })

  it('asks with the local date and no conversation, streams the answer, then lists it', async () => {
    const { ask } = await start()
    ask.draft = '  Am I doing enough?  '
    await ask.ask()
    expect(lastQuestion()).toEqual({ question: 'Am I doing enough?', today: '2026-11-01' })
    expect(api.calls.find((c) => c.path === '/ask')!.expectedUser).toBe(USER)
    expect(ask.draft).toBe('')
    expect(ask.turns).toEqual([
      { id: expect.any(Number), question: 'Am I doing enough?', answer: ANSWER, state: 'done' },
    ])
    expect(ask.conversationId).toBe('c1')
    expect(ask.remaining).toBe(29)
    expect(ask.status).toBe('idle')
    expect(ask.conversations.map((c) => c.id)).toEqual(['c1'])

    ask.draft = 'And my diet?'
    await ask.ask()
    expect(lastQuestion()).toEqual({
      question: 'And my diet?',
      today: '2026-11-01',
      conversation: 'c1',
    })
    expect(ask.turns).toHaveLength(2)
  })

  it('ignores a blank question, and another while one is being answered', async () => {
    const { ask } = await start()
    ask.draft = '   '
    await ask.ask()
    const control = api.streamNext()
    const first = ask.ask('One')
    await vi.waitFor(() => expect(api.paths('POST /ask')).toHaveLength(1))
    await ask.ask('Two')
    expect(api.paths('POST /ask')).toHaveLength(1)
    control.push(sse('done', { stop: 'end_turn', saved: true }))
    await first
  })

  it('sends this device’s changes first, and notes the ones that couldn’t go (F11)', async () => {
    const { ask } = await start()
    const planner = usePlannerStore()
    planner.toggle('pu', 0)
    // The sync store's watcher queues the mark before anyone can press Send.
    await nextTick()
    await ask.ask('Did I train today?')
    const order = api.paths().filter((p) => !p.startsWith('GET'))
    expect(order.slice(-2)).toEqual([expect.stringMatching(/^PUT \/ticks\//), 'POST /ask'])
    expect(ask.unsynced).toBe(0)

    // The next mark can't reach the server: the question still goes, and says so.
    api.failNext('PUT', '/ticks', 502)
    planner.toggle('pu', 1)
    await nextTick()
    await ask.ask('And now?')
    expect(ask.unsynced).toBe(1)
    ask.newConversation()
    expect(ask.unsynced).toBe(0)
  })

  it('draws the answer at most once per animation frame', async () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', vi.fn<(id: number) => void>())
    const { ask } = await start()
    const control = api.streamNext()
    const asking = ask.ask('Is my diet good enough?')
    control.push(sse('start', { remaining: 29, conversation: 'c7' }))
    control.push(sse('text', { delta: 'Fruit and ' }))
    control.push(sse('text', { delta: 'nuts are ' }))
    await vi.waitFor(() => expect(frames).toHaveLength(1))
    expect(ask.turns[0]!.answer).toBe('')
    expect(ask.turns[0]!.state).toBe('streaming')
    frames.shift()!(0)
    expect(ask.turns[0]!.answer).toBe('Fruit and nuts are ')
    control.push(sse('text', { delta: 'on track.' }))
    await vi.waitFor(() => expect(frames).toHaveLength(1))
    // The last words come with `done`, whether or not their frame has run.
    control.push(sse('done', { stop: 'end_turn', saved: true }))
    await asking
    expect(ask.turns[0]).toMatchObject({ answer: 'Fruit and nuts are on track.', state: 'done' })
    expect(cancelAnimationFrame).toHaveBeenCalled()
  })

  it('stops on Stop, keeping what had arrived, and closes the stream', async () => {
    const { ask } = await start()
    const control = api.streamNext()
    const asking = ask.ask('Is my diet good enough?')
    control.push(sse('start', { remaining: 29, conversation: 'c7' }))
    control.push(sse('text', { delta: 'Fruit and nuts' }))
    await vi.waitFor(() => expect(ask.conversationId).toBe('c7'))
    await new Promise((r) => requestAnimationFrame(r))
    ask.stop()
    await asking
    expect(ask.turns[0]).toMatchObject({
      answer: 'Fruit and nuts',
      state: 'stopped',
      message: ASK_COPY.stopped,
    })
    expect(control.cancelled()).toBe(true)
    expect(ask.status).toBe('idle')
  })

  it('calls a stream that ends without done or error a failure (W5 C3)', async () => {
    const { ask } = await start()
    api.answerNext([sse('start', { conversation: 'c7' }), sse('text', { delta: 'Fruit' })])
    await ask.ask('Q')
    expect(ask.turns[0]).toMatchObject({ answer: 'Fruit', state: 'error', message: ASK_COPY.cut })
    // A start with no count leaves the count as it was.
    expect(ask.remaining).toBeNull()
  })

  it.each([
    ['busy', ASK_COPY.busy],
    ['error', ASK_COPY.failed],
  ])('says what happened when the answer fails with %s', async (code, message) => {
    const { ask } = await start()
    api.answerNext([sse('text', { delta: 'Fruit' }), sse('error', { error: code })])
    await ask.ask('Q')
    expect(ask.turns[0]).toMatchObject({ answer: 'Fruit', state: 'error', message })
  })

  it('discards a refused answer’s text, and notes one cut short', async () => {
    const { ask } = await start()
    api.answerNext([sse('text', { delta: 'Part' }), sse('done', { stop: 'refused', saved: true })])
    await ask.ask('Q')
    expect(ask.turns[0]).toMatchObject({
      answer: '',
      state: 'stopped',
      message: ASK_COPY.refused,
    })
    api.answerNext([sse('text', { delta: 'Long' }), sse('done', { stop: 'max_tokens' })])
    await ask.ask('Q2')
    expect(ask.turns[1]).toMatchObject({ answer: 'Long', state: 'stopped', message: ASK_COPY.long })
  })

  it('says when a full account kept nothing, and starts afresh after a new one’s first turn', async () => {
    const { ask } = await start()
    api.answerNext([
      sse('start', { remaining: 29, conversation: 'lost' }),
      sse('text', { delta: 'Yes.' }),
      sse('done', { stop: 'end_turn', saved: false }),
    ])
    await ask.ask('Q')
    expect(ask.notice).toBe(ASK_COPY.notSaved)
    expect(ask.conversationId).toBeNull()
    await ask.ask('Q2')
    expect('conversation' in lastQuestion()).toBe(false)
    expect(ask.notice).toBeNull()

    // In a kept conversation, a later turn that isn't saved leaves the conversation as it is.
    api.answerNext([sse('done', { stop: 'end_turn', saved: false })])
    await ask.ask('Q3')
    expect(ask.conversationId).toBe('c1')
  })

  it('puts the question back and says when asking opens again, after 429 (cap reached)', async () => {
    const { ask } = await start()
    api.askRemaining = 0
    api.askRetryAfter = 3600
    ask.draft = 'One more?'
    await ask.ask()
    expect(ask.turns).toEqual([])
    expect(ask.draft).toBe('One more?')
    expect(ask.remaining).toBe(0)
    expect(ask.capped).toBe(true)
    expect(ask.openAt).toBe(NOW.getTime() + 3600_000)
    // The count alone keeps the time; a count above none again clears it.
    await ask.loadQuota()
    expect(ask.openAt).toBe(NOW.getTime() + 3600_000)
    api.askRemaining = 1
    await ask.loadQuota()
    expect(ask.openAt).toBeNull()
    expect(ask.capped).toBe(false)
    // A 429 with no time, as from a proxy's own limit, says none.
    api.failNext('POST', '/ask', 429, { error: 'too-many' })
    await ask.ask()
    expect(ask.openAt).toBeNull()
  })

  it('turns Ask off when the API says so (503 ask-off)', async () => {
    const { ask, session } = await start()
    expect(session.ask).toBe(true)
    api.ask = false
    ask.draft = 'Q'
    await ask.ask()
    expect(session.ask).toBe(false)
    expect(ask.turns).toEqual([])
    expect(ask.draft).toBe('Q')
    session.ask = true
    await ask.loadQuota()
    expect(session.ask).toBe(false)
  })

  it('drops a conversation that was deleted elsewhere and starts a new one (404)', async () => {
    const { ask } = await start()
    api.addConversation(USER, { id: 'gone', title: 'Gone', turns: [{ ...turn, askedAt: 1 }] })
    await ask.loadList()
    await ask.open('gone')
    expect(ask.conversationId).toBe('gone')
    api.accounts.get(USER)!.conversations = []
    ask.draft = 'Still there?'
    await ask.ask()
    expect(ask.conversations).toEqual([])
    expect(ask.conversationId).toBeNull()
    expect(ask.turns).toEqual([])
    expect(ask.draft).toBe('Still there?')
    expect(ask.notice).toBe(ASK_COPY.gone)

    // Try again in a conversation deleted meanwhile leaves the box as it is.
    api.addConversation(USER, { id: 'again' })
    await ask.open('again')
    api.answerNext([sse('error', { error: 'busy' })])
    ask.draft = ''
    await ask.ask('Q')
    api.accounts.get(USER)!.conversations = []
    await ask.retry(0)
    expect(ask.draft).toBe('')
    expect(ask.notice).toBe(ASK_COPY.gone)
  })

  it('opens a kept conversation, and drops one that has gone', async () => {
    const { ask } = await start()
    api.addConversation(USER, {
      id: 'k',
      turns: [
        { ...turn, askedAt: 1 },
        { question: 'Why?', answer: '', stop: 'cancelled', askedAt: 2 },
      ],
    })
    api.addConversation(USER, { id: 'gone', title: 'Gone' })
    await ask.loadList()
    await ask.open('k')
    expect(ask.conversationId).toBe('k')
    expect(ask.turns.map((t) => [t.question, t.state])).toEqual([
      ['Is my diet good enough?', 'done'],
      ['Why?', 'stopped'],
    ])
    api.accounts.get(USER)!.conversations.shift()
    await ask.open('gone')
    expect(ask.conversations.map((c) => c.id)).toEqual(['k'])
    expect(ask.conversationId).toBeNull()
    expect(ask.notice).toBe(ASK_COPY.gone)

    // Left for a new conversation before it arrived, it doesn't take the page back.
    const go = api.holdNext('GET', '/ask/conversations/k')
    const opening = ask.open('k')
    ask.newConversation()
    go()
    await opening
    expect(ask.turns).toEqual([])
    expect(ask.conversationId).toBeNull()
  })

  it('says so when a conversation can’t be opened', async () => {
    const { ask } = await start()
    api.addConversation(USER, { id: 'k', turns: [{ ...turn, askedAt: 1 }] })
    api.offline = true
    await ask.open('k')
    expect(ask.offline).toBe(true)
    expect(ask.conversationId).toBeNull()
    expect(ask.notice).toBe(ASK_COPY.openFailed)
    // Not a conversation at all, as from a damaged reply.
    api.offline = false
    api.failNext('GET', '/ask/conversations/k', 200, { id: 'k' })
    await ask.open('k')
    expect(ask.notice).toBe(ASK_COPY.openFailed)
    expect(ask.offline).toBe(false)
  })

  it('deletes one conversation and then all of them', async () => {
    const { ask } = await start()
    api.addConversation(USER, { id: 'a', turns: [{ ...turn, askedAt: 1 }] })
    api.addConversation(USER, { id: 'b' })
    api.addConversation(USER, { id: 'c' })
    await ask.loadList()
    await ask.open('a')
    expect(await ask.remove('a')).toBeNull()
    expect(api.paths('DELETE')).toEqual(['DELETE /ask/conversations/a'])
    expect(ask.conversations.map((c) => c.id)).toEqual(['c', 'b'])
    // The open one went, so the page starts a new conversation.
    expect(ask.conversationId).toBeNull()
    expect(ask.turns).toEqual([])
    // One already gone elsewhere just leaves the list.
    api.accounts.get(USER)!.conversations.shift()
    expect(await ask.remove('c')).toBeNull()
    expect(ask.conversations.map((c) => c.id)).toEqual(['b'])
    expect(await ask.removeAll()).toBeNull()
    expect(ask.conversations).toEqual([])
    expect(api.accounts.get(USER)!.conversations).toEqual([])
  })

  it('says why a delete didn’t happen', async () => {
    const { ask } = await start()
    api.addConversation(USER, { id: 'a' })
    await ask.loadList()
    api.offline = true
    expect(await ask.remove('a')).toBe(ASK_COPY.deleteOffline)
    expect(await ask.removeAll()).toBe(ASK_COPY.deleteOffline)
    api.offline = false
    api.failNext('DELETE', '/ask/conversations', 500)
    expect(await ask.removeAll()).toBe(ASK_COPY.deleteFailed)
    expect(ask.conversations).toHaveLength(1)
  })

  it('puts the question back when offline, until the server answers again', async () => {
    const { ask } = await start()
    api.offline = true
    ask.draft = 'Q'
    await ask.ask()
    expect(ask.turns).toEqual([])
    expect(ask.draft).toBe('Q')
    // Asked from elsewhere than the box (Try again), the box is left as it is.
    ask.draft = ''
    await ask.ask('Again')
    expect(ask.draft).toBe('')
    expect(ask.offline).toBe(true)
    await ask.loadList()
    expect(ask.offline).toBe(true)
    api.offline = false
    await ask.loadList()
    expect(ask.offline).toBe(false)
  })

  it('says when the server failed or refused the question before answering', async () => {
    const { ask } = await start()
    api.failNext('POST', '/ask', 500)
    await ask.ask('Q')
    expect(ask.turns[0]).toMatchObject({ state: 'error', message: ASK_COPY.server })
    api.failNext('POST', '/ask', 400, { error: 'invalid' })
    await ask.ask('Q')
    expect(ask.turns[1]).toMatchObject({ state: 'error', message: ASK_COPY.rejected })
  })

  it('asks a failed question again on Try again, in place of the failed turn', async () => {
    const { ask } = await start()
    api.answerNext([sse('error', { error: 'busy' })])
    await ask.ask('Q')
    ask.draft = 'Typed meanwhile'
    await ask.retry(0)
    expect(ask.turns.map((t) => t.state)).toEqual(['done'])
    expect(ask.draft).toBe('Typed meanwhile')
    await ask.retry(5)
    expect(ask.turns).toHaveLength(1)
  })

  it('signs out when the session has ended', async () => {
    const { ask, session } = await start()
    api.signedIn = null
    await ask.ask('Q')
    await flushPromises()
    expect(session.status).toBe('signed-out')
    expect(ask.turns).toEqual([])
  })

  it('forgets everything on sign-out and when another user signs in', async () => {
    const { ask, session } = await start()
    await ask.loadQuota()
    await ask.ask('Q')
    ask.draft = 'Half typed'
    await session.logout()
    expect(ask.turns).toEqual([])
    expect(ask.conversations).toEqual([])
    expect([ask.remaining, ask.conversationId, ask.draft]).toEqual([null, null, ''])
    // Nobody is signed in now: a call names no user, and the server refuses it.
    await ask.loadQuota()
    expect(api.calls.at(-1)!.expectedUser).toBe('')
    expect(ask.remaining).toBeNull()

    // Another tab signs in as someone else.
    await session.login(USER, 'correct horse battery')
    await ask.ask('Mine')
    api.addUser('bob')
    api.signedIn = 'bob'
    localStorage.setItem(SESSION_KEY, JSON.stringify({ user: 'bob' }))
    await session.onStorage(SESSION_KEY)
    expect(ask.turns).toEqual([])
  })

  it('drops an answer still streaming when the page moves to another conversation', async () => {
    const { ask } = await start()
    const control = api.streamNext()
    const asking = ask.ask('Q')
    control.push(sse('start', { remaining: 29, conversation: 'c7' }))
    await vi.waitFor(() => expect(ask.conversationId).toBe('c7'))
    ask.newConversation()
    await asking
    expect(control.cancelled()).toBe(true)
    expect(ask.turns).toEqual([])
    expect(ask.conversationId).toBeNull()
    expect(ask.status).toBe('idle')
    // A question asked while its changes were still being sent, then left.
    const held = api.holdNext('PUT', '/ticks')
    usePlannerStore().toggle('pu', 0)
    const later = ask.ask('Q2')
    ask.newConversation()
    held()
    await later
    expect(api.paths('POST /ask')).toHaveLength(1)
    expect(SECONDS).toBeGreaterThan(0)
  })
})
