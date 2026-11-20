// Phone width (375px): nothing scrolls the page sideways, and the folded week (K26) fits the
// screen, every cell in view as the keyboard walks it.
import { expect, test } from '@playwright/test'
import {
  callUpBar,
  THEMES,
  expectNoSidewaysScroll,
  openApp,
  openAsk,
  openSignIn,
  openSignUp,
  openForgot,
  openConfirmed,
  openStyleGuide,
  settle,
} from './support'
import { openEditWithDeadlift, openEditWithLegsRest, openNewWithActivity } from './builder-support'

test.use({ viewport: { width: 375, height: 800 } })

test.describe('no sideways scroll at 375px', () => {
  for (const theme of THEMES) {
    test(`the style guide, ${theme}`, async ({ page }) => {
      await openStyleGuide(page, { theme })
      await expectNoSidewaysScroll(page)
    })
  }

  test('sign-in', async ({ page }) => {
    await openSignIn(page, 'light')
    await expectNoSidewaysScroll(page)
  })

  test('create an account', async ({ page }) => {
    await openSignUp(page, 'light')
    await expectNoSidewaysScroll(page)
  })

  test('reset your password', async ({ page }) => {
    await openForgot(page, 'light')
    await expectNoSidewaysScroll(page)
  })

  test('email confirmed', async ({ page }) => {
    await openConfirmed(page, 'light')
    await expectNoSidewaysScroll(page)
  })

  test('the app with the confirm-your-email banner', async ({ page }) => {
    await openApp(page, { unconfirmed: true })
    await expect(page.getByTestId('email-status')).toBeVisible()
    await expectNoSidewaysScroll(page)
  })

  test('the app, the folded week', async ({ page }) => {
    await openApp(page)
    await expect(page.getByTestId('exercise-grid')).toBeVisible()
    await expectNoSidewaysScroll(page)
  })

  test('the app, the folded week in Edit plan', async ({ page }) => {
    await openApp(page)
    // A long press opens Edit plan (K80).
    await callUpBar(page)
    await expectNoSidewaysScroll(page)
  })
  for (const theme of THEMES) {
    test(`the Ask page with an answer, and its history drawer, ${theme}`, async ({ page }) => {
      await openAsk(page, theme)
      await expectNoSidewaysScroll(page)
      await page.getByRole('button', { name: 'Show history' }).click()
      await page.getByRole('dialog', { name: 'Conversation history' }).waitFor()
      await settle(page)
      await expectNoSidewaysScroll(page)
    })
  }

  test('the Ask page, empty, with no goals yet', async ({ page }) => {
    await openApp(page, { ask: true })
    await callUpBar(page)
    await page.getByRole('button', { name: 'Ask', exact: true }).click()
    await page.getByText('Your goals in Profile are empty').waitFor()
    await expectNoSidewaysScroll(page)
  })

  test('the Settings page, every tab', async ({ page }) => {
    await openApp(page)
    await callUpBar(page)
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('heading', { level: 1, name: 'Settings' }).waitFor()
    // The four tabs wrap onto two lines rather than scroll sideways (K119).
    const tabs = page.getByRole('tab')
    await expect(tabs).toHaveText(['Appearance', 'Daily goal', 'Your data', 'Connections'])
    const first = (await tabs.first().boundingBox())!
    const last = (await tabs.last().boundingBox())!
    expect(last.y).toBeGreaterThan(first.y)
    for (const name of ['Appearance', 'Daily goal', 'Your data', 'Connections']) {
      await page.getByRole('tab', { name }).click()
      await expect(page.getByRole('heading', { level: 2 })).toHaveText([name])
      await settle(page)
      await expectNoSidewaysScroll(page)
    }
  })

  test('the folded bar with Ask on: no Full screen, and no action overlapping another (K160)', async ({
    page,
  }) => {
    await openApp(page, { ask: true })
    const actions = page.locator('[data-slot="bar"] [data-slot="bar-action"]:visible')
    /** The actions' boxes: each inside the screen, and none over the next on its line. */
    async function expectApart(): Promise<void> {
      const boxes = await actions.evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect()
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
        }),
      )
      const width = page.viewportSize()!.width
      for (const [i, box] of boxes.entries()) {
        expect(box.left).toBeGreaterThanOrEqual(0)
        expect(box.right).toBeLessThanOrEqual(width)
        const next = boxes[i + 1]
        if (next && next.top < box.bottom) expect(next.left).toBeGreaterThanOrEqual(box.right)
      }
    }
    // On the week, focus floats the bar over the screen (K80).
    await page.getByTestId('settings-button').focus()
    await settle(page)
    await expect(actions).toHaveText(['Ask', 'Settings', 'Programmes', 'Profile'])
    await expect(page.getByTestId('fullscreen-button')).toBeHidden()
    await expectApart()
    // Edit plan adds Add tracker (K124), and still fits.
    await page.keyboard.press('Escape')
    await callUpBar(page)
    await expect(actions).toHaveText(['Ask', 'Add tracker', 'Settings', 'Programmes', 'Profile'])
    await expectApart()
    await expectNoSidewaysScroll(page)
  })

  test('the programme builder, new, with an activity open', async ({ page }) => {
    await openNewWithActivity(page)
    await expect(page.getByTestId('activity-name')).toBeVisible()
    await expectNoSidewaysScroll(page)
  })

  test('the programme builder, editing, with an activity open over its limit', async ({ page }) => {
    await openEditWithDeadlift(page, { over: true })
    await expect(page.getByTestId('value-error')).toBeVisible()
    await expectNoSidewaysScroll(page)
  })

  test('the programme builder, an exception week open with its rest list', async ({ page }) => {
    await openEditWithLegsRest(page)
    await expect(page.getByTestId('exception-rest')).toBeVisible()
    await expectNoSidewaysScroll(page)
  })

  test('the profile menu and the Profile page', async ({ page }) => {
    await openApp(page)
    await callUpBar(page)
    await page.getByRole('button', { name: 'Profile' }).click()
    const menu = page.getByRole('menu')
    await menu.waitFor()
    // The menu stays inside the screen, 16px from its edges at most.
    const box = (await menu.boundingBox())!
    const width = page.viewportSize()!.width
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(width)
    await expectNoSidewaysScroll(page)
    await page.getByRole('menuitem', { name: 'Profile' }).click()
    await page.getByRole('heading', { level: 1, name: 'Profile' }).waitFor()
    await expectNoSidewaysScroll(page)
  })
})

test('every cell of the folded week is in view as the keyboard walks it', async ({ page }) => {
  await openApp(page)
  // The skip link lands on today's first mark; then the grid keys (gridNav) walk the week.
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  const keys = ['Home', ...Array<string>(8).fill('ArrowRight'), 'ArrowDown', 'End', 'ArrowUp']
  keys.push('ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Home')

  const steps: string[] = []
  for (const key of ['(skip link)', ...keys]) {
    if (key !== '(skip link)') await page.keyboard.press(key)
    await page.evaluate(() => new Promise(requestAnimationFrame))
    const at = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      if (!el.closest('[data-testid$="-grid"]'))
        return { label: `not in a grid: ${el.tagName}`, ok: false }
      const r = el.getBoundingClientRect()
      const label = el.getAttribute('aria-label') ?? el.textContent!.trim().replace(/\s+/g, ' ')
      const ok = r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.width > 0
      return { label: `${label} left=${Math.round(r.left)} right=${Math.round(r.right)}`, ok }
    })
    steps.push(`${key}: ${at.label}${at.ok ? '' : '  <-- off the screen'}`)
  }
  expect(
    steps.filter((s) => s.includes('<--')),
    steps.join('\n'),
  ).toEqual([])
})
