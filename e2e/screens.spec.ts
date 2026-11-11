// The planner's screens (PlannerScreen card, K24): with more rows than fit, a section scrolls
// as usual, but the page never comes to rest showing part of two sections at once. There are
// three: Exercises, Cardio and Food (K90).
import { expect, test, type Page } from '@playwright/test'
import { openApp } from './support'

test.use({ viewport: { width: 1280, height: 800 } })
// Forty wheel steps, each left to settle.
test.setTimeout(90_000)

/**
 * Where the sections sit once the scroll has come to rest. `band` is the fixed week's foot (K88):
 * the screens move in the window below it, and 0 where it isn't fixed (a short screen).
 */
async function atRest(page: Page) {
  await page.waitForTimeout(700)
  return page.evaluate(() => {
    const screens = [...document.querySelectorAll('[data-planner-screen]')]
    const week = document.querySelector<HTMLElement>('[data-slot="week-band"]')!
    const band =
      getComputedStyle(week).position === 'sticky' ? week.getBoundingClientRect().bottom : 0
    return {
      // Each screen's foot but the last's: below the fixed week and inside the window, part of
      // the next screen shows beneath it.
      bottoms: screens.slice(0, -1).map((s) => Math.round(s.getBoundingClientRect().bottom)),
      vh: innerHeight,
      band: Math.round(band),
    }
  })
}

/** A screen's foot that rests inside the window, so two screens show; none when at rest. */
function across(at: Awaited<ReturnType<typeof atRest>>): number | undefined {
  return at.bottoms.find((b) => b > at.band + 1 && b < at.vh - 1)
}

/**
 * Wheel steps as a trackpad sends them, `every` ms apart, dispatched in the page: Playwright's own
 * wheel lands about 50ms apart, slower than any trackpad. Each step the page doesn't take scrolls
 * it, as the browser would.
 */
async function wheelSteps(page: Page, deltas: number[], every = 16): Promise<void> {
  await page.evaluate(
    async ({ deltas, every }) => {
      for (const deltaY of deltas) {
        const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })
        ;(document.elementFromPoint(640, 400) ?? document.body).dispatchEvent(event)
        if (!event.defaultPrevented) window.scrollBy(0, deltaY)
        await new Promise((resolve) => setTimeout(resolve, every))
      }
    },
    { deltas, every },
  )
}

/** Wheels `steps` times by `dy`, noting each place the scroll comes to rest. */
async function wheel(page: Page, steps: number, dy: number) {
  const stops: string[] = []
  const ends = new Set<string>()
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy)
    const at = await atRest(page)
    const both = across(at) !== undefined
    // A screen's foot at the fixed week's: the next screen starts there.
    if (at.bottoms.some((b) => Math.abs(b - at.band) <= 1)) ends.add('next-start')
    stops.push(
      `${dy > 0 ? 'down' : 'up'} ${i + 1}: screens end at ${at.bottoms.join(', ')} of ${at.vh}${both ? '  <-- both' : ''}`,
    )
  }
  return { stops, ends }
}

test('a rotation never leaves the page resting across two screens (K40)', async ({ page }) => {
  await openApp(page, { moreExercises: 10 })
  await page.mouse.move(640, 400)
  // Down past Exercises, then turn the screen: the layout changes height under the scroll position.
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
      across(at),
      `at ${size.width}×${size.height} screens end at ${at.bottoms.join(', ')} of ${at.vh}`,
    ).toBeUndefined()
  }
})

for (const [name, opts] of [
  ['a tall Exercises screen', { moreExercises: 10 }],
  ['a tall Cardio screen', { moreCardio: 12 }],
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
    expect(down.ends.has('next-start'), stops.join('\n')).toBe(true)
  })
}

