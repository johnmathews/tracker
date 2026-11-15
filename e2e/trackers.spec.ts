// The account's own trackers (K122, K123, K124): Add tracker in Edit plan's bar opens the new
// tracker page; a new tracker shows last, with its name; its pen renames it; Delete tracker takes
// it off this week and every week after, and earlier weeks keep it with its marks.
import { expect, test, type Page } from '@playwright/test'
import { expectNoSidewaysScroll, openApp, settle } from './support'

test.use({ viewport: { width: 1280, height: 900 } })

/** Edit plan, by its key (K91): the bar is sticky and in view, with Add tracker. */
async function editPlan(page: Page): Promise<void> {
  await page.keyboard.press('e')
  await page.getByTestId('add-tracker-button').waitFor()
}

/** Adds a tracker from Edit plan's bar, and gives its id: the last screen's. */
async function addTracker(page: Page, name: string, kind?: string): Promise<string> {
  await page.getByTestId('add-tracker-button').click()
  await page.getByRole('heading', { level: 1, name: 'New tracker' }).waitFor()
  await expect(page.getByRole('textbox', { name: 'Name' })).toBeFocused()
  await page.getByRole('textbox', { name: 'Name' }).fill(name)
  if (kind)
    await page.getByRole('group', { name: 'Kind' }).getByRole('button', { name: kind }).click()
  await page.getByTestId('new-tracker-add').click()
  await page.getByTestId('new-tracker-page').waitFor({ state: 'detached' })
  const id = await page.locator('[data-planner-screen]').last().getAttribute('data-tracker')
  return id!
}

test('a new tracker shows last, with its name, and its pen renames it (K121, K124)', async ({
  page,
}) => {
  await openApp(page)
  await editPlan(page)
  const before = await page.locator('[data-planner-screen]').count()
  const id = await addTracker(page, '  Upper body ')
  const screens = page.locator('[data-planner-screen]')
  await expect(screens).toHaveCount(before + 1)
  const heading = page.locator(`#tracker-${id}-heading`)
  await expect(heading).toHaveText('Upper body')
  await expect(screens.last()).toHaveAttribute('data-kind', 'strength')
  // Back in Edit plan, with focus on the new tracker's Add.
  await expect(page.getByTestId(`add-${id}`)).toBeFocused()
  await expect(page.getByTestId(`add-${id}`)).toHaveText('Add exercise')
  // The tracker before it now has an arrow to it.
  await expect(page.getByTestId(`to-${id}`)).toHaveAccessibleName('Go to Upper body')

  // Enter saves the new name.
  await page.getByTestId(`rename-${id}`).click()
  const field = page.getByTestId(`name-field-${id}`)
  await expect(field).toBeFocused()
  await field.fill('Push day')
  await field.press('Enter')
  await expect(heading).toHaveText('Push day')
  await expect(page.getByTestId(`rename-${id}`)).toBeFocused()
  // Escape puts the old name back, and Edit plan stays on.
  await page.getByTestId(`rename-${id}`).click()
  await field.fill('Nope')
  await field.press('Escape')
  await expect(heading).toHaveText('Push day')
  await expect(page.getByTestId('add-tracker-button')).toBeVisible()
})

