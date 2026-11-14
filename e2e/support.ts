// Shared set-up for the browser checks: a signed-in app with /api mocked, the style guide in any
// look, axe, and the measurements the specs repeat.
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

/** Longer than the slowest transition (120ms in the primitives, 150ms in older screens). */
export const SETTLE_MS = 400

export const THEMES = ['light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

/**
 * The app's "today": Wednesday 21 October 2026, so the week, its labels and the scroll position
 * the grids open at are the same on every run. Noon keeps it clear of midnight in any timezone.
 */
export const TODAY = new Date('2026-10-21T12:00:00')
const MONDAY = '2026-10-19'

/** The account's settings as PUT /api/settings sends them and GET /api/state returns them. */
export type Settings = {
  accent: string
  dailyPick: number
  foodPick: number
  itemSections?: Record<string, { order: string[]; hidden: string[] }>
}

const G = 'great'
const P = 'partial'
const M = 'missed'
const _ = null

/** A tracker as the API sends it (docs/api.md §3.1). */
type Tracker = {
  id: string
  name: string
  kind: string
  position: number
  dailyTarget: number | null
  startWeek: string | null
  endWeek: string | null
  rev: number
}

/** One tracker's data as the mock keeps it. */
type Section = {
  plans: Record<string, Record<string, unknown>[]>
  log: Record<string, Record<string, (string | null)[]>>
  details: Record<string, unknown>
  revs: Record<string, number>
  detailRevs: Record<string, number>
}

/** The first three trackers, as every account starts (K123). */
function firstTrackers(): Tracker[] {
  return [
    ['exercise', 'Strength', 'strength', 3],
    ['cardio', 'Cardio', 'cardio', null],
    ['diet', 'Food', 'food', 2],
  ].map(([id, name, kind, dailyTarget], position) => ({
    id: id as string,
    name: name as string,
    kind: kind as string,
    position,
    dailyTarget: dailyTarget as number | null,
    startWeek: null,
    endWeek: null,
    rev: 1,
  }))
}

/** A week with a plan and every kind of mark, kept by tracker id as the API keeps it. */
function state() {
  return {
    trackers: firstTrackers(),
    exercise: {
      plans: {
        [MONDAY]: [
          { id: 'pu', name: 'Push-ups', sets: 3, reps: 12, target: 4 },
          { id: 'pl', name: 'Pull-ups', sets: 3, reps: 5, target: 3 },
          { id: 'sq', name: 'Squats', sets: 3, reps: 15, weight: 16, target: 3 },
          { id: 'be', name: 'Back extensions', reps: 12, target: 3 },
          { id: 'kh', name: 'Kettlebell halos', reps: 8, perSide: true, target: 2 },
        ],
      },
      // Each item's notes, one copy for every week (D2).
      details: {
        pu: { notes: 'Slow on the way down. [Form video](https://example.com/push-ups)' },
        kh: {
          notes: '**Ribs down.** Change direction each set, and keep the bell close to the head.',
        },
      },
      log: {
        [MONDAY]: {
          pu: [G, _, G, _, _, _, _],
          pl: [G, _, P, _, _, _, _],
          sq: [_, M, M, _, _, _, _],
          be: [_, _, _, _, _, _, _],
          kh: [_, P, _, _, _, _, _],
        },
      },
      revs: {},
      detailRevs: { pu: 1, kh: 1 },
    },
    // Cardio (K90): a time, a distance, each marked like an exercise.
    cardio: {
      plans: {
        [MONDAY]: [
          { id: 'cy', name: 'Cycling', duration: 1800, target: 2 },
          { id: 'ru', name: 'Running', distance: 5, target: 3 },
        ] as { id: string; name: string; duration?: number; distance?: number; target: number }[],
      },
      log: { [MONDAY]: { cy: [G, _, _, _, _, _, _], ru: [_, _, P, _, _, _, _] } },
      details: {},
      revs: {},
      detailRevs: {},
    },
    diet: {
      plans: {},
      log: { [MONDAY]: { veg: [G, G, _, _, _, _, _], fish: [G, _, _, _, _, _, _] } },
      details: {},
      revs: {},
      detailRevs: {},
    },
    settings: null as Settings | null,
  }
}

type MockState = ReturnType<typeof state>

/** The Monday of a date key's week, as the API reads a tracker's `week`. */
function mondayOf(key: string): string {
  const d = new Date(`${key}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/** The tracker's data, made empty the first time a write names it. */
function sectionOf(s: MockState, id: string): Section {
  const sections = s as unknown as Record<string, Section>
  sections[id] ??= { plans: {}, log: {}, details: {}, revs: {}, detailRevs: {} }
  return sections[id]
}

/**
 * GET /api/state as the API sends it (docs/api.md §3): the trackers, then each one's plans, log
 * and revisions under `sections`, its details and their revisions under `details` and
 * `detailRevs`, by tracker id.
 */
function stateReply(s: MockState) {
  const by = <T>(pick: (d: Section) => T) =>
    Object.fromEntries(s.trackers.map((t) => [t.id, pick(sectionOf(s, t.id))]))
  return {
    trackers: s.trackers,
    sections: by((d) => ({ plans: d.plans, log: d.log, revs: d.revs })),
    details: by((d) => d.details),
    detailRevs: by((d) => d.detailRevs),
    settings: s.settings,
  }
}

/**
 * The tracker and plan writes, kept as the API keeps them, so a later read of the state returns
 * what the app wrote: `POST /trackers` adds one last, `PATCH /trackers/<id>` renames it or sets
 * its daily target, `POST /trackers/<id>/end` ends it, `PUT /plans/<id>/<week>` stores a plan and
 * `PUT /ticks/<id>/<week>/<item>/<day>` a mark and `PUT /details/<id>/<item>` an item's details.
 * Null for any other route.
 */
function trackerReply(s: MockState, method: string, path: string, body: unknown): unknown {
  const b = (body ?? {}) as Record<string, unknown>
  if (method === 'POST' && path === '/trackers') {
    const found = s.trackers.find((t) => t.id === b.id)
    if (found) return found
    const kind = String(b.kind)
    const tracker: Tracker = {
      id: String(b.id),
      name: String(b.name).trim(),
      kind,
      position: Math.max(...s.trackers.map((t) => t.position)) + 1,
      dailyTarget: kind === 'cardio' ? null : kind === 'food' ? 2 : 3,
      startWeek: mondayOf(String(b.week ?? MONDAY)),
      endWeek: null,
      rev: 1,
    }
    s.trackers.push(tracker)
    return tracker
  }
  const patch = /^\/trackers\/([^/]+)$/.exec(path)
  const end = /^\/trackers\/([^/]+)\/end$/.exec(path)
  const tracker = s.trackers.find((t) => t.id === decodeURIComponent((patch ?? end)?.[1] ?? ''))
  if (method === 'PATCH' && patch && tracker) {
    if (typeof b.name === 'string') tracker.name = b.name.trim()
    if (b.dailyTarget !== undefined) tracker.dailyTarget = b.dailyTarget as number | null
    tracker.rev += 1
    return tracker
  }
  if (method === 'POST' && end && tracker) {
    const week = mondayOf(String(b.week ?? MONDAY))
    if (!tracker.endWeek || week < tracker.endWeek) tracker.endWeek = week
    tracker.rev += 1
    return tracker
  }
  const plan = /^\/plans\/([^/]+)\/([0-9-]+)$/.exec(path)
  if (method === 'PUT' && plan) {
    const d = sectionOf(s, decodeURIComponent(plan[1]!))
    d.plans[plan[2]!] = b.items as Record<string, unknown>[]
    d.revs[plan[2]!] = (d.revs[plan[2]!] ?? 0) + 1
    return { rev: d.revs[plan[2]!] }
  }
  const doc = /^\/details\/([^/]+)\/([^/]+)$/.exec(path)
  if (method === 'PUT' && doc) {
    const d = sectionOf(s, decodeURIComponent(doc[1]!))
    const item = decodeURIComponent(doc[2]!)
    d.details[item] = b.details
    d.detailRevs[item] = (d.detailRevs[item] ?? 0) + 1
    return { rev: d.detailRevs[item] }
  }
  const tick = /^\/ticks\/([^/]+)\/([0-9-]+)\/([^/]+)\/([0-6])$/.exec(path)
  if (method === 'PUT' && tick) {
    const d = sectionOf(s, decodeURIComponent(tick[1]!))
    const week = (d.log[tick[2]!] ??= {})
    const days = (week[decodeURIComponent(tick[3]!)] ??= Array<string | null>(7).fill(null))
    days[Number(tick[4])] = (b.mark as string | null | undefined) ?? null
    return {}
  }
  return null
}

const NOON = Math.floor(TODAY.getTime() / 1000)
const DAY = 24 * 3600

/** Ask's history as the API lists it (docs/api.md §3.2): Today, Last week and Earlier. */
const CONVERSATIONS = [
  { id: 'diet', title: 'Is my diet good enough?', updatedAt: NOON - 600, turns: 1 },
  {
    id: 'month',
    title: 'Am I doing enough to meet my goals this month?',
    updatedAt: NOON - 3 * DAY,
    turns: 1,
  },
  { id: 'rest', title: 'Should I add a rest day?', updatedAt: NOON - 20 * DAY, turns: 1 },
]

/** The answer every question gets: a paragraph, a list and bold, as Claude writes them. */
const ANSWER = [
  'Mostly, yes. Over four weeks you met **Push-ups** and **Squats** every week.',
  '',
  '- Pull-ups met its three days twice.',
  '- Back extensions is at two of three this week.',
  '',
  'Your goal says “Ten pull-ups in a row by March”. One more rep a set every second week would get you there.',
].join('\n')

/** One server-sent event, as the API frames it. */
function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/** The Ask routes, for a planner with Ask on. Anything else under /ask/ is not one of these. */
function askReply(method: string, path: string): { json?: unknown; body?: string } | null {
  if (method === 'GET' && path === '/ask') return { json: { remaining: 27, limit: 30 } }
  if (method === 'GET' && path === '/ask/conversations')
    return { json: { conversations: CONVERSATIONS } }
  const open = /^\/ask\/conversations\/(\w+)$/.exec(path)
  const found = open && CONVERSATIONS.find((c) => c.id === open[1])
  if (method === 'GET' && found) {
    return {
      json: {
        ...found,
        createdAt: found.updatedAt,
        turns: [
          { question: found.title, answer: ANSWER, stop: 'end_turn', askedAt: found.updatedAt },
        ],
      },
    }
  }
  if (method === 'POST' && path === '/ask') {
    const words = ANSWER.split(/(?<= )/)
    return {
      body: [
        sse('start', { remaining: 26, conversation: 'diet' }),
        ': keep-alive\n\n',
        ...words.map((delta) => sse('text', { delta })),
        sse('done', { stop: 'end_turn', saved: true }),
      ].join(''),
    }
  }
  return null
}

/**
 * Opens the app signed in as alice, with the API mocked: /auth/me knows her, /state returns the
 * week above as a version 6 state, tracker, plan and mark writes are kept (`trackerReply`), and
 * every other write succeeds. With `ask`, the planner answers questions: the bar has
 * Ask, and /api/ask answers from the history and the answer above.
 */
export async function openApp(
  page: Page,
  {
    theme = 'light',
    unconfirmed = false,
    moreExercises = 0,
    moreCardio = 0,
    moreFoods = 0,
    noCardio = false,
    ask = false,
  }: {
    theme?: Theme
    /** The account's email is not confirmed yet, so the confirm banner shows. */
    unconfirmed?: boolean
    /** Extra exercises after the mocked five, for a week taller than the screen. */
    moreExercises?: number
    /** Extra cardio after the mocked two, for a Cardio screen taller than the screen. */
    moreCardio?: number
    /** Foods for the Food screen, enough to run past it. */
    moreFoods?: number
    /** No cardio planned at all, as on an account that has never added any. */
    noCardio?: boolean
    /** Ask is on (an Anthropic key on the server). */
    ask?: boolean
  } = {},
): Promise<{ settings: Settings | null }> {
  await page.clock.setFixedTime(TODAY)
  const s = state()
  for (let i = 1; i <= moreExercises; i++) {
    s.exercise.plans[MONDAY]!.push({ id: `x${i}`, name: `Exercise ${i}`, reps: 10, target: 2 })
  }
  for (let i = 1; i <= moreCardio; i++) {
    s.cardio.plans[MONDAY]!.push({ id: `c${i}`, name: `Cardio ${i}`, duration: 600, target: 1 })
  }
  if (noCardio) {
    s.cardio.plans[MONDAY] = []
    s.cardio.log[MONDAY] = {} as (typeof s.cardio.log)[typeof MONDAY]
  }
  if (moreFoods) {
    s.diet.plans = {
      [MONDAY]: Array.from({ length: moreFoods }, (_, i) => ({
        id: `f${i}`,
        name: `Food ${i + 1}`,
        target: 3,
      })),
    }
  }
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname.replace(/^\/api/, '')
    if (req.method() === 'GET' && path === '/auth/me')
      return route.fulfill({
        json: unconfirmed ? { username: 'alice', confirmed: false } : { username: 'alice' },
      })
    if (req.method() === 'GET' && path === '/state') return route.fulfill({ json: stateReply(s) })
    // Settings are kept, as the API keeps them, so a reload reads them back.
    if (req.method() === 'PUT' && path === '/settings') {
      s.settings = req.postDataJSON() as Settings
      return route.fulfill({ json: s.settings })
    }
    if (req.method() === 'GET' && path === '/auth/options')
      return route.fulfill({ json: { mail: false, ask } })
    // Settings › Connections: nothing connected and no tokens, unless a spec routes them itself.
    if (req.method() === 'GET' && path === '/tokens') return route.fulfill({ json: { tokens: [] } })
    if (req.method() === 'GET' && path === '/connections')
      return route.fulfill({ json: { connections: [] } })
    let body: unknown = null
    try {
      body = req.postDataJSON()
    } catch {
      // Not JSON (an upload): no tracker write.
    }
    const kept = trackerReply(s, req.method(), path, body)
    if (kept) return route.fulfill({ json: kept })
    const reply = ask ? askReply(req.method(), path) : null
    if (reply?.body) {
      return route.fulfill({ body: reply.body, contentType: 'text/event-stream' })
    }
    if (reply) return route.fulfill({ json: reply.json })
    if (req.method() === 'PUT') return route.fulfill({ json: { rev: 1 } })
    return route.fulfill({ json: {} })
  })
  await page.addInitScript(
    ([st, theme]) => {
      // Once per test: a reload keeps what the app itself wrote since.
      if (sessionStorage.getItem('e2e-seeded')) return
      sessionStorage.setItem('e2e-seeded', '1')
      localStorage.setItem('tracker-session-v1', JSON.stringify({ user: 'alice' }))
      localStorage.setItem('tracker-cache-v6:alice', JSON.stringify(st))
      localStorage.setItem('tracker-settings-v1', JSON.stringify({ theme }))
    },
    [cacheOf(s), theme] as const,
  )
  await page.goto('/')
  await page.waitForSelector('[data-testid="exercise-grid"]')
  await settle(page)
  return s
}

/** The app's cache as it writes it (`tracker-cache-v6`): the state with each tracker's data whole. */
function cacheOf(s: MockState) {
  return {
    trackers: s.trackers,
    sections: Object.fromEntries(s.trackers.map((t) => [t.id, sectionOf(s, t.id)])),
    settings: s.settings,
  }
}

/**
 * Calls up the bar from the planner's screens (Header card, Out of sight; K79, K80): a long press
 * with the mouse, in the page's left margin halfway down, where nothing is pressed by it. It
 * opens Edit plan, where the bar is sticky and in view; its controls are out of view until then.
 */
export async function callUpBar(page: Page): Promise<void> {
  const height = page.viewportSize()?.height ?? 800
  await page.mouse.move(4, height / 2)
  await page.mouse.down()
  // Edit plan is on once the bar is sticky in the page (K80).
  await page.locator('[data-slot="bar"].sticky').waitFor()
  await page.mouse.up()
  await settle(page)
}

/**
 * Opens the Ask page from the bar, with Ask on, and asks a question, so the page shows a whole
 * answer in the conversation, the history beside it (or, folded, behind its toggle), the chip
 * and the note.
 */
export async function openAsk(page: Page, theme: Theme = 'light'): Promise<void> {
  await openApp(page, { theme, ask: true })
  await callUpBar(page)
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
  await page.getByRole('heading', { level: 1, name: 'Ask' }).waitFor()
  await page.getByLabel('Your question').fill('Am I doing enough to meet my goals this month?')
  await page.getByRole('button', { name: 'Send' }).click()
  await page.getByText('One more rep a set every second week').waitFor()
  await page.getByText('26 questions left today').waitFor()
  await settle(page)
}

/** Opens the sign-in screen: nobody is signed in and the API says so. It sends email, so
 * "Forgot your password?" shows. */
export async function openSignIn(page: Page, theme: Theme): Promise<void> {
  await openSignedOut(page, theme, '/')
}

/** Opens the create-an-account screen (`#/signup`), signed out. */
export async function openSignUp(page: Page, theme: Theme): Promise<void> {
  await openSignedOut(page, theme, '/#/signup')
}

/** Opens the reset-your-password screen (`#/forgot`), signed out. */
export async function openForgot(page: Page, theme: Theme): Promise<void> {
  await openSignedOut(page, theme, '/#/forgot')
}

/** Opens a confirm-your-email link that works, signed out: the "Email confirmed" card. */
export async function openConfirmed(page: Page, theme: Theme): Promise<void> {
  await openSignedOut(page, theme, '/#/confirm/tok', '[data-testid="confirm-done"]')
}

async function openSignedOut(
  page: Page,
  theme: Theme,
  path: string,
  ready = 'form',
): Promise<void> {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '')
    if (path === '/auth/options') return route.fulfill({ json: { mail: true } })
    if (path === '/auth/forgot') return route.fulfill({ status: 202, json: {} })
    if (path === '/auth/confirm')
      return route.fulfill({ json: { username: 'sam@example.com', confirmed: true } })
    return route.fulfill({ status: 401, json: {} })
  })
  await page.addInitScript((theme) => {
    localStorage.setItem('tracker-settings-v1', JSON.stringify({ theme }))
  }, theme)
  await page.goto(path)
  await page.waitForSelector(ready)
  await settle(page)
}