test('a fling sprints to Cardio while it is still moving, not after (K45)', async ({ page }) => {
  await openApp(page)
  await page.mouse.move(640, 400)
  // The page notes when Cardio's top, the next screen (K90), reaches the fixed week's foot (K88).
  await page.evaluate(() => {
    const w = window as unknown as { arrivedAt: number | null }
    w.arrivedAt = null
    const cardio = document.querySelector('[aria-labelledby="cardio-heading"]')!
    const band = document.querySelector('[data-slot="week-band"]')!
    const watch = () => {
      const gap = cardio.getBoundingClientRect().top - band.getBoundingClientRect().bottom
      if (Math.abs(gap) <= 1) w.arrivedAt = performance.now()
      else requestAnimationFrame(watch)
    }
    requestAnimationFrame(watch)
  })
  // A trackpad fling: a wheel step every 16 ms for a second, the momentum dying away.
  await wheelSteps(
    page,
    Array.from({ length: 60 }, (_, i) => Math.max(3, 12 - Math.floor(i / 6))),
  )
  const endedAt = await page.evaluate(() => performance.now())
  await page.waitForTimeout(700)
  const arrivedAt = await page.evaluate(
    () => (window as unknown as { arrivedAt: number | null }).arrivedAt,
  )
  expect(arrivedAt, 'the page never reached Cardio').not.toBeNull()
  expect(
    arrivedAt!,
    `reached Cardio ${Math.round(arrivedAt! - endedAt)} ms after the fling ended`,
  ).toBeLessThan(endedAt)
})

test('a long press opens Edit plan with the bar above the week, and marks no day (K80)', async ({
  page,
}) => {
  await openApp(page)
  const bar = page.locator('[data-slot="bar"]')
  // The keyboard's hidden button reads "Done" only in Edit plan (K91).
  const done = page.getByTestId('edit-plan-button').filter({ hasText: 'Done' })
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
  await expect(done).toHaveCount(1)
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

test('a wheel the other way is never held back: it turns straight round (K45)', async ({
  page,
}) => {
  await openApp(page)
  await page.mouse.move(640, 400)
  const top = () => page.evaluate(() => Math.round(window.scrollY))
  // Three quick steps down sprint to Cardio; the wheel is still busy when the sprint lands.
  await wheelSteps(page, Array<number>(3).fill(120))
  await page.waitForTimeout(300)
  const cardio = await top()
  expect(cardio).toBeGreaterThan(0)
  // At once, a step up: it goes back to Exercises rather than being swallowed.
  await page.mouse.wheel(0, -120)
  await page.waitForTimeout(500)
  expect(await top()).toBe(0)
  // And at once, down again.
  await page.mouse.wheel(0, 120)
  await page.waitForTimeout(500)
  expect(await top()).toBe(cardio)
})

/** The page's scroll position, and its foot. */
async function place(page: Page) {
  return page.evaluate(() => ({
    y: Math.round(window.scrollY),
    max: document.documentElement.scrollHeight - window.innerHeight,
    copies: document.querySelectorAll('[data-wrap-copy]').length,
  }))
}

/** Where each screen rests: Exercises at the top, Cardio under the fixed week, Food at the foot. */
async function rests(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const band = document.querySelector('[data-slot="week-band"]')!.getBoundingClientRect().height
    return [...document.querySelectorAll('[data-planner-screen]')].map((el) =>
      Math.round(el.getBoundingClientRect().top + window.scrollY - band),
    )
  })
}

test('the screens wrap round: past the last the first comes up, above the first the last (K92)', async ({
  page,
}) => {
  await openApp(page)
  await page.mouse.move(640, 400)
  const [, cardio] = await rests(page)
  for (const expected of [cardio, 'foot'] as const) {
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(700)
    const at = await place(page)
    expect(at.y).toBe(expected === 'foot' ? at.max : expected)
  }
  // On down, past the end: back on the first screen, with no copy left behind.
  await page.mouse.wheel(0, 120)
  await page.waitForTimeout(700)
  let at = await place(page)
  expect(at).toEqual({ y: 0, max: at.max, copies: 0 })
  // Up, past the top: the last screen.
  await page.mouse.wheel(0, -120)
  await page.waitForTimeout(700)
  at = await place(page)
  expect(at).toEqual({ y: at.max, max: at.max, copies: 0 })
})

