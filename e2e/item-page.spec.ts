// An item's own page (ItemPage card, K64; rows like Settings, K65): pressing a name opens it, by
// the pointer or by Enter on its cell (F9); its notes save as you type and show on every week;
// Back returns to the week with focus on the name; nothing scrolls sideways on a phone.
import { expect, test, type Page } from '@playwright/test'
import { expectNoSidewaysScroll, openApp, settle } from './support'

const grid = (page: Page) => page.getByTestId('exercise-grid')
const nameOf = (page: Page, name: string) => grid(page).getByRole('link', { name, exact: true })

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('a press on a name opens its page, and Back returns with focus on the name', async ({
    page,
  }) => {
    await openApp(page)
    await nameOf(page, 'Push-ups').click()
    await expect(page).toHaveURL(/#\/item\/exercise\/pu$/)
    const h1 = page.getByRole('heading', { level: 1, name: 'Push-ups' })
    await expect(h1).toBeFocused()
    await expect(page.getByText('Exercise', { exact: true })).toBeVisible()
    await expect(page.getByTestId('item-chip')).toHaveText(['3 × 12'])
    // Layout A (K65): rows like Settings, in the order This week's plan, Notes, Details, Recent
    // weeks (K104); each heading in the week's 320u name column, its content to the right of it.
    const heads = page.getByRole('heading', { level: 2 })
    await expect(heads).toHaveText(['This week’s plan', 'Notes', 'Details', 'Recent weeks'])
    const boxes = await Promise.all((await heads.all()).map(async (h) => (await h.boundingBox())!))
    for (const [i, box] of boxes.entries()) {
      expect(Math.abs(box.x - boxes[0]!.x)).toBeLessThan(2)
      if (i) expect(box.y).toBeGreaterThan(boxes[i - 1]!.y)
    }
    // u is 1 at 1280×800: the name column is 320px, so the content starts 320px from the heading.
    const lede = (await page.getByTestId('item-plan-line').boundingBox())!
    const planHead = boxes[0]!
    expect(Math.abs(lede.x - planHead.x - 320)).toBeLessThan(2)
    expect(Math.abs(lede.y - planHead.y)).toBeLessThan(12)
    // No bar on this page.
    await expect(page.locator('[data-slot="bar"]')).toHaveCount(0)

    await page.getByRole('link', { name: 'Back to the week' }).click()
    await expect(page).not.toHaveURL(/#\/item/)
    await expect(nameOf(page, 'Push-ups')).toBeFocused()
  })

  test('Enter on a name’s cell opens its page in one press', async ({ page }) => {
    await openApp(page)
    // Today's first mark is the grid's tab stop; Home goes to the row's name.
    await grid(page)
      .getByRole('button', { name: /^Push-ups, Wednesday 21 October/ })
      .focus()
    await page.keyboard.press('Home')
    await expect(nameOf(page, 'Push-ups')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { level: 1, name: 'Push-ups' })).toBeFocused()
    // The browser's Back agrees with the page's.
    await page.goBack()
    await expect(nameOf(page, 'Push-ups')).toBeFocused()
  })

  test('a note typed on the page shows in the row on every week', async ({ page }) => {
    await openApp(page)
    await nameOf(page, 'Squats').click()
    await page.getByRole('button', { name: 'Add notes' }).click()
    const field = page.getByRole('textbox', { name: 'Notes' })
    await expect(field).toBeFocused()
    await field.fill('Knees **out**, chest up.')
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByTestId('item-notes-body').locator('strong')).toHaveText('out')
    await page.getByRole('link', { name: 'Back to the week' }).click()
    const note = grid(page)
      .getByRole('row', { name: /Squats/ })
      .getByTestId('item-note')
    await expect(note).toHaveText('Knees out, chest up.')
  })

  test('a plan change on the page shows in this week’s row', async ({ page }) => {
    await openApp(page)
    await nameOf(page, 'Squats').click()
    await page.getByLabel('Sets').fill('5')
    await page.getByRole('link', { name: 'Back to the week' }).click()
    await expect(
      grid(page)
        .getByRole('row', { name: /Squats/ })
        .getByTestId('item-detail'),
    ).toHaveText(['5 × 15', '16 kg'])
  })

  test('recent weeks match the log', async ({ page }) => {
    await openApp(page)
    await nameOf(page, 'Pull-ups').click()
    const weeks = page.getByRole('list', { name: 'Recent weeks' }).getByRole('listitem')
    // The plan starts this week, so only this week shows: two marks of a goal of three.
    await expect(weeks).toHaveCount(1)
    await expect(weeks.first()).toHaveAttribute('aria-current', 'date')
    await expect(weeks.first().getByTestId('recent-week-count')).toHaveText('2 of 3')
  })

  test('prints its head, notes and details only', async ({ page }) => {
    await openApp(page)
    await nameOf(page, 'Push-ups').click()
    await page.emulateMedia({ media: 'print' })
    await expect(page.getByTestId('item-notes-body')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to the week' })).toBeHidden()
    await expect(page.getByTestId('item-plan')).toBeHidden()
    await expect(page.getByTestId('item-weeks')).toBeHidden()
    await expect(page.getByTestId('item-details')).toBeVisible()
  })
})

