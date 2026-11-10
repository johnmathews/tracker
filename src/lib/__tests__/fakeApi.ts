/**
 * An in-memory stand-in for the API (docs/api.md), installed as `fetch` in tests. It keeps the
 * rules the client depends on: plan and details revisions with 409s, identical writes on a stale
 * revision succeeding, single-day ticks, settings, sessions, invite links, with `mail` on email
 * confirmation and reset requests, and with `ask` on Ask's questions, caps and conversation
 * history (§3.2). Controls let a test go offline, fail a request, hold replies back to provoke
 * races, and script or drive an answer's stream. It also keeps personal tokens, connected apps and
 * pending OAuth requests (Settings › Connections and the consent screen).
 */
import {
  normaliseDetails,
  normaliseGoals,
  normaliseLimits,
  normalisePortableSettings,
  type Conversation,
  type Days,
  type ItemDetails,
  type PortableSettings,
} from '@/lib/storage'
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  mergeConversations,
  mergeSettings,
  mergeSummary,
  parseExport,
} from '@/lib/transfer'
import type { Section } from '@/lib/trackerTypes'

type Plan = { items: unknown[]; rev: number }
/** An item's stored details: `{}` once cleared, which still holds its revision. */
type Details = { doc: ItemDetails; rev: number }
type Settings = PortableSettings

export type Account = {
  password: string
  plans: Record<Section, Record<string, Plan>>
  details: Record<Section, Record<string, Details>>
  /** Week → item → a 7-bit mask of its marked days, Monday in bit 0, as the API's `days`. */
  ticks: Record<Section, Record<string, Record<string, number>>>
  /** The marked days that are partial, and those missed, as the API's `partial` and `missed`. */
  partial: Record<Section, Record<string, Record<string, number>>>
  missed: Record<Section, Record<string, Record<string, number>>>
  settings: Settings | null
  /** Ask's history, the one updated last first, as `GET /api/ask/conversations` lists it. */
  conversations: Conversation[]
  /** Personal tokens, newest first, and the apps connected by OAuth (Settings › Connections). */
  tokens: FakeToken[]
  connections: FakeConnection[]
}

/** A personal token as `GET /api/tokens` lists it; the fake also keeps its plaintext. */
export type FakeToken = {
  name: string
  prefix: string
  scope: 'read' | 'write'
  createdAt: number
  lastUsedAt: number | null
}

/** An app connected by OAuth, as `GET /api/connections` lists it. */
export type FakeConnection = {
  id: string
  clientName: string
  clientHost: string
  scope: 'read' | 'write'
  createdAt: number
  lastUsedAt: number | null
  expiresAt: number
  isNew: boolean
}

/** A pending OAuth request, waiting on the consent screen (`#/connect/<id>`). */
export type FakeRequest = {
  clientName: string
  clientHost: string
  redirectHost: string
  scope: string | null
  expiresAt: number
  redirectUri: string
  state: string
}

export const PASSWORD = 'correct horse battery'

/** One server-sent event, as the API frames it (docs/api.md §3.2). */
export function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/** The answer a question gets unless a test scripts another. */
export const ANSWER = 'Three of four this week.'

/** A stream a test writes to by hand: frames arrive when it pushes them. */
export type StreamControl = {
  push: (text: string) => void
  end: () => void
  /** The connection drops: the reader's next read fails. */
  fail: () => void
  /** True once the client cancelled its reader (Stop, a timeout, or a finished answer). */
  cancelled: () => boolean
}

const encoder = new TextEncoder()

function eventStream(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

function chunks(texts: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const t of texts) c.enqueue(encoder.encode(t))
      c.close()
    },
  })
}

function emptyAccount(password: string): Account {
  return {
    password,
    plans: { exercise: {}, cardio: {}, diet: {} },
    details: { exercise: {}, cardio: {}, diet: {} },
    ticks: { exercise: {}, cardio: {}, diet: {} },
    partial: { exercise: {}, cardio: {}, diet: {} },
    missed: { exercise: {}, cardio: {}, diet: {} },
    settings: null,
    conversations: [],
    tokens: [],
    connections: [],
  }
}

const bitOf = (mask: number | undefined, i: number) => (((mask ?? 0) >> i) & 1) === 1

