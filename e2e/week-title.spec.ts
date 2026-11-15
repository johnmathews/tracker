// The week title and "View current week" (K130, K131): the button after the bar's next-week arrow in Edit
// plan and after the band's title in the week view, only while another week is on screen; and
// Settings' Week title, which titles the week by its number and saves with the account (K132).
import { expect, test, type Page } from '@playwright/test'
import { callUpBar, expectNoSidewaysScroll, openApp, settle } from './support'

const band = (page: Page) => page.locator('[data-slot="week-band"]')
const bandTitle = (page: Page) => band(page).locator('h1')
const bandButton = (page: Page) => page.getByTestId('band-this-week-button')
const barButton = (page: Page) => page.getByTestId('this-week-button')

/** From the week view: into Edit plan, `n` weeks on (back when negative), and out again. */
async function moveWeeks(page: Page, n: number): Promise<void> {
  await callUpBar(page)
  const arrow = page.getByRole('button', { name: n < 0 ? 'Previous week' : 'Next week' })
  for (let i = 0; i < Math.abs(n); i++) await arrow.click()
  // Esc leaves Edit plan (K91), and again takes focus out of the bar, which then hides.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await settle(page)
}

test.describe('desktop, 1280 wide', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('View current week follows the bar’s next-week arrow, in Edit plan', async ({ page }) => {
    await openApp(page)
    await callUpBar(page)
    await expect(barButton(page)).toHaveCount(0)
    const next = page.getByRole('button', { name: 'Next week' })
    await next.click()
    await expect(barButton(page)).toBeVisible()
    // Right after the arrow, on its line, and none of the actions at the end.
    const arrowBox = (await next.boundingBox())!
    const buttonBox = (await barButton(page).boundingBox())!
    expect(buttonBox.x).toBeGreaterThanOrEqual(arrowBox.x + arrowBox.width)
    expect(buttonBox.x - (arrowBox.x + arrowBox.width)).toBeLessThan(24)
    expect(
      Math.abs(buttonBox.y + buttonBox.height / 2 - (arrowBox.y + arrowBox.height / 2)),
    ).toBeLessThan(2)
    await expect(
      page.locator('[data-slot="bar-action"]', { hasText: 'View current week' }),
    ).toHaveCount(0)
    await barButton(page).click()
    await expect(page.getByTestId('week-label')).toHaveText('19–25 October')
    await expect(barButton(page)).toHaveCount(0)
  })

  test('View current week follows the band’s title in the week view, the two centred together', async ({
    page,
  }) => {
    await openApp(page)
    await expect(bandButton(page)).toHaveCount(0)
    const height = (await band(page).boundingBox())!.height
    await moveWeeks(page, 1)
    await expect(bandTitle(page)).toHaveText('26 Oct – 1 Nov')
    await expect(bandButton(page)).toBeVisible()
    const title = (await bandTitle(page).boundingBox())!
    const button = (await bandButton(page).boundingBox())!
    expect(button.x).toBeGreaterThan(title.x + title.width)
    const middle = (title.x + button.x + button.width) / 2
    expect(Math.abs(middle - 640)).toBeLessThan(2)
    // The band keeps its height, so nothing under it moves.
    expect((await band(page).boundingBox())!.height).toBeCloseTo(height, 0)
    await bandButton(page).click()
    await expect(bandTitle(page)).toHaveText('19–25 October')
    await expect(bandButton(page)).toHaveCount(0)
  })

  test('← and → go to the previous and the next week, and leave a grid’s cells alone (K133)', async ({
    page,
  }) => {
    await openApp(page)
    await page.keyboard.press('ArrowRight')
    await expect(bandTitle(page)).toHaveText('26 Oct – 1 Nov')
    await expect(bandButton(page)).toBeVisible()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(bandTitle(page)).toHaveText('12–18 October')
    // In a grid the arrows move between the cells.
    await page.locator('[data-slot="day-mark-button"]').first().focus()
    await page.keyboard.press('ArrowRight')
    await expect(bandTitle(page)).toHaveText('12–18 October')
  })

  test('Week title in Settings titles the bar and the band by the number, and saves it', async ({
    page,
  }) => {
    await openApp(page)
    await page.goto('/#/settings/appearance')
    const control = page.getByTestId('week-title-control')
    await expect(control.getByRole('button')).toHaveText(['Date', 'Week number'])
    const put = page.waitForRequest(
      (r) => r.method() === 'PUT' && r.url().endsWith('/api/settings'),
    )
    await control.getByRole('button', { name: 'Week number' }).click()
    expect((await put).postDataJSON()).toMatchObject({ weekTitle: 'number' })
    await page.getByRole('link', { name: 'Back to the week' }).click()
    await settle(page)
    // The number for the eye, and the dates for a screen reader.
    await expect(bandTitle(page)).toHaveText('Week 43, 19–25 October')
    await expect(bandTitle(page).locator('.sr-only')).toHaveText(', 19–25 October')
    await moveWeeks(page, -1)
    await expect(bandTitle(page)).toHaveText('Week 42, 12–18 October')
    await expect(bandButton(page)).toBeVisible()
  })
})

test.describe('phone, 390 wide', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the band puts the button under the title, a row taller, and the bar under the week', async ({
    page,
  }) => {
    await openApp(page)
    const height = (await band(page).boundingBox())!.height
    // 21–27 September: the longest title within this year.
    await moveWeeks(page, -4)
    await expect(bandTitle(page)).toHaveText('21–27 September')
    await expect(bandButton(page)).toBeVisible()
    await expectNoSidewaysScroll(page)
    // Under the title, centred, the title at its own size (option P2, K130).
    const title = (await bandTitle(page).boundingBox())!
    const button = (await bandButton(page).boundingBox())!
    expect(button.y).toBeGreaterThanOrEqual(title.y + title.height)
    expect(Math.abs(button.x + button.width / 2 - 195)).toBeLessThan(1)
    expect(await bandTitle(page).evaluate((h) => getComputedStyle(h).fontSize)).toBe('30px')
    // The band is a row taller, and the first screen starts under it.
    const taller = (await band(page).boundingBox())!
    expect(taller.height).toBeCloseTo(height + button.height + 6, 0)
    expect(button.y + button.height).toBeLessThanOrEqual(taller.y + taller.height)
    const heading = (await page.locator('#tracker-exercise-heading').boundingBox())!
    expect(heading.y).toBeGreaterThanOrEqual(taller.y + taller.height)
    // A week last year, as wide as a title gets: nothing sticks out.
    await moveWeeks(page, -48)
    await expect(bandTitle(page)).toHaveText('20–26 October 2025')
    await expectNoSidewaysScroll(page)
    // In Edit plan the bar has no room after the arrow for the button: it goes under the week.
    await callUpBar(page)
    await expect(barButton(page)).toBeVisible()
    await expectNoSidewaysScroll(page)
    const arrow = (await page.getByRole('button', { name: 'Next week' }).boundingBox())!
    const barBox = (await barButton(page).boundingBox())!
    expect(barBox.y).toBeGreaterThanOrEqual(arrow.y + arrow.height - 1)
    // Back on this week, the band is its own height again.
    await barButton(page).click()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await settle(page)
    expect((await band(page).boundingBox())!.height).toBeCloseTo(height, 0)
  })
})
