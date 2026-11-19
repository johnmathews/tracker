// Programmes (docs/specs/2026-11-17-programmes.md): start one from the Library, pause an activity
// from its item page, then see the pause in the overview and the week; a locked day at phone
// width; Re-open and Restart on a run ended early (K168); the shared library (K171): a second
// account copies from it, and the admin publishes to it; the work charts (K180) on the overview's
// Work tab and an activity's page; axe on the Programmes page, the overview, its Work tab, the
// shared section, Publish and the Re-open sheet in both themes.
//
// /api is mocked with replies saved from the real API (e2e/fixtures/programmes/generate.py): the
// story runs on Thu 12 Nov 2026, so Monday and Tuesday of its week are locked (spec §8).
import { readFileSync } from 'node:fs'
import { expect, test, type Page, type Request } from '@playwright/test'
import {
  THEMES,
  expectNoAxeViolations,
  expectNoSidewaysScroll,
  settle,
  type Theme,
} from './support'

/** A reply saved by generate.py, as the API sent it. */
function reply(name: string): Record<string, unknown> {
  const url = new URL(`./fixtures/programmes/${name}.json`, import.meta.url)
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>
}

const STARTED = reply('started') as { tracker: { id: string; name: string } }
const TRACKER = STARTED.tracker.id
const PROGRAMME = (reply('library') as { programmes: { id: string }[] }).programmes[0]!.id
const SHARED = (reply('shared') as { programmes: { id: string; name: string }[] }).programmes[0]!
const COPY = reply('bob-copied') as { id: string; name: string }
const TODAY = new Date('2026-11-12T12:00:00')

/**
 * Where the story is: before the start, started, with the back squat paused, or ended early by
 * End programme.
 */
type Phase = 'before' | 'started' | 'paused' | 'ended'

/**
 * Who is signed in: alice, who has no admin flag; alice once she has it, who publishes to the
 * shared library; or bob, a second account with an empty library and no flag.
 */
type Account = 'alice' | 'admin' | 'bob'

/** Each account's `GET /api/auth/me`, the run-wide replies, and its library before a write. */
const ACCOUNTS = {
  alice: { me: 'me', library: 'library', state: null },
  admin: { me: 'me-admin', library: 'library-admin', state: null },
  bob: { me: 'bob-me', library: 'bob-library', state: 'bob-state' },
} as const

/** The methods the API refuses without a JSON Content-Type (app.py's `rest_refusal`). */
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Opens the app signed in as `account` on Thu 12 Nov 2026, at `hash`, with /api answering from
 * the saved replies for `phase`. Starting, confirming the pause, re-opening, publishing and
 * copying move the story on, as the server would. A write without a JSON Content-Type gets 415,
 * as the server answers it. Returns the programme, run, shared library and tick requests the app
 * sent, in order.
 */
