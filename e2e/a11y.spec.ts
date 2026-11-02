// Accessibility gate (from the design-system skill's a11y.spec.ts): axe (WCAG 2.2 A and AA, and
// its best practices) on the style guide in both themes, and on the app (signed
// in, /api mocked) in both themes at desktop and phone width; and the focus ring's shape.
//
// The theme is the app's own `.dark` class on <html>, which tokens.css's dark block matches
// (`npm run tokens` passes --dark-selector .dark). The first two tests fail if switching it
// changes nothing, so a "dark" audit can never quietly re-run light.
import { expect, test, type Page } from '@playwright/test'
import {
  callUpBar,
  THEMES,
  canvasToken,
  expectNoAxeViolations,
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

test.describe('dark really is dark', () => {
  test('the style guide', async ({ page }) => {
    await openStyleGuide(page, { theme: 'light' })
    const light = await canvasToken(page)
    await openStyleGuide(page, { theme: 'dark' })
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(
      true,
    )
    expect(await canvasToken(page), '--canvas is identical in both themes').not.toBe(light)
  })

  test('the app', async ({ page, context }) => {
    await openApp(page, { theme: 'light' })
    const light = await canvasToken(page)
    const dark = await context.newPage()
    await openApp(dark, { theme: 'dark' })
    expect(await dark.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(
      true,
    )
    expect(await canvasToken(dark), '--canvas is identical in both themes').not.toBe(light)
  })
})

test.describe('the style guide passes axe', () => {
  for (const theme of THEMES) {
    test(theme, async ({ page }) => {
      await openStyleGuide(page, { theme })
      await expectNoAxeViolations(page)
    })
  }
})

test.describe('the app passes axe', () => {
  for (const theme of THEMES) {
    test(`week view, desktop, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await openApp(page, { theme })
      await expectNoAxeViolations(page)
    })

    test(`week view in Edit plan, desktop, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await openApp(page, { theme })
      await callUpBar(page)
      await page.getByRole('button', { name: 'Edit plan', exact: true }).click()
      await settle(page)
      await expectNoAxeViolations(page)
    })

    test(`the Settings page, desktop, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await openApp(page, { theme })
      await callUpBar(page)
      await page.getByRole('button', { name: /Settings/ }).click()
      await page.getByRole('heading', { level: 1, name: 'Settings' }).waitFor()
      await settle(page)
      await expectNoAxeViolations(page)
    })

    test(`the Ask page with an answer and the history, desktop, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await openAsk(page, theme)
      await expectNoAxeViolations(page)
    })

    test(`the Ask page, its delete question open, desktop, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await openAsk(page, theme)
      await page.getByRole('button', { name: 'Delete all conversations' }).click()
      await page.getByRole('alertdialog').waitFor()
      await settle(page)
      await expectNoAxeViolations(page)
    })

    test(`an item’s page, desktop, notes being edited, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await openApp(page, { theme })
      await page.getByTestId('exercise-grid').getByRole('link', { name: 'Push-ups' }).click()
      await page.getByRole('heading', { level: 1, name: 'Push-ups' }).waitFor()
      await settle(page)
      await expectNoAxeViolations(page)
      await page.getByRole('button', { name: 'Edit notes' }).click()
      await settle(page)
      await expectNoAxeViolations(page)
    })

    test(`the Ask page, 375px, and its history drawer, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 800 })
      await openAsk(page, theme)
      await expectNoAxeViolations(page)
      await page.getByRole('button', { name: 'Show history' }).click()
      await page.getByRole('dialog', { name: 'Conversation history' }).waitFor()
      await settle(page)
      await expectNoAxeViolations(page)
    })

    test(`an item’s page, folded, 390px, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await openApp(page, { theme })
      await page.getByTestId('diet-grid').getByRole('link', { name: 'Vegetables' }).click()
      await page.getByRole('heading', { level: 1, name: 'Vegetables' }).waitFor()
      await settle(page)
      await expectNoAxeViolations(page)
    })

    for (const [width, height, where] of [
      [1280, 900, 'desktop'],
      [390, 844, 'folded, 390px'],
    ] as const) {
      test(`an item’s page while arranging, ${where}, ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height })
        await openApp(page, { theme })
        await page.getByTestId('exercise-grid').getByRole('link', { name: 'Push-ups' }).click()
        await page.getByRole('heading', { level: 1, name: 'Push-ups' }).waitFor()
        await page.getByRole('button', { name: 'Arrange sections' }).click()
        // One section hidden and the first section's Move up at an end, so both looks are checked.
        await page.getByRole('switch', { name: 'Show Details' }).click()
        await settle(page)
        await expectNoAxeViolations(page)
        await expectNoSidewaysScroll(page)
      })
    }

    test(`the folded week, 375px, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 800 })
      await openApp(page, { theme })
      await expect(page.getByTestId('exercise-grid')).toBeVisible()
      await expectNoAxeViolations(page)
    })

    test(`the bar called up, desktop, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await openApp(page, { theme })
      await page.mouse.move(640, 4)
      await expect(page.locator('[data-slot="bar"]')).toHaveAttribute('data-shown', 'true')
      await settle(page)
      await expectNoAxeViolations(page)
    })

    test(`sign-in, ${theme}`, async ({ page }) => {
      await openSignIn(page, theme)
      await expectNoAxeViolations(page)
    })

    test(`create an account, ${theme}`, async ({ page }) => {
      await openSignUp(page, theme)
      await expectNoAxeViolations(page)
    })

    test(`reset your password, before and after sending, ${theme}`, async ({ page }) => {
      await openForgot(page, theme)
      await expectNoAxeViolations(page)
      await page.getByLabel('Email').fill('sam@example.com')
      await page.getByRole('button', { name: 'Send link' }).click()
      await expect(page.getByTestId('forgot-sent')).toBeVisible()
      await settle(page)
      await expectNoAxeViolations(page)
    })

    test(`email confirmed, ${theme}`, async ({ page }) => {
      await openConfirmed(page, theme)
      await expectNoAxeViolations(page)
    })

    test(`the confirm-your-email banner, ${theme}`, async ({ page }) => {
      await openApp(page, { theme, unconfirmed: true })
      await expect(page.getByTestId('email-status')).toBeVisible()
      await expectNoAxeViolations(page)
    })

    test(`create an account with errors showing, ${theme}`, async ({ page }) => {
      await openSignUp(page, theme)
      await page.getByLabel('Email').fill('new@example.com')
      await page.getByLabel('Password', { exact: true }).fill('a long new password')
      await page.getByLabel('Repeat password').fill('something else')
      await page.getByRole('button', { name: 'Create account' }).click()
      await expect(page.locator('#signup-confirm-error')).toBeVisible()
      await settle(page)
      await expectNoAxeViolations(page)
    })
  }
})

/** The focused element's outline, read after the ring's transition has settled. */
async function focusRing(page: Page) {
  await settle(page)
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    const s = getComputedStyle(el)
    return {
      element: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}`,
      ring: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineOffset}`,
    }
  })
}

test.describe('the focus ring is a solid 2px outline at a 2px offset', () => {
  test('on a style guide button', async ({ page }) => {
    await openStyleGuide(page)
    // Reached by the keyboard, so :focus-visible applies as it does for a person tabbing.
    await page.locator('#sg-button-primary-default').focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    expect(await focusRing(page)).toEqual({
      element: 'button#sg-button-primary-default',
      ring: 'solid 2px 2px',
    })
  })

  test('on the app navbar button', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await openApp(page)
    // Tab past the skip link to the first button.
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab')
      if (await page.evaluate(() => document.activeElement?.tagName === 'BUTTON')) break
    }
    const { ring } = await focusRing(page)
    expect(ring).toBe('solid 2px 2px')
  })
})