test('a fling that reaches the foot of a tall screen stops there, and doesn’t wrap (K92)', async ({
  page,
}) => {
  await openApp(page, { moreFoods: 14 })
  await page.mouse.move(640, 400)
  for (let i = 0; i < 2; i++) {
    await page.mouse.wheel(0, 120) // to Cardio, then Food's top
    await page.waitForTimeout(700)
  }
  // Steps without a pause, each continuing the last, all the way down and on past the foot.
  await wheelSteps(page, Array<number>(120).fill(60))
  await page.waitForTimeout(700)
  const at = await place(page)
  expect(at.y).toBe(at.max)
  expect(at.copies).toBe(0)
})

test('the week’s keys: E in and out of Edit plan, Esc out, S to Settings (K91)', async ({
  page,
}) => {
  await openApp(page)
  const bar = page.locator('[data-slot="bar"]')
  await page.keyboard.press('e')
  await expect(bar).toHaveClass(/sticky/)
  await page.keyboard.press('e')
  await expect(bar).not.toHaveClass(/sticky/)
  await page.keyboard.press('e')
  await page.keyboard.press('Escape')
  await expect(bar).not.toHaveClass(/sticky/)
  await page.keyboard.press('s')
  await expect(page).toHaveURL(/#\/settings$/)
})

test('a wrap turns straight back too: the other way at an end wraps back at once (K89, K92)', async ({
  page,
}) => {
  await openApp(page)
  await page.mouse.move(640, 400)
  const top = () => page.evaluate(() => Math.round(window.scrollY))
  // Up past Exercises: a wrap to Food, the page's foot.
  await page.mouse.wheel(0, -120)
  await page.waitForTimeout(700)
  const food = await top()
  expect(food).toBe((await place(page)).max)
  // On down past Food, the wheel still busy as the wrap lands on Exercises…
  await wheelSteps(page, Array<number>(3).fill(120))
  await page.waitForTimeout(300)
  expect(await top()).toBe(0)
  // …then at once up again: back to Food, not swallowed.
  await wheelSteps(page, Array<number>(3).fill(-120))
  await page.waitForTimeout(500)
  expect(await top()).toBe(food)
})

test('each push the same way moves one screen, and keeps going round (K94)', async ({ page }) => {
  await openApp(page)
  await page.mouse.move(640, 400)
  const top = () => page.evaluate(() => Math.round(window.scrollY))
  const [ex, cardio, food] = await rests(page)
  // A mouse wheel's notches, 300ms apart: a gesture each, so a screen each.
  const down: number[] = []
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(300)
    down.push(await top())
  }
  expect(down).toEqual([cardio, food, ex, cardio])
  const up: number[] = []
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, -120)
    await page.waitForTimeout(300)
    up.push(await top())
  }
  expect(up).toEqual([ex, food, cardio, ex])
})

for (const [name, peak, fade] of [
  ['a light flick', 18, 0.96],
  ['a hard flick, its momentum fading slowly', 45, 0.99],
] as const) {
  test(`${name} moves one screen, its momentum never a second (K45, K94)`, async ({ page }) => {
    await openApp(page)
    await page.mouse.move(640, 400)
    const top = () => page.evaluate(() => Math.round(window.scrollY))
    const [ex, cardio] = await rests(page)
    // The finger speeds up, lifts, and the momentum dies away over a second and a half.
    const ramp = [0.1, 0.2, 0.4, 0.6, 0.8, 1].map((k) => Math.round(peak * k))
    const deltas = [
      ...ramp,
      ...Array.from({ length: 90 }, (_, i) => Math.max(1, Math.round(peak * fade ** i))),
    ]
    const flick = async () => {
      await wheelSteps(page, deltas)
      await page.waitForTimeout(700)
    }
    await flick()
    expect(await top()).toBe(cardio)
    await flick()
    await flick() // Food, then one wrap to Exercises, not on to Cardio
    expect(await top()).toBe(ex)
    expect(await page.evaluate(() => document.querySelectorAll('[data-wrap-copy]').length)).toBe(0)
  })
}