async function openStory(
  page: Page,
  {
    phase = 'started',
    theme = 'light',
    hash = '',
    account = 'alice',
  }: { phase?: Phase; theme?: Theme; hash?: string; account?: Account },
): Promise<Request[]> {
  const sent: Request[] = []
  const who = ACCOUNTS[account]
  const me = reply(who.me) as { username: string }
  let now = phase
  let reopened = false
  let published = false
  let copied = false
  await page.clock.setFixedTime(TODAY)
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const method = req.method()
    const path = new URL(req.url()).pathname.replace(/^\/api/, '')
    const json = (body: unknown, status = 200) => route.fulfill({ json: body, status })
    if (/^\/(programmes|runs|ticks|shared-programmes)\b/.test(path)) sent.push(req)
    if (WRITES.has(method) && req.headers()['content-type']?.split(';')[0] !== 'application/json')
      return json({ error: 'content-type' }, 415)
    if (method === 'GET' && path === '/auth/me') return json(me)
    if (method === 'GET' && path === '/auth/options') return json({ mail: false, ask: false })
    if (method === 'GET' && path === '/state') return json(reply(who.state ?? `state-${now}`))
    if (method === 'GET' && path === '/programmes') {
      if (copied) return json(reply('bob-library-copied'))
      return json(reply(published ? 'library-published' : who.library))
    }
    if (method === 'GET' && path === '/shared-programmes') {
      // The story's shared library is empty until the admin publishes; bob comes after that.
      const shared = account === 'bob' || published
      return json(reply(shared ? 'shared' : 'shared-before'))
    }
    if (method === 'GET' && path === `/shared-programmes/${SHARED.id}/preview`)
      return json(reply('bob-shared-preview'))
    if (method === 'POST' && path === `/shared-programmes/${SHARED.id}/copy`) {
      copied = true
      return json(COPY, 201)
    }
    if (method === 'POST' && path === `/programmes/${PROGRAMME}/publish`) {
      if (account !== 'admin') return json({ error: 'not-admin' }, 403)
      const body = req.postDataJSON() as { preview?: boolean }
      if (body.preview !== false) return json(reply('publish-preview'))
      published = true
      return json(reply('published'))
    }
    if (method === 'GET' && path === `/programmes/${PROGRAMME}`) return json(reply('programme'))
    if (method === 'POST' && path === `/programmes/${PROGRAMME}/preview`)
      return json(reply('start-preview'))
    if (method === 'POST' && path === `/programmes/${PROGRAMME}/start`) {
      now = 'started'
      return json(STARTED, 201)
    }
    if (method === 'GET' && path === `/runs/${TRACKER}`) {
      if (reopened) return json((reply('reopened') as { run: unknown }).run)
      return json(reply(`run-${now === 'before' ? 'started' : now}`))
    }
    if (method === 'POST' && path === `/runs/${TRACKER}/reopen`) {
      const body = req.postDataJSON() as { preview?: boolean }
      if (body.preview !== false) return json(reply('reopen-preview'))
      reopened = true
      return json(reply('reopened'))
    }
    if (method === 'POST' && path === `/runs/${TRACKER}/restart`) {
      const body = req.postDataJSON() as { preview?: boolean }
      return json(reply(body.preview !== false ? 'restart-preview' : 'restarted'))
    }
    if (method === 'POST' && path === `/runs/${TRACKER}/changes`) {
      const body = req.postDataJSON() as { change: { type: string }; preview?: boolean }
      if (body.change.type === 'set-value') return json(reply('value-preview'))
      if (body.preview !== false) return json(reply('pause-preview'))
      now = 'paused'
      return json(reply('pause-applied'))
    }
    if (method === 'GET' && path === '/tokens') return json({ tokens: [] })
    if (method === 'GET' && path === '/connections') return json({ connections: [] })
    if (method === 'PUT') return json({ rev: 1 })
    return json({})
  })
  await page.addInitScript(
    ({ theme, user }) => {
      localStorage.setItem('tracker-session-v1', JSON.stringify({ user }))
      localStorage.setItem('tracker-settings-v1', JSON.stringify({ theme }))
    },
    { theme, user: me.username },
  )
  await page.goto(`/${hash}`)
  await page.waitForSelector(
    hash
      ? '[data-testid$="-page"], [data-testid="programme-overview"]'
      : '[data-testid="exercise-grid"]',
  )
  await settle(page)
  return sent
}

/** The programme tracker's week: its grid, which the planner shows after the first three. */
const week = (page: Page) => page.getByTestId(`${TRACKER}-grid`)