/** An item's seven marks from the three masks, as the API reads them back. */
function marksOf(a: Account, s: Section, week: string, id: string): Days {
  return Array.from({ length: 7 }, (_, i) => {
    if (!bitOf(a.ticks[s][week]?.[id], i)) return null
    if (bitOf(a.partial[s][week]?.[id], i)) return 'partial'
    return bitOf(a.missed[s][week]?.[id], i) ? 'missed' : 'great'
  })
}

/** Set one mask's bit, creating the week on first use. */
function setBit(
  masks: Record<string, Record<string, number>>,
  week: string,
  id: string,
  bit: number,
  on: boolean,
): void {
  const w = (masks[week] ??= {})
  w[id] = on ? (w[id] ?? 0) | bit : (w[id] ?? 0) & ~bit
}

export class FakeApi {
  accounts = new Map<string, Account>()
  /** The user the browser's cookie belongs to, or null. */
  signedIn: string | null = null
  links = new Map<string, { kind: 'invite' | 'reset'; username: string }>()
  /** Whether the API sends email; off, as on a planner without a Resend key. */
  mail = false
  /** Email accounts whose address is confirmed. */
  confirmed = new Set<string>()
  /** Live confirmation links: token → username. */
  confirmLinks = new Map<string, string>()
  /** Every address a reset link was asked for, sent or not. */
  forgotten: string[] = []
  offline = false
  /** Whether Ask is on (an Anthropic key on the server); off, as on a planner without one. */
  ask = false
  /** Questions left today, and the per-account cap, as `GET /api/ask` says them. */
  askRemaining = 30
  askLimit = 30
  /** Seconds until a question is free again, sent with 429 `too-many`. */
  askRetryAfter = 3600
  /** Pending OAuth requests by id, as `/api/oauth/authorize` leaves them. */
  oauthRequests = new Map<string, FakeRequest>()
  /** The most personal tokens and live connections one account may hold (D6). */
  maxTokens = 20
  maxConnections = 10
  private askScripts: (string[] | ReadableStream<Uint8Array>)[] = []
  private ids = 0
  calls: { method: string; path: string; body: unknown; expectedUser?: string }[] = []
  private failures: { method: string; path: string; status: number; body?: unknown }[] = []
  private held: (() => void)[] | null = null
  private stalled: { method: string; path: string }[] = []
  private delayed: { method: string; path: string; until: Promise<void> }[] = []
  /** Whether the request being routed said it was JSON, as the API's REST guard requires. */
  private json = false

  addUser(name: string, password = PASSWORD): Account {
    const account = emptyAccount(password)
    this.accounts.set(name, account)
    return account
  }

  /** The next matching request gets this reply instead. `path` matches as a prefix. */
  failNext(method: string, path: string, status: number, body?: unknown): void {
    this.failures.push({ method, path, status, body })
  }

  /** Matching requests never get a reply, like a read lost in a dead connection. */
  stall(method: string, path: string): void {
    this.stalled.push({ method, path })
  }

  /** Hold the next matching request's reply until the returned function is called. */
  holdNext(method: string, path: string): () => void {
    let go = () => {}
    const until = new Promise<void>((resolve) => (go = resolve))
    this.delayed.push({ method, path, until })
    return go
  }

  /** Hold every reply until the returned function is called. */
  hold(): () => void {
    this.held = []
    return () => {
      const waiting = this.held ?? []
      this.held = null
      for (const go of waiting) go()
    }
  }

  /**
   * The next question is answered with these frames, as they are, and changes nothing on the
   * server beyond the claimed question: the test's frames are the whole answer.
   */
  answerNext(frames: string[]): void {
    this.askScripts.push(frames)
  }

  /** The next question's stream stays open, and the test writes to it by hand. */
  streamNext(): StreamControl {
    let ctl!: ReadableStreamDefaultController<Uint8Array>
    let cancelled = false
    this.askScripts.push(
      new ReadableStream<Uint8Array>({
        start(c) {
          ctl = c
        },
        cancel() {
          cancelled = true
        },
      }),
    )
    return {
      push: (text) => ctl.enqueue(encoder.encode(text)),
      end: () => ctl.close(),
      fail: () => ctl.error(new TypeError('network error')),
      cancelled: () => cancelled,
    }
  }

