// The programme builder's story (docs/specs/2026-11-20-programme-builder.md), for builder.spec.ts
// and the axe and phone-width checks: carol, signed in on Thu 12 Nov 2026, with the beginner 5×5 in
// her library. /api answers with replies saved from the real API (e2e/fixtures/programmes/
// generate.py). A draft is answered by its document: each `draft-<name>.json` holds the document
// the builder sends at one step and the server's reply to it.
import { readFileSync } from 'node:fs'
import { expect, type Page, type Request } from '@playwright/test'
import { settle, type Theme } from './support'

/** A reply saved by generate.py, as the API sent it. */
export function reply(name: string): Record<string, unknown> {
  const url = new URL(`./fixtures/programmes/${name}.json`, import.meta.url)
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>
}

/** A programme document, as the builder sends it. */
export type Doc = Record<string, unknown>

/** The drafts generate.py saved, by name: the document and the server's `{errors, plan}`. */
export const DRAFT_NAMES = [
  'new',
  'named',
  'activity',
  'squat',
  'squat-grows',
  'squat-40',
  'beginner',
  'deadlift-90',
  'deadlift-10',
  'exception-new',
  'exception-week-3',
  'rest-squat',
  'rest-legs',
] as const
export type DraftName = (typeof DRAFT_NAMES)[number]
export const DRAFTS = Object.fromEntries(
  DRAFT_NAMES.map((name) => [name, reply(`draft-${name}`) as { doc: Doc; reply: unknown }]),
) as Record<DraftName, { doc: Doc; reply: unknown }>

/** The beginner 5×5 in carol's library, and the record the builder opens. */
export const BEGINNER = reply('builder-programme') as { id: string; name: string; rev: number }
/** The programme Save to library adds. */
export const SAVED = reply('builder-saved') as { id: string; name: string }
/** The 409 a save at a stale rev gets: the server's copy and its rev. */
export const CONFLICT = reply('builder-conflict') as { rev: number }

const TODAY = new Date('2026-11-12T12:00:00')
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** JSON with every object's keys sorted, so a document matches whatever its key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  )
}
const BY_DOC = new Map(DRAFT_NAMES.map((name) => [canonical(DRAFTS[name].doc), name]))

/** What the app sent: every programme request, and each draft's name in order. */
export type Sent = {
  requests: Request[]
  /** The saved draft each check matched, in order, or the document itself when none did. */
  drafts: (DraftName | Doc)[]
}

/**
 * Opens the app signed in as carol at `hash`, with /api answering from the saved replies. Save to
 * library adds `builder-saved` and the library then lists it; Save changes at the loaded rev gets
 * the 409, and at the server's rev `builder-replaced`. A draft with no saved reply gets 500, and
 * its document goes into `drafts` for the spec to report. A write without a JSON Content-Type gets
 * 415, as the server answers it.
 */
export async function openBuilder(
  page: Page,
  { hash, theme = 'light' }: { hash: string; theme?: Theme },
): Promise<Sent> {
  const sent: Sent = { requests: [], drafts: [] }
  let library = 'builder-library'
  await page.clock.setFixedTime(TODAY)
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const method = req.method()
    const path = new URL(req.url()).pathname.replace(/^\/api/, '')
    const json = (body: unknown, status = 200) => route.fulfill({ json: body, status })
    if (/^\/programmes\b/.test(path)) sent.requests.push(req)
    if (WRITES.has(method) && req.headers()['content-type']?.split(';')[0] !== 'application/json')
      return json({ error: 'content-type' }, 415)
    if (method === 'GET' && path === '/auth/me') return json(reply('builder-me'))
    if (method === 'GET' && path === '/auth/options') return json({ mail: false, ask: false })
    if (method === 'GET' && path === '/state') return json(reply('builder-state'))
    if (method === 'GET' && path === '/shared-programmes') return json(reply('shared-before'))
    if (method === 'GET' && path === '/programmes') return json(reply(library))
    if (method === 'POST' && path === '/programmes/draft') {
      const { doc } = req.postDataJSON() as { doc: Doc }
      const name = BY_DOC.get(canonical(doc))
      sent.drafts.push(name ?? doc)
      if (!name) return json({ error: 'no saved draft for this document' }, 500)
      return json(DRAFTS[name].reply)
    }
    if (method === 'POST' && path === '/programmes') {
      library = 'builder-library-saved'
      return json(SAVED, 201)
    }
    if (method === 'GET' && path === `/programmes/${BEGINNER.id}`) return json(BEGINNER)
    if (method === 'PUT' && path === `/programmes/${BEGINNER.id}`) {
      const { rev } = req.postDataJSON() as { rev: number }
      if (rev !== CONFLICT.rev) return json(CONFLICT, 409)
      library = 'builder-library-replaced'
      return json(reply('builder-replaced'))
    }
    if (method === 'GET' && path === '/tokens') return json({ tokens: [] })
    if (method === 'GET' && path === '/connections') return json({ connections: [] })
    if (method === 'PUT') return json({ rev: 1 })
    return json({})
  })
  const me = reply('builder-me') as { username: string }
  await page.addInitScript(
    ({ theme, user }) => {
      localStorage.setItem('tracker-session-v1', JSON.stringify({ user }))
      localStorage.setItem('tracker-settings-v1', JSON.stringify({ theme }))
    },
    { theme, user: me.username },
  )
  await page.goto(`/${hash}`)
  await page.waitForSelector('[data-testid="programme-builder"], [data-testid="programmes-page"]')
  await settle(page)
  return sent
}