test('starts a programme from the Library, and its overview opens', async ({ page }) => {
  const sent = await openStory(page, { phase: 'before', hash: '#/programmes' })
  await page.getByTestId('programmes-tab-library').click()
  const programme = page.locator(`[data-testid="library-programme"][data-programme="${PROGRAMME}"]`)
  await expect(programme).toContainText('Beginner 5×5')
  await programme.getByTestId('library-start').click()
  const start = page.getByTestId('programme-start')
  await expect(start.getByTestId('start-name')).toHaveValue('Beginner 5×5')
  await expect(start.getByTestId('start-date')).toHaveValue('2026-11-12')
  // The plan the start would write, from the server (P4).
  await expect(start.getByTestId('start-preview').getByTestId('programme-grid')).toBeVisible()
  await start.getByTestId('start-confirm').click()
  await expect(page).toHaveURL(new RegExp(`#/programme/${TRACKER}$`))
  await expect(page.getByTestId('programme-meta')).toContainText('Week 1 of 8')
  const starts = sent.filter((r) => r.url().endsWith(`/programmes/${PROGRAMME}/start`))
  expect(starts.map((r) => r.postDataJSON())).toEqual([
    { name: 'Beginner 5×5', start: '2026-11-12', params: { squat: 40, rate: 5 } },
  ])
  // Opened from the Programmes page, the overview goes back there (K161), and the page's Back
  // goes on to the week, which shows the new tracker with its "Week 1 of 8" link.
  await expect(page.getByTestId('back-to-week')).toHaveCount(0)
  await page.getByTestId('back-to-programmes').click()
  await expect(page).toHaveURL(/#\/programmes$/)
  await expect(page.getByTestId('programmes-page')).toBeVisible()
  await page.getByTestId('back-to-week').click()
  await expect(page.getByTestId('programme-week-link')).toHaveText('Week 1 of 8')
})

test('pauses an activity from its page, then the overview and the week show the pause', async ({
  page,
}) => {
  const sent = await openStory(page, { hash: `#/item/${TRACKER}/squat` })
  const changes = () => sent.filter((r) => r.url().endsWith(`/runs/${TRACKER}/changes`))
  await page.getByTestId('activity-pause').click()
  const sheet = page.getByTestId('change-sheet')
  await expect(sheet).toHaveAttribute('data-step', '1')
  await sheet.getByTestId('change-weeks').fill('2')
  await sheet.getByTestId('change-reason').fill('Knee')
  await sheet.getByTestId('change-preview-button').click()
  // The preview first: nothing is applied before Confirm change (P2).
  await expect(sheet).toHaveAttribute('data-step', '2')
  await expect(sheet.getByTestId('change-preview-week').first()).toBeVisible()
  expect(changes().map((r) => r.postDataJSON())).toEqual([
    {
      change: { type: 'pause-activity', activity: 'squat', weeks: 2 },
      from: '2026-11-12',
      reason: 'Knee',
      preview: true,
    },
  ])
  await sheet.getByTestId('change-confirm').click()
  await expect(sheet).toBeHidden()
  const rev = (reply('pause-preview') as { rev: string }).rev
  expect(changes()[1]!.postDataJSON()).toMatchObject({ preview: false, rev })

  // The overview: the squat's cells in weeks 1 and 2 are paused, and the Changes tab has the pause.
  await page.goto(`/#/programme/${TRACKER}`)
  const cell = (w: number) => page.locator(`td[data-activity="squat"][data-week="${w}"]`)
  await expect(cell(1)).toHaveAttribute('data-cell', 'paused')
  await expect(cell(2)).toHaveAttribute('data-cell', 'paused')
  await page.getByTestId('programme-tab-changes').click()
  await expect(page.getByTestId('programme-change').first()).toContainText('Knee')

  // The week: the paused row's sentence in place of its boxes, and "Week 1 of 8".
  await page.getByTestId('back-to-week').click()
  await expect(page.getByTestId('programme-week-link')).toHaveText('Week 1 of 8')
  await expect(week(page).getByTestId('paused-row')).toHaveText('Paused until Thu 26 Nov. Knee.')
})

test('keeps focus on the preview bar after Show it in the plan', async ({ page }) => {
  await openStory(page, { hash: `#/programme/${TRACKER}` })
  await page.locator('td[data-activity="bench"][data-week="3"] button').click()
  await page.getByRole('menuitem', { name: 'Change from here' }).click()
  const sheet = page.getByTestId('change-sheet')
  await sheet.getByTestId('change-value').fill('45')
  await sheet.getByTestId('change-preview-button').click()
  await expect(sheet).toHaveAttribute('data-step', '2')
  await sheet.getByTestId('change-show-in-plan').click()
  await expect(sheet).toBeHidden()
  const bar = page.getByTestId('change-preview-bar')
  await expect(bar).toContainText('Previewing a change.')
  await expect(page.locator('td[data-activity="bench"][data-week="3"]')).toHaveAttribute(
    'data-cell',
    'changed',
  )
  // Once the sheet has gone and its focus scope has handed focus back, the bar still has it.
  await expect(sheet).toHaveCount(0)
  await settle(page)
  expect(await bar.evaluate((el) => el === document.activeElement)).toBe(true)
})

/** The Programmes page's Library tab, as `account` sees it. */
async function openLibrary(page: Page, account: Account, theme: Theme = 'light') {
  const sent = await openStory(page, { phase: 'started', account, theme, hash: '#/programmes' })
  await page.getByTestId('programmes-tab-library').click()
  return sent
}

/** A row of the account's own library. */
const libraryRow = (page: Page, id: string) =>
  page.locator(`[data-testid="library-programme"][data-programme="${id}"]`)

test('a second account copies from the shared library, and sees no publishing', async ({
  page,
}) => {
  const sent = await openLibrary(page, 'bob')
  const library = page.getByTestId('programmes-library')
  await expect(library).toContainText('The library is empty.')
  // The shared programmes have a tab of their own, Reference (K177).
  await expect(library.getByTestId('shared-library')).toHaveCount(0)
  await page.getByTestId('programmes-tab-reference').click()
  const section = page.getByTestId('shared-library')
  await expect(section.getByRole('list', { name: 'Reference' })).toBeVisible()
  const shared = section.locator(`[data-testid="shared-programme"][data-shared="${SHARED.id}"]`)
  await expect(shared).toContainText(SHARED.name)
  await expect(shared).toContainText('Strength · 8 weeks · 5 activities')

  // Copy to library asks first (K172); Cancel copies nothing.
  const copyButton = shared.getByTestId('shared-copy')
  await copyButton.click()
  const question = page.getByRole('alertdialog', { name: `Copy ${SHARED.name} to your library?` })
  await expect(question).toContainText('The copy is yours to change and start.')
  await question.getByRole('button', { name: 'Cancel' }).click()
  await expect(question).toBeHidden()
  await copyButton.click()
  await question.getByRole('button', { name: 'Copy', exact: true }).click()
  // The copy lands in Library, so that tab opens (K177).
  await expect(page.getByTestId('programmes-tab-library')).toHaveAttribute('aria-selected', 'true')
  const copy = libraryRow(page, COPY.id)
  await expect(copy).toContainText(COPY.name)
  // It lands (K174): the page scrolls to the copy, focus is on its name, and its tile lets go.
  await expect(copy).toBeInViewport()
  await expect(copy.getByRole('heading', { name: COPY.name })).toBeFocused()
  await expect(copy).toHaveAttribute('data-landing', '')
  await expect(copy).not.toHaveAttribute('data-landing', /.*/, { timeout: 4000 })
  const copies = sent.filter((r) => r.url().endsWith(`/shared-programmes/${SHARED.id}/copy`))
  expect(copies).toHaveLength(1)
  await page.getByTestId('programmes-tab-reference').click()
  await expect(copyButton).toHaveText('Added to library')
  await page.getByTestId('programmes-tab-library').click()
  // Publishing is the admin's: no More menu, no Shared chip, no Publish anywhere.
  await expect(copy.getByTestId('library-start')).toBeVisible()
  await expect(page.getByTestId('library-more')).toHaveCount(0)
  await expect(page.getByTestId('library-shared')).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: /Publish/ })).toHaveCount(0)
  expect(sent.filter((r) => r.url().includes('/publish'))).toEqual([])
})