/** A swipe: the finger speeding up to `peak`, then momentum fading by `fade` a step, `n` steps. */
function swipe(peak: number, fade: number, n: number): number[] {
  const size = Math.abs(peak)
  const way = Math.sign(peak)
  const ramp = [0.1, 0.2, 0.4, 0.6, 0.8, 1].map((k) => Math.max(1, Math.round(size * k)))
  const coast = Array.from({ length: n }, (_, i) => Math.max(1, Math.round(size * fade ** i)))
  return [...ramp, ...coast].map((d) => way * d)
}

test('two swipes move twice, the second made while the first still coasts (K95)', async ({
  page,
}) => {
  await openApp(page)
  const [ex, cardio, food] = await rests(page)
  // The second swipe cuts the first one's momentum off about a third of a second in.
  await wheelSteps(page, [...swipe(40, 0.98, 15), ...swipe(40, 0.98, 80)])
  await page.waitForTimeout(700)
  expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(food)
  // And back up the same way: two swipes, two screens.
  await wheelSteps(page, [...swipe(-40, 0.98, 15), ...swipe(-40, 0.98, 80)])
  await page.waitForTimeout(700)
  expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(ex)
  expect(cardio).toBeGreaterThan(ex)
})

test('two clicks of a mouse wheel move twice; one made mid-sprint is let go (K95, K96)', async ({
  page,
}) => {
  await openApp(page)
  await page.mouse.move(640, 400)
  const [ex, cardio, food] = await rests(page)
  await page.mouse.wheel(0, 100)
  await page.waitForTimeout(400)
  await page.mouse.wheel(0, 100)
  await page.waitForTimeout(700)
  expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(food)
  // Two clicks 80ms apart: the second lands mid-sprint, and nothing moves on after it.
  await page.mouse.wheel(0, -100)
  await page.waitForTimeout(80)
  await page.mouse.wheel(0, -100)
  await page.waitForTimeout(700)
  expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(cardio)
  expect(ex).toBe(0)
})

test('a small scroll moves one screen, though its momentum comes merged mid-sprint (K96)', async ({
  page,
}) => {
  await openApp(page, { noCardio: true })
  const [, cardio] = await rests(page)
  // The finger moves a little; then, while the page sprints, the browser sends the momentum late,
  // every third frame carrying four steps' worth after 64ms.
  const steps: [number, number][] = [
    [3, 16],
    [6, 16],
    [10, 16],
    [14, 16],
    [12, 16],
  ]
  let d = 12
  for (let i = 0; i < 40; i++) {
    d *= 0.93
    const merged = i % 3 === 1
    steps.push([Math.max(1, Math.round(merged ? d * 4 : d)), merged ? 64 : 16])
  }
  await page.evaluate(async (steps) => {
    for (const [deltaY, wait] of steps) {
      const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })
      ;(document.elementFromPoint(640, 400) ?? document.body).dispatchEvent(event)
      if (!event.defaultPrevented) window.scrollBy(0, deltaY)
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }, steps)
  await page.waitForTimeout(800)
  expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(cardio)
})

test('prints each tracker on a page of its own, the week over each (K97)', async ({ page }) => {
  await openApp(page)
  await page.emulateMedia({ media: 'print' })
  const weeks = page.locator('[data-slot="section-week"]')
  await expect(weeks).toHaveCount(3)
  for (const week of await weeks.all()) await expect(week).toBeVisible()
  const breaks = await page.evaluate(() =>
    [...document.querySelectorAll('[data-planner-screen]')].map(
      (el) => getComputedStyle(el).breakBefore,
    ),
  )
  expect(breaks).toEqual(['auto', 'page', 'page'])
  const pdf = (await page.pdf({ format: 'A4' })).toString('latin1')
  expect(pdf.match(/\/Type\s*\/Page[^s]/g)).toHaveLength(3)
})

