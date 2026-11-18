// Programmes (docs/specs/2026-11-17-programmes.md): start one from the Library, pause an activity
// from its item page, then see the pause in the overview and the week; a locked day at phone
// width; axe on the Programmes page and the overview in both themes.
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
const TODAY = new Date('2026-11-12T12:00:00')

/** Where the story is: before the start, started, or with the back squat paused. */
type Phase = 'before' | 'started' | 'paused'

/**
 * Opens the app signed in as alice on Thu 12 Nov 2026, at `hash`, with /api answering from the
 * saved replies for `phase`. Starting and confirming the pause move the phase on, as the server
 * would. Returns the programme and tick requests the app sent, in order.
 */
async function openStory(
  page: Page,
  {
    phase = 'started',
    theme = 'light',
    hash = '',
  }: { phase?: Phase; theme?: Theme; hash?: string },
): Promise<Request[]> {
  const sent: Request[] = []
  let now = phase
  await page.clock.setFixedTime(TODAY)
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const method = req.method()
    const path = new URL(req.url()).pathname.replace(/^\/api/, '')
    const json = (body: unknown, status = 200) => route.fulfill({ json: body, status })
    if (/^\/(programmes|runs|ticks)\b/.test(path)) sent.push(req)
    if (method === 'GET' && path === '/auth/me') return json({ username: 'alice' })
    if (method === 'GET' && path === '/auth/options') return json({ mail: false, ask: false })
    if (method === 'GET' && path === '/state') return json(reply(`state-${now}`))
    if (method === 'GET' && path === '/programmes') return json(reply('library'))
    if (method === 'GET' && path === `/programmes/${PROGRAMME}`) return json(reply('programme'))
    if (method === 'POST' && path === `/programmes/${PROGRAMME}/preview`)
      return json(reply('start-preview'))
    if (method === 'POST' && path === `/programmes/${PROGRAMME}/start`) {
      now = 'started'
      return json(STARTED, 201)
    }
    if (method === 'GET' && path === `/runs/${TRACKER}`)
      return json(reply(now === 'paused' ? 'run-paused' : 'run-started'))
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
  await page.addInitScript((theme) => {
    localStorage.setItem('tracker-session-v1', JSON.stringify({ user: 'alice' }))
    localStorage.setItem('tracker-settings-v1', JSON.stringify({ theme }))
  }, theme)
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
  // The week shows the new tracker, with its "Week 1 of 8" link.
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
  }
})
