// The planner's screens (PlannerScreen card, K24): with more rows than fit, a section scrolls
// as usual, but the page never comes to rest showing part of both sections at once.
import { expect, test, type Page } from '@playwright/test'
import { openApp } from './support'

test.use({ viewport: { width: 1280, height: 800 } })
// Forty wheel steps, each left to settle.
test.setTimeout(90_000)

/** Where the sections sit once the scroll has come to rest. */
async function atRest(page: Page) {
  await page.waitForTimeout(700)
  return page.evaluate(() => {
    const ex = document
      .querySelector('[aria-labelledby="exercises-heading"]')!
      .getBoundingClientRect()
    return { exBottom: Math.round(ex.bottom), exHeight: Math.round(ex.height), vh: innerHeight }
  })
}

/** Wheels `steps` times by `dy`, noting each place the scroll comes to rest. */
async function wheel(page: Page, steps: number, dy: number) {
  const stops: string[] = []
  const ends = new Set<string>()
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy)
    const at = await atRest(page)
    // Exercises' foot inside the screen means part of Food shows beneath it.
    const both = at.exBottom > 1 && at.exBottom < at.vh - 1
    if (Math.abs(at.exBottom - at.vh) <= 1) ends.add('exercises-end')
    if (Math.abs(at.exBottom) <= 1) ends.add('food-start')
    stops.push(
      `${dy > 0 ? 'down' : 'up'} ${i + 1}: Exercises ends at ${at.exBottom} of ${at.vh}${both ? '  <-- both' : ''}`,
    )
  }
  return { stops, ends }
}

test('a rotation never leaves the page resting across two screens (K40)', async ({ page }) => {
  await openApp(page, { moreExercises: 10 })
  await page.mouse.move(640, 400)
  // Down into Food, then turn the screen: the layout changes height under the scroll position.
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 120)
  await atRest(page)
  for (const size of [
    { width: 800, height: 1280 },
    { width: 1280, height: 800 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size)
    const at = await atRest(page)
    expect(
      at.exBottom > 1 && at.exBottom < at.vh - 1,
      `at ${size.width}×${size.height} Exercises ends at ${at.exBottom} of ${at.vh}`,
    ).toBe(false)
  }
})

for (const [name, opts] of [
  ['a tall Exercises screen', { moreExercises: 10 }],
  ['a tall Food screen', { moreFoods: 14 }],
] as const) {
  test(`${name} scrolls as usual, and never rests beside the other`, async ({ page }) => {
    await openApp(page, opts)
    await page.mouse.move(640, 400)
    const down = await wheel(page, 20, 120)
    const up = await wheel(page, 20, -120)
    const stops = [...down.stops, ...up.stops]
    expect(
      stops.filter((s) => s.includes('<--')),
      stops.join('\n'),
    ).toEqual([])
    expect(down.ends.has('food-start'), stops.join('\n')).toBe(true)
  })
}

test('a fling sprints to Food while it is still moving, not after (K45)', async ({ page }) => {
  await openApp(page)
  await page.mouse.move(640, 400)
  // The page notes when Food's top reaches the top of the window.
  await page.evaluate(() => {
    const w = window as unknown as { arrivedAt: number | null }
    w.arrivedAt = null
    const food = document.querySelector('[aria-labelledby="diet-heading"]')!
    const watch = () => {
      if (Math.abs(food.getBoundingClientRect().top) <= 1) w.arrivedAt = performance.now()
      else requestAnimationFrame(watch)
    }
    requestAnimationFrame(watch)
  })
  // A trackpad fling: a wheel step every 16 ms for a second, the momentum dying away.
  for (let i = 0; i < 60; i++) {
    await page.mouse.wheel(0, Math.max(3, 12 - Math.floor(i / 6)))
    await page.waitForTimeout(16)
  }
  const endedAt = await page.evaluate(() => performance.now())
  await page.waitForTimeout(700)
  const arrivedAt = await page.evaluate(
    () => (window as unknown as { arrivedAt: number | null }).arrivedAt,
  )
  expect(arrivedAt, 'the page never reached Food').not.toBeNull()
  expect(
    arrivedAt!,
    `reached Food ${Math.round(arrivedAt! - endedAt)} ms after the fling ended`,
  ).toBeLessThan(endedAt)
})

test('a long press opens Edit plan with the bar above the week, and marks no day (K80)', async ({
  page,
}) => {
  await openApp(page)
  const bar = page.locator('[data-slot="bar"]')
  // "Done" shows in the bar only in Edit plan (K82).
  const done = page.getByRole('button', { name: 'Done', exact: true })
  // The first day with no mark yet, held by its place so the locator stays on it once marked.
  const cells = page.locator('[data-slot="day-mark-button"]')
  const free = await cells.evaluateAll((els) =>
    els.findIndex((el) => el.getAttribute('aria-pressed') === 'false'),
  )
  expect(free).toBeGreaterThanOrEqual(0)
  const cell = cells.nth(free)
  await expect(cell).toHaveAttribute('aria-pressed', 'false')
  const box = (await cell.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await expect(done).toBeVisible()
  await page.mouse.up()
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')
  // The bar is in the page, not over it: the week starts below it.
  await expect(bar).toHaveClass(/sticky/)
  const barBox = (await bar.boundingBox())!
  const heading = (await page.locator('#exercises-heading').boundingBox())!
  expect(heading.y).toBeGreaterThanOrEqual(barBox.y + barBox.height)
  // A second long press, in the margin, goes back to the week; the day held is still unmarked.
  await page.mouse.move(4, 400)
  await page.mouse.down()
  await expect(done).toHaveCount(0)
  await page.mouse.up()
  await expect(cell).toHaveAttribute('aria-pressed', 'false')
  // A tap on it, after, marks it as before.
  await cell.click()
  await expect(cell).toHaveAttribute('aria-pressed', 'true')
})