/** The foot bar's line: Checking…, Checked. No problems., or the problems. */
export const checkLine = (page: Page) => page.getByTestId('builder-check')

/**
 * Waits for the `n`th check to come back (drafts are counted from the page's opening), so each
 * step's document is sent before the next step changes it.
 */
export async function checked(page: Page, sent: Sent, n: number): Promise<void> {
  await expect.poll(() => sent.drafts.length).toBe(n)
  await expect(checkLine(page)).not.toHaveText('Checking…')
}

/** An activity's card in the builder, by its key. */
export const card = (page: Page, key: string) =>
  page.locator(`[data-testid="activity-card"][data-activity="${key}"]`)

/** A value's line inside an activity's card: its press opens the line. */
export const valueLine = (page: Page, key: string, field: string) =>
  card(page, key).locator(`[data-testid="value-line"][data-field="${field}"]`)

/**
 * The builder on the beginner 5×5 (`#/programmes/<id>/edit`), checked, with the Deadlift's card
 * open. With `over`, its weekly increase is +90 kg, and week 6 comes to 510 kg.
 */
export async function openEditWithDeadlift(
  page: Page,
  { theme = 'light', over = false }: { theme?: Theme; over?: boolean } = {},
): Promise<Sent> {
  const sent = await openBuilder(page, { hash: `#/programmes/${BEGINNER.id}/edit`, theme })
  await checked(page, sent, 1)
  await card(page, 'deadlift').locator('[data-slot="activity-toggle"]').click()
  if (over) {
    await valueLine(page, 'deadlift', 'weight').locator('> button').click()
    await page.getByTestId('value-amount').fill('90')
    await checked(page, sent, 2)
  }
  await settle(page)
  return sent
}

/** Build a programme, with its first activity added and open (its name not given yet). */
export async function openNewWithActivity(
  page: Page,
  { theme = 'light' }: { theme?: Theme } = {},
): Promise<Sent> {
  const sent = await openBuilder(page, { hash: '#/programmes/new', theme })
  await checked(page, sent, 1)
  await page.getByTestId('builder-name').fill('Squat block')
  await checked(page, sent, 2)
  await page.getByTestId('activity-add').click()
  await checked(page, sent, 3)
  await settle(page)
  return sent
}

/** A row of the open exception week's Rest these activities list (K191), by its name. */
export const restRow = (page: Page, name: string) =>
  page.getByTestId('exception-rest').getByRole('checkbox', { name, exact: true })

/**
 * The builder on the beginner 5×5, with week 3 added as an exception week that rests the legs:
 * Add exception week, the weeks typed as 3, then Back squat and Deadlift ticked under Rest these
 * activities (K191). The exception week stays open; each step is checked as generate.py saved it.
 */
export async function openEditWithLegsRest(
  page: Page,
  { theme = 'light' }: { theme?: Theme } = {},
): Promise<Sent> {
  const sent = await openBuilder(page, { hash: `#/programmes/${BEGINNER.id}/edit`, theme })
  await checked(page, sent, 1)
  await page.getByTestId('exception-add').click()
  const weeks = page.locator('input[data-testid="exception-weeks"]')
  await expect(weeks).toBeFocused()
  await checked(page, sent, 2)
  await weeks.fill('3')
  await checked(page, sent, 3)
  await restRow(page, 'Back squat').click()
  await checked(page, sent, 4)
  await restRow(page, 'Deadlift').click()
  await checked(page, sent, 5)
  await settle(page)
  return sent
}