  /** A conversation as the API keeps it, added to `name`'s history at the top. */
  addConversation(name: string, c: Partial<Conversation> & { id: string }): Conversation {
    const conversation: Conversation = {
      title: c.turns?.[0]?.question ?? 'A question',
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_000,
      turns: [],
      ...c,
    }
    this.accounts.get(name)!.conversations.unshift(conversation)
    return conversation
  }

  /** A pending request from claude.ai, as the consent screen reads it, with these changes. */
  addRequest(id: string, r: Partial<FakeRequest> = {}): FakeRequest {
    const request: FakeRequest = {
      clientName: 'Claude',
      clientHost: 'claude.ai',
      redirectHost: 'claude.ai',
      scope: null,
      expiresAt: Math.floor(Date.now() / 1000) + 600,
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      state: 'st',
      ...r,
    }
    this.oauthRequests.set(id, request)
    return request
  }

  /** The calls made, as `METHOD /path`, optionally only those starting with a prefix. */
  paths(prefix = ''): string[] {
    return this.calls.map((c) => `${c.method} ${c.path}`).filter((p) => p.includes(prefix))
  }

  state(name: string): unknown {
    const a = this.accounts.get(name)!
    const section = (s: Section) => ({
      plans: Object.fromEntries(Object.entries(a.plans[s]).map(([w, p]) => [w, p.items])),
      log: Object.fromEntries(
        Object.entries(a.ticks[s]).map(([w, items]) => [
          w,
          Object.fromEntries(Object.keys(items).map((id) => [id, marksOf(a, s, w, id)])),
        ]),
      ),
      // As the API: a cleared document is left out of `details` but keeps its revision.
      details: Object.fromEntries(
        Object.entries(a.details[s])
          .filter(([, d]) => Object.keys(d.doc).length)
          .map(([id, d]) => [id, d.doc]),
      ),
      revs: Object.fromEntries(Object.entries(a.plans[s]).map(([w, p]) => [w, p.rev])),
      detailRevs: Object.fromEntries(Object.entries(a.details[s]).map(([id, d]) => [id, d.rev])),
    })
    return {
      exercise: section('exercise'),
      cardio: section('cardio'),
      diet: section('diet'),
      settings: a.settings,
    }
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? 'GET'
    const path = String(input).replace(/^\/api/, '')
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    const headers = new Headers(init.headers)
    const expectedUser = headers.get('X-Expected-User') ?? undefined
    this.calls.push({ method, path, body, expectedUser })
    this.json = headers.get('Content-Type') === 'application/json'
    if (this.stalled.some((s) => s.method === method && path.startsWith(s.path))) {
      return new Promise<Response>(() => {})
    }
    const delay = this.delayed.findIndex((d) => d.method === method && path.startsWith(d.path))
    if (delay >= 0) {
      const [d] = this.delayed.splice(delay, 1)
      // Answer with the state as it was when the request arrived, as a slow reply would.
      const reply = this.route(method, path, body as Record<string, unknown>, expectedUser)
      await d!.until
      return reply
    }
    if (this.held) await new Promise<void>((go) => this.held!.push(go))
    if (this.offline) throw new TypeError('Failed to fetch')
    const failure = this.failures.findIndex((f) => f.method === method && path.startsWith(f.path))
    if (failure >= 0) {
      const [f] = this.failures.splice(failure, 1)
      return f!.body === undefined
        ? new Response('<html>Bad Gateway</html>', { status: f!.status })
        : Response.json(f!.body, { status: f!.status })
    }
    return this.route(method, path, body as Record<string, unknown>, expectedUser)
  }

  /** What the API says about a signed-in account: the name, and the flag when it applies. */
  private account(name: string): Response {
    const flag = this.mail && name.includes('@') ? { confirmed: this.confirmed.has(name) } : {}
    return Response.json({ username: name, ...flag })
  }