test('the page sits in a centred column on a wide screen (K176)', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await openLibrary(page, 'bob')
  const box = (await page.getByTestId('programmes-page').boundingBox())!
  const left = box.x
  const right = 1920 - (box.x + box.width)
  expect(Math.abs(left - right)).toBeLessThan(2)
  // u is min(1920 / 1280, 1080 / 800) = 1.35, so the column is 960 × 1.35 = 1296 wide.
  expect(Math.abs(box.width - 1296)).toBeLessThan(2)
})

test('Preview opens a shared programme in a Dialog, and copies from there (K173)', async ({
  page,
}) => {
  const sent = await openLibrary(page, 'bob')
  await page.getByTestId('programmes-tab-reference').click()
  const shared = page.locator(`[data-testid="shared-programme"][data-shared="${SHARED.id}"]`)
  await shared.getByTestId('shared-preview-open').click()
  const dialog = page.getByRole('dialog', { name: SHARED.name })
  await expect(dialog).toBeVisible()
  // On a wide screen it takes the width less 48px each side (K175).
  const box = (await dialog.boundingBox())!
  expect(box.width).toBeGreaterThan(page.viewportSize()!.width - 96 - 2)
  await expect(dialog).toContainText('Strength · 8 weeks · 5 activities')
  await expect(dialog.getByTestId('shared-preview-line')).toContainText(
    'Eight weeks, at the programme’s own values.',
  )
  // The plan by programme week, with no dates: a copy takes its own start day.
  const grid = dialog.getByTestId('programme-grid')
  await expect(grid.locator('th[data-week="1"]')).toContainText('Week 1')
  await expect(grid.locator('th[data-week="1"]')).not.toContainText('Nov')
  await expect(dialog.getByTestId('shared-activity')).toHaveCount(5)
  // Nothing is written until Copy to library, which copies without the row's question.
  expect(sent.filter((r) => r.method() !== 'GET')).toEqual([])
  await dialog.getByTestId('shared-preview-copy').click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.getByTestId('programmes-tab-library')).toHaveAttribute('aria-selected', 'true')
  await expect(libraryRow(page, COPY.id)).toBeInViewport()
  await expect(libraryRow(page, COPY.id).getByRole('heading', { name: COPY.name })).toBeFocused()
  // Opened again, it says the library already has one.
  await page.getByTestId('programmes-tab-reference').click()
  await expect(shared.getByTestId('shared-copy')).toHaveText('Added to library')
  await shared.getByTestId('shared-preview-open').click()
  await expect(dialog.getByTestId('shared-preview-warning')).toContainText(
    `Your library already has a programme called ${SHARED.name}.`,
  )
})

