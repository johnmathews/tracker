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
import { openEditWithDeadlift, openEditWithLegsRest, openNewWithActivity } from './builder-support'

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
      // Its trackers' sections are on the page axe reads (K123, K124): SectionHeader in Edit plan,
      // with its pen, Add and Delete tracker, and the new tracker page with its four kinds.
      const header = page.locator('#sg-section-header')
      await expect(header.getByRole('button', { name: /^Rename / }).first()).toBeVisible()
      await expect(header.getByRole('button', { name: 'Delete tracker' }).first()).toBeVisible()
      const newTracker = page.locator('#sg-new-tracker-page')
      await expect(newTracker.getByRole('button', { name: 'Mobility' }).first()).toBeVisible()
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
      // A long press opens Edit plan (K80).
      await callUpBar(page)
      await expectNoAxeViolations(page)
    })

    test(`another week, View current week in the band and the bar, desktop, ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await openApp(page, { theme })
      await callUpBar(page)
      await page.getByRole('button', { name: 'Next week' }).click()
      await expect(page.getByTestId('this-week-button')).toBeVisible()
      await expectNoAxeViolations(page)
      // Out of Edit plan: the band's own (K130).
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('band-this-week-button')).toBeVisible()
      await expectNoAxeViolations(page)
    })

    test(`the Settings page, every tab, desktop, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await openApp(page, { theme })
      await callUpBar(page)
      await page.getByRole('button', { name: /Settings/ }).click()
      await page.getByRole('heading', { level: 1, name: 'Settings' }).waitFor()
      await settle(page)
      await expectNoAxeViolations(page)
      // A tab per section (K119); each tab's section passes too.
      for (const name of ['Daily goal', 'Your data', 'Connections']) {
        await page.getByRole('tab', { name }).click()
        await page.getByRole('heading', { level: 2, name }).waitFor()
        await settle(page)
        await expectNoAxeViolations(page)
      }
    })

    test(`the profile menu, open, desktop, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await openApp(page, { theme })
      await callUpBar(page)
      await page.getByRole('button', { name: 'Profile' }).click()
      await page.getByRole('menu').waitFor()
      await settle(page)
      await expectNoAxeViolations(page)
    })

    test(`the Profile page, desktop, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await openApp(page, { theme })
      await callUpBar(page)
      await page.getByRole('button', { name: 'Profile' }).click()
      await page.getByRole('menuitem', { name: 'Profile' }).click()
      await page.getByRole('heading', { level: 1, name: 'Profile' }).waitFor()
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

    test(`a cardio item’s page, its pen and Remove, then renaming in Edit plan (K90, K120, K121), ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await openApp(page, { theme })
      await page.getByTestId('cardio-grid').getByRole('link', { name: 'Running' }).click()
      await page.getByRole('heading', { level: 1, name: 'Running' }).waitFor()
      await page.getByTestId('item-remove').waitFor()
      await settle(page)
      await expectNoAxeViolations(page)
      await page.goBack()
      await page.getByTestId('cardio-grid').waitFor()
      await callUpBar(page)
      await page.getByTestId('cardio-grid').getByRole('link', { name: 'Cycling' }).click()
      await page.getByRole('button', { name: 'Rename Cycling' }).click()
      await page.getByRole('textbox', { name: 'Name' }).waitFor()
      await settle(page)
      await expectNoAxeViolations(page)
    })

    test(`the new item page (K104), ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await openApp(page, { theme })
      await callUpBar(page)
      await page.getByTestId('add-exercise').click()
      await page.getByRole('textbox', { name: 'Name' }).waitFor()
      await settle(page)
      await expectNoAxeViolations(page)
    })

    for (const [width, height, where] of [
      [1280, 900, 'desktop'],
      [390, 844, 'folded, 390px'],
    ] as const) {
      test(`the new tracker page (K124), its name asked for, ${where}, ${theme}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height })
        await openApp(page, { theme })
        await callUpBar(page)
        await page.getByTestId('add-tracker-button').click()
        await page.getByRole('heading', { level: 1, name: 'New tracker' }).waitFor()
        await page
          .getByRole('group', { name: 'Kind' })
          .getByRole('button', { name: 'Mobility' })
          .click()
        await settle(page)
        await expectNoAxeViolations(page)
        // Add tracker with no name: the field's error.
        await page.getByTestId('new-tracker-add').click()
        await page.getByText('Enter a name.').waitFor()
        await settle(page)
        await expectNoAxeViolations(page)
      })
    }

    test(`the Delete tracker dialog (K122), desktop, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await openApp(page, { theme })
      await callUpBar(page)
      await page.getByTestId('delete-cardio').click()
      await page.getByRole('alertdialog', { name: 'Delete Cardio?' }).waitFor()
      await settle(page)
      await expectNoAxeViolations(page)
    })

    test(`a tracker being renamed in Edit plan (K124), desktop, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await openApp(page, { theme })
      await callUpBar(page)
      await page.getByTestId('rename-exercise').click()
      await page.getByTestId('name-field-exercise').waitFor()
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

    for (const [width, height, where] of [
      [1280, 900, 'desktop'],
      [390, 844, 'folded, 390px'],
    ] as const) {
      // The programme builder (docs/specs/2026-11-20-programme-builder.md), its /api mocked by
      // builder-support.ts: a new programme with its first activity open and the server asking
      // for its name; a Library programme with the Deadlift open over its limit, its weeks 6 to 8
      // marked in the grid.
      test(`the programme builder, new, an activity open, ${where}, ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height })
        await openNewWithActivity(page, { theme })
        await expect(page.getByTestId('activity-name')).toHaveAttribute('aria-invalid', 'true')
        await expectNoAxeViolations(page)
      })

      test(`the programme builder, editing, an activity open over its limit, ${where}, ${theme}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height })
        await openEditWithDeadlift(page, { theme, over: true })
        await expect(page.getByTestId('value-error')).toBeVisible()
        await expect(page.locator('[data-limit]').first()).toBeAttached()
        await expectNoAxeViolations(page)
      })

      test(`the programme builder, an exception week resting the legs, ${where}, ${theme}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height })
        await openEditWithLegsRest(page, { theme })
        await expect(page.getByTestId('exception-rest')).toBeVisible()
        await expect(page.locator('td[data-rest]')).toHaveCount(2)
        await expectNoAxeViolations(page)
      })
    }

    test(`the folded week, 375px, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 800 })
      await openApp(page, { theme })
      await expect(page.getByTestId('exercise-grid')).toBeVisible()
      await expectNoAxeViolations(page)
    })

    test(`the bar floated over the screen by focus, desktop, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await openApp(page, { theme })
      // Tab reaches "Skip to today", inside the bar, which slides down while focus is in it.
      await page.keyboard.press('Tab')
      await expect(page.getByTestId('skip-to-today')).toBeFocused()
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