test('Cancel adds nothing, and the name is asked for', async ({ page }) => {
  await openApp(page)
  await editPlan(page)
  const before = await page.locator('[data-planner-screen]').count()
  await page.getByTestId('add-tracker-button').click()
  await page.getByTestId('new-tracker-add').click()
  await expect(page.getByText('Enter a name.')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Name' })).toBeFocused()
  await page.getByTestId('new-tracker-cancel').click()
  await expect(page.getByTestId('add-tracker-button')).toBeFocused()
  await expect(page.locator('[data-planner-screen]')).toHaveCount(before)
})

test('a mobility tracker takes an item by hold time; deleted, it leaves this week and keeps the last (K122)', async ({
  page,
}) => {
  await openApp(page)
  await editPlan(page)
  // Made in the week before, so that week still shows it once it is deleted from this one.
  await page.getByRole('button', { name: 'Previous week' }).click()
  await expect(page.getByTestId('week-label')).toContainText('12')
  const id = await addTracker(page, 'Mobility', 'Mobility')
  await expect(page.locator('[data-planner-screen]').last()).toHaveAttribute(
    'data-kind',
    'mobility',
  )
  await expect(page.getByTestId(`${id}-a-day`)).toBeVisible()

  // Add mobility: an exercise's plan without Weight.
  await page.getByTestId(`add-${id}`).click()
  await expect(page.getByTestId('new-add')).toHaveText('Add mobility')
  await expect(page.locator('input[data-field="weight"]')).toHaveCount(0)
  await page.getByTestId('new-name-field').fill('Hip hold')
  await page.getByRole('button', { name: 'Time', exact: true }).click()
  await page.locator('input[data-field="reps"]').fill('45')
  await page.getByRole('button', { name: 'Each side', exact: true }).click()
  await page.getByTestId('new-add').click()
  const grid = page.getByTestId(`${id}-grid`)
  await expect(grid.getByRole('link', { name: 'Hip hold' })).toBeVisible()
  await expect(grid.getByTestId('item-detail')).toHaveText(['1 × 45 s each side'])

  // Marked on the Monday of that week, out of Edit plan.
  await page.keyboard.press('e')
  await expect(page.getByTestId('add-tracker-button')).toHaveCount(0)
  const monday = grid.locator('[data-slot="day-mark-button"]').first()
  await monday.click()
  await expect(monday).toHaveAttribute('aria-pressed', 'true')

  // This week carries its plan forward; Delete tracker takes it off this week.
  await editPlan(page)
  await page.getByRole('button', { name: 'Next week' }).click()
  await expect(page.getByTestId(`${id}-grid`).getByRole('link', { name: 'Hip hold' })).toBeVisible()
  const screens = await page.locator('[data-planner-screen]').count()
  await page.getByTestId(`delete-${id}`).click()
  const dialog = page.getByRole('alertdialog', { name: 'Delete Mobility?' })
  await expect(dialog).toContainText('History is not deleted.')
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.locator('[data-planner-screen]')).toHaveCount(screens - 1)
  await expect(page.locator(`[data-tracker="${id}"]`)).toHaveCount(0)
  await page.getByRole('button', { name: 'Next week' }).click()
  await expect(page.locator(`[data-tracker="${id}"]`)).toHaveCount(0)

  // The week before keeps it, with its mark.
  await page.getByRole('button', { name: 'Previous week' }).click()
  await page.getByRole('button', { name: 'Previous week' }).click()
  const kept = page.getByTestId(`${id}-grid`)
  await expect(kept.getByRole('link', { name: 'Hip hold' })).toBeVisible()
  await expect(kept.locator('[data-slot="day-mark-button"]').first()).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test.describe('at phone width', () => {
  test.use({ viewport: { width: 375, height: 800 } })

  test('Add tracker is in the folded bar, and its page fits the screen (K124)', async ({
    page,
  }) => {
    await openApp(page)
    await editPlan(page)
    const add = page.getByTestId('add-tracker-button')
    await expect(add).toBeInViewport()
    // Folded, the actions share the bar's second line: Add tracker is on it with Settings.
    const [a, s] = await Promise.all([
      add.boundingBox(),
      page.getByTestId('settings-button').boundingBox(),
    ])
    expect(Math.abs(a!.y - s!.y)).toBeLessThanOrEqual(1)
    await expectNoSidewaysScroll(page)
    await add.click()
    await page.getByRole('heading', { level: 1, name: 'New tracker' }).waitFor()
    await settle(page)
    await expectNoSidewaysScroll(page)
    const kinds = page.getByRole('group', { name: 'Kind' }).getByRole('button')
    await expect(kinds).toHaveText(['Strength', 'Cardio', 'Food', 'Mobility'])
    for (const kind of await kinds.all()) await expect(kind).toBeInViewport()
    await page.getByRole('textbox', { name: 'Name' }).fill('Stretching')
    await page.getByTestId('new-tracker-add').click()
    await expect(page.locator('[data-planner-screen]').last()).toContainText('Stretching')
    await expectNoSidewaysScroll(page)
  })
})