  private route(
    method: string,
    path: string,
    body: Record<string, unknown>,
    expectedUser?: string,
  ): Response {
    const error = (status: number, code: string, extra: object = {}) =>
      Response.json({ error: code, ...extra }, { status })
    if (method === 'GET' && path === '/auth/options') {
      return Response.json({ mail: this.mail, ask: this.ask })
    }
    if (method === 'POST' && path === '/auth/forgot') {
      if (!this.mail) return error(503, 'mail-off')
      const email = String(body.email).trim().toLowerCase()
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return error(400, 'email')
      this.forgotten.push(email)
      return Response.json({}, { status: 202 })
    }
    if (method === 'POST' && path === '/auth/confirm') {
      const name = this.confirmLinks.get(String(body.token))
      if (!name) return error(410, 'gone')
      this.confirmLinks.delete(String(body.token))
      this.confirmed.add(name)
      return this.account(name)
    }
    if (method === 'POST' && path === '/auth/login') {
      const a = this.accounts.get(String(body.username))
      if (!a || a.password !== body.password) return error(401, 'invalid')
      this.signedIn = String(body.username)
      return this.account(this.signedIn)
    }
    if (method === 'POST' && path === '/auth/signup') {
      const email = String(body.email).trim().toLowerCase()
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return error(400, 'email')
      const password = String(body.password)
      if (password.length < 10 || password.length > 256) return error(400, 'password')
      if (this.accounts.has(email)) return error(409, 'exists')
      this.addUser(email, password)
      this.signedIn = email
      return this.account(email)
    }
    if (method === 'POST' && path === '/invites/lookup') {
      const link = this.links.get(String(body.token))
      return link ? Response.json(link) : error(410, 'gone')
    }
    if (method === 'POST' && path === '/invites/redeem') {
      const link = this.links.get(String(body.token))
      if (!link) return error(410, 'gone')
      const password = String(body.password)
      if (password.length < 10 || password.length > 256) return error(400, 'password')
      this.links.delete(String(body.token))
      if (link.kind === 'invite') this.addUser(link.username, password)
      else this.accounts.get(link.username)!.password = password
      this.signedIn = link.username
      return this.account(link.username)
    }
    if (method === 'POST' && path === '/auth/logout') {
      this.signedIn = null
      return new Response(null, { status: 204 })
    }
    if (path.startsWith('/oauth/')) return this.routeOAuth(method, path, body)
    const user = this.signedIn
    const a = user ? this.accounts.get(user) : undefined
    if (!a) return error(401, 'auth')
    // As the API does: a tab expecting another user must not see or change this one's data.
    if (expectedUser !== undefined && expectedUser.toLowerCase() !== user!.toLowerCase()) {
      return error(401, 'auth')
    }
    if (method === 'GET' && path === '/auth/me') return this.account(user!)
    if (method === 'POST' && path === '/auth/confirm/resend') {
      if (!this.mail) return error(503, 'mail-off')
      if (!user!.includes('@')) return error(409, 'no-email')
      if (this.confirmed.has(user!)) return error(409, 'confirmed')
      return Response.json({}, { status: 202 })
    }
    if (method === 'GET' && path === '/state') return Response.json(this.state(user!))
    if (method === 'GET' && path === '/export') return Response.json(this.exportFile(a))
    if (method === 'POST' && path === '/import') return this.import(a, body)
    if (path === '/tokens' || path.startsWith('/tokens/'))
      return this.routeTokens(a, method, path, body)
    if (path === '/connections' || path.startsWith('/connections/')) {
      return this.routeConnections(a, method, path)
    }
    if (path === '/ask' || path.startsWith('/ask/')) return this.routeAsk(a, method, path, body)
    if (method === 'PUT' && path === '/settings') {
      // As the API: a client that sends no foodPick (K57), Daily goal (K85) or itemSections (K66) keeps the saved
      // one; an arrangement is normalised, and left out when every page has the default.
      a.settings = normalisePortableSettings({
        accent: String(body.accent),
        dailyPick: Number(body.dailyPick),
        foodPick: Number(body.foodPick ?? a.settings?.foodPick ?? 2),
        // As the API: a client that sends no Daily goal keeps the saved one (K85).
        dailyGoal: typeof body.dailyGoal === 'boolean' ? body.dailyGoal : a.settings?.dailyGoal,
        // As the API: goals that aren't a string are not sent, so the saved ones stay (F1).
        goals:
          typeof body.goals === 'string' ? normaliseGoals(body.goals) : (a.settings?.goals ?? ''),
        // Your limits the same way (K107).
        limits:
          typeof body.limits === 'string'
            ? normaliseLimits(body.limits)
            : (a.settings?.limits ?? ''),
        itemSections: 'itemSections' in body ? body.itemSections : a.settings?.itemSections,
      })
      return Response.json(a.settings)
    }
    let m = path.match(/^\/plans\/(exercise|cardio|diet)\/(\d{4}-\d{2}-\d{2})$/)
    if (method === 'PUT' && m) {
      const plans = a.plans[m[1] as Section]
      const current = plans[m[2]!]
      const rev = current?.rev ?? 0
      if (body.rev === rev) {
        plans[m[2]!] = { items: body.items as unknown[], rev: rev + 1 }
        return Response.json({ rev: rev + 1 })
      }
      if (current && JSON.stringify(current.items) === JSON.stringify(body.items)) {
        return Response.json({ rev })
      }
      return error(409, 'conflict', { items: current?.items ?? null, rev })
    }
    m = path.match(/^\/details\/(exercise|cardio|diet)\/([^/]+)$/)
    if (method === 'PUT' && m) {
      const all = a.details[m[1] as Section]
      const id = decodeURIComponent(m[2]!)
      const doc = normaliseDetails(body.details)
      if (!doc || typeof body.rev !== 'number') return error(400, 'invalid')
      const current = all[id]
      const rev = current?.rev ?? 0
      if (body.rev === rev) {
        all[id] = { doc, rev: rev + 1 }
        return Response.json({ rev: rev + 1 })
      }
      if (current && JSON.stringify(current.doc) === JSON.stringify(doc)) {
        return Response.json({ rev })
      }
      return error(409, 'conflict', { details: current?.doc ?? null, rev })
    }
    m = path.match(/^\/ticks\/(exercise|cardio|diet)\/(\d{4}-\d{2}-\d{2})\/([^/]+)\/([0-6])$/)
    if (method === 'PUT' && m) {
      const [s, week] = [m[1] as Section, m[2]!]
      const id = decodeURIComponent(m[3]!)
      const bit = 1 << Number(m[4])
      // `done` is the body from before marks had kinds, which the API still takes.
      const mark = 'mark' in body ? body.mark : body.done ? 'great' : null
      setBit(a.ticks[s], week, id, bit, mark != null)
      setBit(a.partial[s], week, id, bit, mark === 'partial')
      setBit(a.missed[s], week, id, bit, mark === 'missed')
      return Response.json({ days: marksOf(a, s, week, id) })
    }
    return error(404, 'not-found')
  }