test.describe('arranging the sections (K66)', () => {
  test.use({ viewport: { width: 1280, height: 800 } })
  const heads = (page: Page) => page.getByRole('heading', { level: 2 })

  test('by keyboard: hide Details and move Recent weeks to the top, for every exercise', async ({
    page,
  }) => {
    const server = await openApp(page)
    await nameOf(page, 'Push-ups').click()
    const arrange = page.getByRole('button', { name: 'Arrange sections' })
    await arrange.focus()
    await page.keyboard.press('Enter')
    const done = page.getByRole('button', { name: 'Done' })
    await expect(done).toBeFocused()
    await expect(heads(page)).toHaveText(['This week’s plan', 'Notes', 'Details', 'Recent weeks'])

    // Show by Space: the switch keeps focus and turns off.
    const details = page.getByRole('switch', { name: 'Show Details' })
    await details.focus()
    await page.keyboard.press('Space')
    await expect(details).toHaveAttribute('aria-checked', 'false')
    await expect(details).toBeFocused()

    // Move up by Enter, three times: focus stays on the button, then moves to Move down at the top.
    const up = page.getByRole('button', { name: 'Move Recent weeks up' })
    await up.focus()
    await page.keyboard.press('Enter')
    await expect(heads(page)).toHaveText(['This week’s plan', 'Notes', 'Recent weeks', 'Details'])
    await expect(up).toBeFocused()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect(heads(page)).toHaveText(['Recent weeks', 'This week’s plan', 'Notes', 'Details'])
    await expect(up).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByRole('button', { name: 'Move Recent weeks down' })).toBeFocused()

    // Escape leaves arranging, with focus back on the button.
    await page.keyboard.press('Escape')
    await expect(arrange).toBeFocused()
    await expect(heads(page)).toHaveText(['Recent weeks', 'This week’s plan', 'Notes'])
    await expect(page.getByTestId('item-details')).toHaveCount(0)

    // It reached the server, as the account's settings.
    await expect
      .poll(() => server.settings?.itemSections)
      .toEqual({
        exercise: { order: ['history', 'plan', 'notes', 'details'], hidden: ['details'] },
      })

    // Every exercise's page takes it; a food's page doesn't.
    await page.getByRole('link', { name: 'Back to the week' }).click()
    await nameOf(page, 'Squats').click()
    await expect(heads(page)).toHaveText(['Recent weeks', 'This week’s plan', 'Notes'])
    await page.goto('/#/item/diet/veg')
    await expect(page.getByRole('heading', { level: 1, name: 'Vegetables' })).toBeVisible()
    await expect(heads(page)).toHaveText(['This week’s plan', 'Notes', 'Details', 'Recent weeks'])

    // It survives a reload, read back from the server.
    await page.goto('/#/item/exercise/sq')
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Squats' })).toBeVisible()
    await settle(page)
    await expect(heads(page)).toHaveText(['Recent weeks', 'This week’s plan', 'Notes'])
  })
})

test.describe('phone, 390px', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('folds to one column in the same order, and nothing scrolls sideways', async ({ page }) => {
    await openApp(page)
    await nameOf(page, 'Kettlebell halos').click()
    await expect(page.getByRole('heading', { level: 1, name: 'Kettlebell halos' })).toBeFocused()
    await settle(page)
    const heads = await page.getByRole('heading', { level: 2 }).allTextContents()
    expect(heads).toEqual(['This week’s plan', 'Notes', 'Details', 'Recent weeks'])
    // Each heading over its content: the plan's line starts under its heading, not beside it.
    const plan = (await page
      .getByRole('heading', { level: 2, name: 'This week’s plan' })
      .boundingBox())!
    const lede = (await page.getByTestId('item-plan-line').boundingBox())!
    expect(lede.y).toBeGreaterThan(plan.y + plan.height)
    expect(Math.abs(lede.x - plan.x)).toBeLessThan(2)
    await expectNoSidewaysScroll(page)
    await page.getByRole('button', { name: 'Edit notes' }).click()
    await expectNoSidewaysScroll(page)
  })

  test('arranging puts each section’s controls on its heading’s line', async ({ page }) => {
    await openApp(page)
    await nameOf(page, 'Kettlebell halos').click()
    await page.getByRole('button', { name: 'Arrange sections' }).click()
    await settle(page)
    const head = (await page
      .getByRole('heading', { level: 2, name: 'Recent weeks' })
      .boundingBox())!
    const sw = (await page.getByRole('switch', { name: 'Show Recent weeks' }).boundingBox())!
    const down = (await page.getByRole('button', { name: 'Move Recent weeks down' }).boundingBox())!
    // On the heading's line, to its right, and the last control ends inside the screen.
    expect(Math.abs(sw.y + sw.height / 2 - (head.y + head.height / 2))).toBeLessThan(8)
    expect(sw.x).toBeGreaterThan(head.x)
    expect(down.x + down.width).toBeLessThanOrEqual(390)
    // The one-word state goes: the switch says it.
    await expect(page.getByTestId('item-arrange-state').first()).toBeHidden()
    await expectNoSidewaysScroll(page)
  })
})
