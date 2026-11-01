// An item's note (WeekGrid card, K43): one line under the name and chips, and the whole of it in
// a popover with working links. The note is the item's details' notes, one copy for every week
// (D2). The popover opens in a real browser here; jsdom can't lay it out.
import { expect, test } from '@playwright/test'
import { openApp } from './support'

test.use({ viewport: { width: 1280, height: 800 } })

test('a note shows on one line, and a press opens it whole with its link', async ({ page }) => {
  await openApp(page)
  const grid = page.getByTestId('exercise-grid')
  const note = grid.getByRole('row', { name: /Push-ups/ }).getByTestId('item-note')
  await expect(note).toHaveText('Slow on the way down. Form video')
  await expect(note.locator('a')).toHaveCount(0)
  // Its line sits below the name's line, which the chips share.
  const name = grid.getByRole('row', { name: /Push-ups/ }).getByTestId('item-name')
  const chip = grid.getByRole('row', { name: /Push-ups/ }).getByTestId('item-detail')
  const [n, c, l] = await Promise.all([name.boundingBox(), chip.boundingBox(), note.boundingBox()])
  expect(Math.abs(n!.y + n!.height / 2 - (c!.y + c!.height / 2))).toBeLessThan(4)
  expect(l!.y).toBeGreaterThanOrEqual(n!.y + n!.height - 1)

  await note.click()
  const panel = page.getByRole('dialog', { name: 'Push-ups' })
  await expect(panel).toBeVisible()
  const link = panel.getByRole('link', { name: 'Form video' })
  await expect(link).toHaveAttribute('href', 'https://example.com/push-ups')
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  await expect(link).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  // Escape parks the cell's controls and puts focus back on the cell's widget, the name's link
  // (gridNav), as in Edit plan.
  await expect(name).toBeFocused()
})

test('a row without a note is one line', async ({ page }) => {
  await openApp(page)
  const row = page.getByTestId('exercise-grid').getByRole('row', { name: /Squats/ })
  await expect(row.getByTestId('item-note')).toHaveCount(0)
})

test('a long note opens in a panel that fits the window and scrolls', async ({ page }) => {
  await openApp(page)
  // Notes run to 20,000 characters (D2): far taller than the window.
  const long = Array.from({ length: 120 }, (_, i) => `Line ${i + 1} of the notes.`).join('\n\n')
  await page.route('**/api/state', (route) =>
    route.fulfill({
      json: {
        exercise: {
          plans: { '2026-10-19': [{ id: 'pu', name: 'Push-ups', sets: 3, reps: 12, target: 4 }] },
          log: {},
          details: { pu: { notes: long } },
          revs: {},
          detailRevs: { pu: 1 },
        },
        diet: { plans: {}, log: {}, details: {}, revs: {}, detailRevs: {} },
        settings: null,
      },
    }),
  )
  await page.reload()
  const note = page.getByTestId('exercise-grid').getByTestId('item-note')
  await expect(note).toHaveText(/^Line 1 of the notes\. Line 2/)
  await note.click()
  const panel = page.getByRole('dialog', { name: 'Push-ups' })
  await expect(panel).toBeVisible()
  const box = (await panel.boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(800)
  const scrolled = await panel.evaluate((el) => {
    el.scrollTop = el.scrollHeight
    return { overflows: el.scrollHeight > el.clientHeight, top: el.scrollTop }
  })
  expect(scrolled.overflows).toBe(true)
  expect(scrolled.top).toBeGreaterThan(0)
  await expect(panel.getByText('Line 120 of the notes.')).toBeInViewport()
})