  /**
   * The consent screen's calls (docs/api.md): no session needed. A write without the JSON content
   * type is refused 415, as the REST guard refuses it, so a bodiless deny shows up in a test.
   */
  private routeOAuth(method: string, path: string, body: Record<string, unknown>): Response {
    const error = (status: number, code: string, extra: object = {}) =>
      Response.json({ error: code, ...extra }, { status })
    const m = /^\/oauth\/requests\/([A-Za-z0-9_-]+)(\/approve|\/deny)?$/.exec(path)
    if (!m) return error(404, 'not-found')
    if (method !== 'GET' && !this.json) return error(415, 'unsupported')
    const id = m[1]!
    const found = this.oauthRequests.get(id)
    const now = Math.floor(Date.now() / 1000)
    if (!found || found.expiresAt <= now) return error(404, 'no-request')
    const back = (params: Record<string, string>) =>
      `${found.redirectUri}?${new URLSearchParams({ ...params, state: found.state, iss: 'http://localhost:3000' })}`
    if (method === 'GET' && !m[2]) {
      const { clientName, clientHost, redirectHost, scope, expiresAt } = found
      return Response.json({ clientName, clientHost, redirectHost, scope, expiresAt })
    }
    if (method === 'POST' && m[2] === '/deny') {
      this.oauthRequests.delete(id)
      return Response.json({ redirectTo: back({ error: 'access_denied' }) })
    }
    if (method === 'POST' && m[2] === '/approve') {
      const { email, password, write = false } = body
      if (typeof email !== 'string' || typeof password !== 'string' || typeof write !== 'boolean') {
        return error(400, 'invalid')
      }
      const name = email.trim()
      const a = this.accounts.get(name)
      if (!a || a.password !== password) return error(401, 'invalid')
      if (a.connections.length >= this.maxConnections) return error(409, 'too-many')
      this.oauthRequests.delete(id)
      a.connections.unshift({
        id: `g${++this.ids}`,
        clientName: found.clientName,
        clientHost: found.clientHost,
        scope: write ? 'write' : 'read',
        createdAt: now,
        lastUsedAt: null,
        expiresAt: now + 90 * 24 * 3600,
        isNew: true,
      })
      return Response.json({ redirectTo: back({ code: `code${this.ids}` }) })
    }
    return error(405, 'method')
  }