/** Opens the style guide in a look, through the query string it reads (src/styleguide/look.ts). */
export async function openStyleGuide(
  page: Page,
  { theme = 'light' }: { theme?: Theme } = {},
): Promise<void> {
  await page.goto(`/styleguide?theme=${theme}`)
  await page.waitForSelector('#sg-main section')
  await settle(page)
}

/** Waits for web fonts and for transitions (colour, outline, size) to finish. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(SETTLE_MS)
}

/** The page's --canvas token: proof the theme really switched, whatever paints the background. */
export function canvasToken(page: Page): Promise<string> {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim(),
  )
}

/**
 * Runs axe for WCAG 2.2 A and AA, plus axe's best practices (heading order, landmarks), and fails
 * with one line per rule: how many nodes, and the first few with axe's reason.
 */
export async function expectNoAxeViolations(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa', 'best-practice'])
    .analyze()
  expect(
    violations.map((v) => {
      const nodes = v.nodes.slice(0, 3).map((n) => {
        // The summary's second line is the reason ("…insufficient color contrast of 2.65…").
        const reason = n.failureSummary?.split('\n')[1]?.trim()
        return `${n.target.join(' ')}${reason ? ` [${reason}]` : ''}`
      })
      const more = v.nodes.length > 3 ? `; and ${v.nodes.length - 3} more` : ''
      return `${v.id} (${v.impact}, ${v.nodes.length} nodes): ${nodes.join('; ')}${more}`
    }),
  ).toEqual([])
}

/** No sideways scroll: the page is no wider than the viewport. A failure names what sticks out. */
export async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const size = await page.evaluate(() => {
    const innerWidth = window.innerWidth
    // What sticks out past the viewport, leaving out what scrolls inside its own box (the grids).
    const clipped = (el: HTMLElement) => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (getComputedStyle(a).overflowX !== 'visible') return true
      }
      return false
    }
    const wide = [...document.body.querySelectorAll<HTMLElement>('*')]
      .filter((el) => el.getBoundingClientRect().right > innerWidth + 0.5 && !clipped(el))
      .slice(0, 3)
      .map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}`)
    return { scrollWidth: document.documentElement.scrollWidth, innerWidth, wide }
  })
  expect(
    size.scrollWidth,
    `page is ${size.scrollWidth}px wide in a ${size.innerWidth}px viewport (${size.wide.join(', ')})`,
  ).toBeLessThanOrEqual(size.innerWidth)
}