test('the admin publishes a programme from its More menu, after the preview', async ({ page }) => {
  const sent = await openLibrary(page, 'admin')
  const row = libraryRow(page, PROGRAMME)
  await expect(row.getByTestId('library-shared')).toHaveCount(0)
  await row.getByTestId('library-more').click()
  await expect(page.getByRole('menuitem', { name: 'Unpublish' })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Publish' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Publish Beginner 5×5' })).toBeVisible()
  const preview = dialog.getByTestId('publish-preview')
  await expect(preview.getByRole('heading', { name: 'What everyone will see' })).toBeVisible()
  await expect(preview).toContainText('Strength · 8 weeks · 5 activities')
  await expect(preview.getByTestId('shared-activity')).toHaveCount(5)
  await expect(dialog.getByTestId('publish-who')).toHaveText(
    'Everyone with an account can see and copy it. Your name is not shown.',
  )
  await expect(dialog.getByTestId('publish-replaces')).toHaveCount(0)
  const publishes = () => sent.filter((r) => r.url().endsWith(`/programmes/${PROGRAMME}/publish`))
  // The preview first: nothing is shared before Publish programme (P2).
  expect(publishes().map((r) => r.postDataJSON())).toEqual([{ preview: true }])

  await dialog.getByRole('button', { name: 'Publish programme' }).click()
  await expect(dialog).toBeHidden()
  const rev = (reply('publish-preview') as { rev: string }).rev
  expect(publishes()[1]!.postDataJSON()).toEqual({ preview: false, rev })
  await expect(row.getByTestId('library-shared')).toHaveText('Published')
  await expect(page.getByText('Beginner 5×5 is in Reference.')).toBeVisible()
  // The shared library is read again, so Reference shows the new snapshot.
  await page.getByTestId('programmes-tab-reference').click()
  await expect(page.getByTestId('shared-programme')).toContainText(SHARED.name)
  await page.getByTestId('programmes-tab-library').click()
  // A shared row's menu offers Publish again and Unpublish instead.
  await row.getByTestId('library-more').click()
  await expect(page.getByRole('menuitem', { name: 'Publish again' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Unpublish' })).toBeVisible()
})

test('a run ended early offers Re-open and Restart, and Re-open previews first', async ({
  page,
}) => {
  const sent = await openStory(page, { phase: 'ended', hash: `#/programme/${TRACKER}` })
  const controls = page.getByTestId('programme-controls')
  await expect(controls.getByTestId('programme-reopen')).toHaveText('Re-open programme')
  await expect(controls.getByTestId('programme-restart')).toHaveText('Restart from week 1')
  await expect(controls.getByTestId('programme-end')).toHaveCount(0)

  await controls.getByTestId('programme-reopen').click()
  const sheet = page.getByTestId('run-sheet')
  await expect(sheet).toHaveAttribute('data-action', 'reopen')
  await expect(sheet).toHaveAttribute('data-step', '1')
  await expect(sheet.getByTestId('run-step')).toHaveText('Step 1 of 2')
  await expect(sheet.getByTestId('run-from')).toHaveValue('2026-11-12')
  await sheet.getByTestId('run-reason').fill('Back at it')
  await sheet.getByTestId('run-preview-button').click()
  await expect(sheet).toHaveAttribute('data-step', '2')
  await expect(sheet.getByTestId('run-summary')).toBeFocused()
  await expect(sheet.getByTestId('run-preview-row').first()).toBeVisible()
  const reopens = () => sent.filter((r) => r.url().endsWith(`/runs/${TRACKER}/reopen`))
  expect(reopens().map((r) => r.postDataJSON())).toEqual([
    { from: '2026-11-12', reason: 'Back at it', preview: true },
  ])

  await sheet.getByTestId('run-confirm').click()
  await expect(sheet).toBeHidden()
  const rev = (reply('reopen-preview') as { rev: string }).rev
  expect(reopens()[1]!.postDataJSON()).toEqual({
    from: '2026-11-12',
    reason: 'Back at it',
    preview: false,
    rev,
  })
  // Running again: End programme is back, and Re-open has gone.
  await expect(controls.getByTestId('programme-end')).toBeVisible()
  await expect(controls.getByTestId('programme-reopen')).toHaveCount(0)
})

test('Restart from week 1 previews the new tracker before it starts', async ({ page }) => {
  const sent = await openStory(page, { phase: 'ended', hash: `#/programme/${TRACKER}` })
  await page.getByTestId('programme-restart').click()
  const sheet = page.getByTestId('run-sheet')
  await expect(sheet).toHaveAttribute('data-action', 'restart')
  await expect(sheet.getByTestId('run-name')).toHaveValue('Beginner 5×5')
  await expect(sheet.getByTestId('run-start')).toHaveValue('2026-11-12')
  await sheet.getByTestId('run-preview-button').click()
  await expect(sheet).toHaveAttribute('data-step', '2')
  await expect(sheet.getByTestId('run-summary')).toContainText('A new Beginner 5×5, from week 1')
  const restarts = sent.filter((r) => r.url().endsWith(`/runs/${TRACKER}/restart`))
  expect(restarts.map((r) => r.postDataJSON())).toEqual([
    { name: 'Beginner 5×5', start: '2026-11-12', preview: true },
  ])
})

test('the Work tab shows the whole programme, then a chart per activity (K180)', async ({
  page,
}) => {
  await openStory(page, { hash: `#/programme/${TRACKER}` })
  await expect(page.getByRole('tab')).toHaveText(['Plan', 'Work', 'Changes'])
  await page.getByTestId('programme-tab-work').click()
  const work = page.getByTestId('programme-work')
  await expect(work.getByRole('heading', { level: 2 })).toHaveText([
    'The whole programme',
    'By activity',
  ])
  await expect(work.getByTestId('work-total-line')).toHaveText(
    /^Week 1: [\d,]+ kg of [\d,]+ kg planned\. [\d,]+ kg done so far\.$/,
  )
  await expect(work.getByTestId('work-left-out')).toHaveText(
    'Plank has no weight, so it is not in the total.',
  )
  const total = work.getByTestId('work-total')
  const chart = total.getByTestId('work-chart')
  await expect(chart).toHaveAttribute('height', '300')
  await expect(chart.locator('rect[data-planned]')).toHaveCount(8)
  await expect(chart.locator('text[data-current]')).toHaveText('Wk 1')
  await expect(chart.locator('rect[data-band]')).toHaveCount(1)
  await expect(work.getByTestId('work-activity').locator('h3')).toHaveText([
    'Back squat',
    'Bench press',
    'Barbell row',
    'Deadlift',
    'Plank, seconds held',
  ])
  await expect(work.getByTestId('work-activity-line').last()).toHaveText(
    /^Week 1: [\d,]+ s of [\d,]+ s planned\.$/,
  )
  // Two to a row on a wide screen.
  const tops = await work
    .getByTestId('work-activity')
    .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
  expect(tops[1]).toBe(tops[0])
  expect(tops[2]).toBeGreaterThan(tops[0]!)
  // Pointing at a week shows its numbers.
  await chart.locator('rect[data-hit]').first().hover()
  await expect(total.getByTestId('work-chart-tip')).toBeVisible()
  await expect(total.getByTestId('work-chart-tip')).toContainText('Week 1 ·')
})

test('an activity’s page shows its work under the step chart (K180)', async ({ page }) => {
  await openStory(page, { hash: `#/item/${TRACKER}/plank` })
  const section = page.getByTestId('activity-work')
  await expect(section.getByRole('heading', { name: 'Work' })).toBeVisible()
  await expect(section.getByTestId('activity-work-line')).toHaveText(
    /^Week 1: [\d,]+ s of [\d,]+ s planned\.$/,
  )
  await expect(section.getByTestId('work-chart')).toHaveAttribute('height', '200')
  await expect(section.locator('text[data-unit]')).toHaveText('s')
})

test.describe('at phone width', () => {
  test.use({ viewport: { width: 375, height: 800 } })

  test('a locked day doesn’t press, and nothing scrolls sideways', async ({ page }) => {
    const sent = await openStory(page, { phase: 'paused' })
    const monday = week(page).locator('button[data-slot="day-mark-button"][aria-disabled="true"]')
    await expect(monday.first()).toBeVisible()
    // Monday and Tuesday are before yesterday: each row's two boxes are locked.
    const unpaused = 4
    await expect(monday).toHaveCount(2 * unpaused)
    const box = monday.first()
    const pressed = await box.getAttribute('aria-pressed')
    await box.scrollIntoViewIfNeeded()
    // A real press: `force`, since Playwright waits for an aria-disabled button to enable.
    await box.click({ force: true })
    await settle(page)
    await expect(box).toHaveAttribute('aria-pressed', pressed ?? 'false')
    expect(sent.filter((r) => r.url().includes('/ticks/'))).toEqual([])
    await expectNoSidewaysScroll(page)
  })

  test('the overview scrolls sideways inside its table, not the page', async ({ page }) => {
    await openStory(page, { phase: 'paused', hash: `#/programme/${TRACKER}` })
    await expect(page.getByTestId('programme-grid')).toBeVisible()
    await expectNoSidewaysScroll(page)
  })

  test('the Work tab has one chart to a row, and nothing scrolls sideways', async ({ page }) => {
    await openStory(page, { hash: `#/programme/${TRACKER}` })
    await page.getByTestId('programme-tab-work').click()
    await expect(page.getByTestId('work-total')).toBeVisible()
    const tops = await page
      .getByTestId('work-activity')
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
    expect(tops[1]).toBeGreaterThan(tops[0]!)
    await expectNoSidewaysScroll(page)
  })
})

test.describe('axe', () => {
  for (const theme of THEMES) {
    test(`the Programmes page, opened to start, ${theme}`, async ({ page }) => {
      await openStory(page, { phase: 'before', theme, hash: '#/programmes' })
      await page.getByTestId('programmes-tab-library').click()
      await page.getByTestId('library-start').click()
      await expect(page.getByTestId('start-preview').getByTestId('programme-grid')).toBeVisible()
      await settle(page)
      await expectNoAxeViolations(page)
    })

    test(`the overview, with a paused activity, ${theme}`, async ({ page }) => {
      await openStory(page, { phase: 'paused', theme, hash: `#/programme/${TRACKER}` })
      await expect(page.getByTestId('programme-grid')).toBeVisible()
      await expectNoAxeViolations(page)
    })

    test(`the overview's Work tab, ${theme}`, async ({ page }) => {
      await openStory(page, { theme, hash: `#/programme/${TRACKER}` })
      await page.getByTestId('programme-tab-work').click()
      await expect(page.getByTestId('work-total')).toBeVisible()
      await settle(page)
      await expectNoAxeViolations(page)
    })

    test(`the Reference tab, ${theme}`, async ({ page }) => {
      await openLibrary(page, 'bob', theme)
      await page.getByTestId('programmes-tab-reference').click()
      await expect(page.getByTestId('shared-programme')).toBeVisible()
      await settle(page)
      await expectNoAxeViolations(page)
    })

    test(`a shared programme's Preview, ${theme}`, async ({ page }) => {
      await openLibrary(page, 'bob', theme)
      await page.getByTestId('programmes-tab-reference').click()
      await page.getByTestId('shared-preview-open').first().click()
      await expect(page.getByTestId('shared-preview')).toBeVisible()
      await settle(page)
      await expectNoAxeViolations(page)
    })

    test(`Publish, on its preview, ${theme}`, async ({ page }) => {
      await openLibrary(page, 'admin', theme)
      await page.getByTestId('library-more').click()
      await page.getByRole('menuitem', { name: 'Publish' }).click()
      await expect(page.getByTestId('publish-preview')).toBeVisible()
      await settle(page)
      await expectNoAxeViolations(page)
    })

    test(`the Re-open sheet, at each step, ${theme}`, async ({ page }) => {
      await openStory(page, { phase: 'ended', theme, hash: `#/programme/${TRACKER}` })
      await page.getByTestId('programme-reopen').click()
      const sheet = page.getByTestId('run-sheet')
      await expect(sheet.getByTestId('run-from')).toBeVisible()
      await settle(page)
      await expectNoAxeViolations(page)
      await sheet.getByTestId('run-preview-button').click()
      await expect(sheet).toHaveAttribute('data-step', '2')
      await settle(page)
      await expectNoAxeViolations(page)
    })
  }
})