  /** Personal tokens (W2): list, create (shown once), and remove by prefix. */
  private routeTokens(a: Account, method: string, path: string, body: Record<string, unknown>) {
    const error = (status: number, code: string) => Response.json({ error: code }, { status })
    if (path === '/tokens' && method === 'GET') return Response.json({ tokens: a.tokens })
    if (path === '/tokens' && method === 'POST') {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name || name.length > 64) return error(400, 'token-name')
      if (body.scope !== 'read' && body.scope !== 'write') return error(400, 'invalid')
      if (a.tokens.length >= this.maxTokens) return error(409, 'too-many')
      const n = ++this.ids
      const prefix = `Tk${String(n).padStart(6, '0')}`
      const token = `trk_${prefix}${'x'.repeat(35)}`
      const info: FakeToken = {
        name,
        prefix,
        scope: body.scope,
        createdAt: Math.floor(Date.now() / 1000),
        lastUsedAt: null,
      }
      a.tokens.unshift(info)
      return Response.json({ token, info }, { status: 201 })
    }
    const m = /^\/tokens\/([^/]+)$/.exec(path)
    if (m && method === 'DELETE') {
      const prefix = decodeURIComponent(m[1]!)
      if (!a.tokens.some((t) => t.prefix === prefix)) return error(404, 'no-token')
      a.tokens = a.tokens.filter((t) => t.prefix !== prefix)
      return new Response(null, { status: 204 })
    }
    return error(404, 'not-found')
  }

  /** Apps connected by OAuth (W4): list, and remove one. */
  private routeConnections(a: Account, method: string, path: string) {
    const error = (status: number, code: string) => Response.json({ error: code }, { status })
    if (path === '/connections' && method === 'GET') {
      return Response.json({ connections: a.connections })
    }
    const m = /^\/connections\/([^/]+)$/.exec(path)
    if (m && method === 'DELETE') {
      const id = decodeURIComponent(m[1]!)
      if (!a.connections.some((c) => c.id === id)) return error(404, 'no-connection')
      a.connections = a.connections.filter((c) => c.id !== id)
      return new Response(null, { status: 204 })
    }
    return error(404, 'not-found')
  }

  /** Ask (docs/api.md §3.2): the questions left, a question's stream, and the history. */
  private routeAsk(a: Account, method: string, path: string, body: Record<string, unknown>) {
    const error = (status: number, code: string, extra: object = {}) =>
      Response.json({ error: code, ...extra }, { status })
    if (path === '/ask/conversations') {
      if (method === 'GET') {
        return Response.json({
          conversations: a.conversations.map((c) => ({
            id: c.id,
            title: c.title,
            updatedAt: c.updatedAt,
            turns: c.turns.length,
          })),
        })
      }
      a.conversations = []
      return new Response(null, { status: 204 })
    }
    const m = /^\/ask\/conversations\/([A-Za-z0-9_-]+)$/.exec(path)
    if (m) {
      const found = a.conversations.find((c) => c.id === m[1])
      if (!found) return error(404, 'not-found')
      if (method === 'GET') return Response.json(found)
      a.conversations = a.conversations.filter((c) => c !== found)
      return new Response(null, { status: 204 })
    }
    if (!this.ask) return error(503, 'ask-off')
    if (method === 'GET')
      return Response.json({ remaining: this.askRemaining, limit: this.askLimit })
    const id = body.conversation
    let conversation = a.conversations.find((c) => c.id === id)
    if (id !== undefined && !conversation) return error(404, 'not-found')
    if (this.askRemaining <= 0) {
      return error(429, 'too-many', { retryAfter: this.askRetryAfter })
    }
    this.askRemaining--
    const script = this.askScripts.shift()
    if (script instanceof ReadableStream) return eventStream(script)
    if (script) return eventStream(chunks(script))
    // The default answer, saved as the API saves it.
    const question = String(body.question)
    const now = Math.floor(Date.now() / 1000)
    conversation ??= {
      id: `c${++this.ids}`,
      title: question.slice(0, 80),
      createdAt: now,
      updatedAt: now,
      turns: [],
    }
    conversation.turns.push({ question, answer: ANSWER, stop: 'end_turn', askedAt: now })
    conversation.updatedAt = now
    const saved = conversation
    a.conversations = [saved, ...a.conversations.filter((c) => c !== saved)]
    return eventStream(
      chunks([
        sse('start', { remaining: this.askRemaining, conversation: saved.id }),
        ': keep-alive\n\n',
        sse('tool', { name: 'week_summary' }),
        sse('text', { delta: ANSWER.slice(0, 10) }),
        sse('text', { delta: ANSWER.slice(10) }),
        sse('done', { stop: 'end_turn', saved: true }),
      ]),
    )
  }

  /** `GET /api/export`: the account's data and its Ask history (docs/api.md §3). */
  private exportFile(a: Account): object {
    const state = this.state(this.signedIn!) as Record<
      Section,
      { plans: object; log: object; details: object }
    >
    return {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      exercise: {
        plans: state.exercise.plans,
        log: state.exercise.log,
        details: state.exercise.details,
      },
      cardio: { plans: state.cardio.plans, log: state.cardio.log, details: state.cardio.details },
      diet: { plans: state.diet.plans, log: state.diet.log, details: state.diet.details },
      settings: a.settings,
      conversations: a.conversations,
    }
  }

  /**
   * The API's merge: existing weeks keep their plan and marks, items with details keep them, and
   * settings apply only if none (goals aside).
   */
  private import(a: Account, body: unknown): Response {
    const parsed = parseExport(JSON.stringify(body))
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })
    let weeks = 0
    let ticks = 0
    let details = 0
    for (const section of ['exercise', 'cardio', 'diet'] as const) {
      const incoming = parsed.data[section]
      const existing = this.state(this.signedIn!) as Record<Section, never>
      const added = mergeSummary(existing[section], incoming)
      weeks += added.weeks
      ticks += added.ticks
      details += added.details
      for (const [week, items] of Object.entries(incoming.plans)) {
        a.plans[section][week] ??= { items, rev: 1 }
      }
      for (const [id, doc] of Object.entries(incoming.details)) {
        const current = a.details[section][id]
        if (!current?.doc || !Object.keys(current.doc).length) {
          a.details[section][id] = { doc, rev: (current?.rev ?? 0) + 1 }
        }
      }
      for (const [week, entries] of Object.entries(incoming.log)) {
        for (const [id, days] of Object.entries(entries)) {
          // A marked day keeps its mark; an empty one takes the file's.
          const before = marksOf(a, section, week, id)
          days.forEach((mark, i) => {
            const kept = before[i] ?? mark
            const bit = 1 << i
            setBit(a.ticks[section], week, id, bit, kept !== null)
            setBit(a.partial[section], week, id, bit, kept === 'partial')
            setBit(a.missed[section], week, id, bit, kept === 'missed')
          })
        }
      }
    }
    // As the API: saved settings stay, but the file's goals and limits fill empty ones (F17, K107).
    const merged = mergeSettings(a.settings, parsed.data.settings)
    const settings = JSON.stringify(merged) !== JSON.stringify(a.settings)
    a.settings = merged
    // As the API: a conversation is added only when the account has none with its id.
    const before = a.conversations.length
    a.conversations = mergeConversations(a.conversations, parsed.data.conversations ?? [])
    return Response.json({
      weeks,
      ticks,
      details,
      settings,
      conversations: a.conversations.length - before,
    })
  }
}