test('a tracker with few rows keeps them at 82u, from the top of its screen (K110, K114)', async ({
  page,
}) => {
  // Cardio has two rows: before K110 they stretched to fill the screen.
  await openApp(page)
  const cardio = await page.evaluate(() => {
    const screen = document.querySelector('[aria-labelledby="cardio-heading"]')!
    const rows = [...screen.querySelectorAll('[role="rowheader"]')].map((r) =>
      r.getBoundingClientRect(),
    )
    const heading = screen.querySelector('#cardio-heading')!.getBoundingClientRect()
    const arrow = screen.querySelector('[data-testid="to-food"]')!.getBoundingClientRect()
    const box = screen.getBoundingClientRect()
    return {
      rows: rows.map((r) => r.height),
      above: heading.top - box.top,
      below: box.bottom - rows.at(-1)!.bottom,
      arrowFoot: box.bottom - arrow.bottom,
    }
  })
  expect(cardio.rows).toHaveLength(2)
  // 1280 × 800 makes u 1px.
  for (const h of cardio.rows) expect(h).toBeLessThanOrEqual(82.5)
  // The heading at the top, as on a page; the space left over under the rows; the arrow at the foot.
  expect(cardio.above).toBeLessThan(40)
  expect(cardio.below).toBeGreaterThan(200)
  expect(cardio.arrowFoot).toBeLessThan(40)
})

test('Edit plan’s Add sits at the end of each title line (K113)', async ({ page }) => {
  await openApp(page)
  await page.keyboard.press('e')
  for (const [section, add] of [
    ['exercises', 'add-exercise'],
    ['cardio', 'add-cardio'],
    ['diet', 'add-food'],
  ] as const) {
    const place = await page.evaluate(
      ({ section, add }) => {
        const screen = document.querySelector(`[aria-labelledby="${section}-heading"]`)!
        const button = screen.querySelector(`[data-testid="${add}"]`)!
        const line = screen.querySelector('[data-slot="section-header"]')!.getBoundingClientRect()
        const grid = screen.querySelector('table')!.getBoundingClientRect()
        const box = button.getBoundingClientRect()
        return {
          inHeader: !!button.closest('[data-slot="section-header"]'),
          aboveGrid: box.bottom <= grid.top,
          endGap: Math.round(line.right - box.right),
        }
      },
      { section, add },
    )
    expect(place).toEqual({ inHeader: true, aboveGrid: true, endGap: 0 })
  }
})

test('Edit plan on and off keeps the tracker on show, its top under the bar or the week (K115)', async ({
  page,
}) => {
  await openApp(page)
  const tops = () =>
    page.evaluate(() => {
      const band = [
        ...document.querySelectorAll<HTMLElement>('[data-slot="week-band"], [data-slot="bar"]'),
      ]
        .filter((b) => getComputedStyle(b).position === 'sticky')
        .map((b) => b.getBoundingClientRect().bottom)[0]!
      const at = (id: string) =>
        document.querySelector(`[aria-labelledby="${id}"]`)!.getBoundingClientRect().top - band
      return { cardio: Math.round(at('cardio-heading')), food: Math.round(at('diet-heading')) }
    })
  await page.getByTestId('to-cardio').click()
  await page.waitForTimeout(700)
  expect(Math.abs((await tops()).cardio)).toBeLessThanOrEqual(1)
  await page.keyboard.press('e')
  await page.waitForTimeout(400)
  expect(Math.abs((await tops()).cardio)).toBeLessThanOrEqual(1)
  await page.getByTestId('to-food').click()
  await page.waitForTimeout(700)
  await page.keyboard.press('e')
  await page.waitForTimeout(400)
  expect(Math.abs((await tops()).food)).toBeLessThanOrEqual(1)
})

test('Edit plan draws an 8px edit frame round the window, and every press goes through (K112)', async ({
  page,
}) => {
  await openApp(page)
  const frame = page.locator('[data-slot="edit-frame"]')
  await expect(frame).toHaveCount(0)
  await page.keyboard.press('e')
  await expect(frame).toHaveCount(1)
  const look = await frame.evaluate((el) => {
    const s = getComputedStyle(el)
    const box = el.getBoundingClientRect()
    return {
      width: s.borderTopWidth,
      colour: s.borderTopColor,
      box: [box.left, box.top, box.width, box.height],
      through: s.pointerEvents,
    }
  })
  expect(look).toEqual({
    width: '8px',
    colour: 'rgb(37, 99, 201)',
    box: [0, 0, 1280, 800],
    through: 'none',
  })
  // A press on the frame lands on the page under it.
  const hit = await page.evaluate(
    () => (document.elementFromPoint(4, 400) as HTMLElement | null)?.dataset.slot ?? '',
  )
  expect(hit).not.toBe('edit-frame')
  await page.keyboard.press('e')
  await expect(frame).toHaveCount(0)
})

