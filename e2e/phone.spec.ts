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
    await callUpBar(page)
    await page.getByRole('button', { name: 'Edit plan', exact: true }).click()
    await settle(page)
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
    await page.getByText('Your goals in Settings are empty').waitFor()
    await expectNoSidewaysScroll(page)
  })

  test('the Settings page', async ({ page }) => {
    await openApp(page)
    await callUpBar(page)
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('heading', { level: 1, name: 'Settings' }).waitFor()
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