test('after Add, the page stays on the tracker it was adding to (K111)', async ({ page }) => {
  // Five exercises at Edit plan's 100u rows already run past an 800px window, so the sixth makes
  // Exercises a tall screen with Add near its foot, where the browser's own scroll left the page
  // across two trackers and the sprint moved on to Cardio.
  await openApp(page)
  await page.keyboard.press('e')
  await expect(page.getByTestId('edit-plan-button').filter({ hasText: 'Done' })).toHaveCount(1)
  await page.getByTestId('add-exercise').click()
  await page.getByLabel('Name').fill('Lunges')
  await page.getByRole('button', { name: 'Add exercise' }).first().click()
  await expect(page.getByTestId('add-exercise')).toBeFocused()
  await page.waitForTimeout(700)
  const at = await page.evaluate(() => {
    const bar = document.querySelector('[data-slot="bar"]')!.getBoundingClientRect().bottom
    const [exercises, cardio] = [...document.querySelectorAll('[data-planner-screen]')].map((s) =>
      s.getBoundingClientRect(),
    )
    const add = document.querySelector('[data-testid="add-exercise"]')!.getBoundingClientRect()
    return {
      bar,
      vh: innerHeight,
      exercisesTop: exercises!.top,
      exercisesBottom: exercises!.bottom,
      cardioTop: cardio!.top,
      add: { top: add.top, bottom: add.bottom },
    }
  })
  // Exercises fills the window: the next tracker's top is out of sight, and Add is in view.
  expect(at.exercisesTop).toBeLessThanOrEqual(at.bar + 1)
  expect(at.exercisesBottom).toBeGreaterThanOrEqual(at.vh - 1)
  expect(at.cardioTop).toBeGreaterThanOrEqual(at.vh - 1)
  expect(at.add.top).toBeGreaterThanOrEqual(at.bar)
  expect(at.add.bottom).toBeLessThanOrEqual(at.vh)
})

test('Edit plan is one tracker per screen too, each resting under the sticky bar (K99)', async ({
  page,
}) => {
  await openApp(page)
  await page.keyboard.press('e')
  await expect(page.getByTestId('edit-plan-button').filter({ hasText: 'Done' })).toHaveCount(1)
  const place = () =>
    page.evaluate(() => {
      const bar = document.querySelector('[data-slot="bar"]')!.getBoundingClientRect().bottom
      const screens = [...document.querySelectorAll('[data-planner-screen]')].map((s) =>
        s.getBoundingClientRect(),
      )
      return {
        bar: Math.round(bar),
        tops: screens.map((s) => Math.round(s.top)),
        // A screen's foot inside the window, below the bar: two trackers show.
        across: screens
          .slice(0, -1)
          .some((s) => s.bottom > bar + 1 && s.bottom < window.innerHeight - 1),
      }
    })
  // Each screen is at least the window less the bar (option B: Edit plan's rows, from the top).
  const first = await place()
  const heights = await page.evaluate(() =>
    [...document.querySelectorAll('[data-planner-screen]')].map((s) => s.clientHeight),
  )
  for (const h of heights) expect(h).toBeGreaterThanOrEqual(800 - first.bar - 1)
  // A mouse wheel's notches never leave two trackers showing, and reach Cardio under the bar.
  await page.mouse.move(640, 500)
  let cardio = false
  for (let i = 0; i < 6 && !cardio; i++) {
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(700)
    const at = await place()
    expect(at.across).toBe(false)
    cardio = Math.abs(at.tops[1]! - at.bar) <= 1
  }
  expect(cardio).toBe(true)
  // The arrow at Cardio's foot goes on to Food, its top just under the bar.
  await page.getByTestId('to-food').click()
  await page.waitForTimeout(700)
  const food = await place()
  expect(Math.abs(food.tops[2]! - food.bar)).toBeLessThanOrEqual(1)
})
