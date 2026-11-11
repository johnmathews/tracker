// A phone held upright, by touch (K98): the browser snaps between the screens. A fling that brings
// in another tracker, up or down, ends at its top with its title in view (K116), going up in one
// smooth movement rather than resting at a tall tracker's foot first (K118), and Edit plan's frame
// is half its desktop width there (K117).
import { expect, test, type CDPSession, type Page } from '@playwright/test'
import { openApp } from './support'

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

/**
 * A real fling through Chrome's input pipeline, the finger lifting while it still moves, so the
 * browser's momentum runs on: `dy` > 0 moves the page down. Returns how the page moved, sampled
 * every frame: how often it turned back, and whether it set off again (a second leg) after slowing
 * nearly to a stop. Measured three frames at a time: once it moves (24px or more), 6px or less
 * followed by 24px or more again. One fling is one movement, so once slowed it never speeds up.
 */
async function fling(page: Page, cdp: CDPSession, dy: number) {
  await page.evaluate(() => {
    const w = window as unknown as { samples: [number, number][]; frame: number }
    w.samples = []
    const sample = (t: number) => {
      w.samples.push([t, window.scrollY])
      w.frame = requestAnimationFrame(sample)
    }
    w.frame = requestAnimationFrame(sample)
  })
  await cdp.send('Input.synthesizeScrollGesture', {
    x: 195,
    y: dy > 0 ? 680 : 170,
    yDistance: -dy,
    speed: 1500,
    gestureSourceType: 'touch',
    preventFling: false,
  })
  await page.waitForTimeout(2200)
  return page.evaluate((way) => {
    const w = window as unknown as { samples: [number, number][]; frame: number }
    cancelAnimationFrame(w.frame)
    const steps = w.samples.slice(1).map(([, y], i) => (y - w.samples[i]![1]) * way)
    const back = steps.filter((d) => d <= -1).length
    // Three frames at a time, so a frame the browser drew twice (0px) is no stop.
    const threes = steps.slice(2).map((d, i) => d + steps[i]! + steps[i + 1]!)
    const moving = threes.findIndex((d) => d >= 24)
    let slowed = false
    let secondLeg = false
    for (const d of threes.slice(Math.max(0, moving))) {
      if (d <= 6) slowed = true
      else if (slowed && d >= 24) secondLeg = true
    }
    return { back, secondLeg }
  }, Math.sign(dy))
}

/** Each tracker's top against the foot of the band over the screens (the week, or the bar). */
function tops(page: Page) {
  return page.evaluate(() => {
    const band = [
      ...document.querySelectorAll<HTMLElement>('[data-slot="week-band"], [data-slot="bar"]'),
    ]
      .filter((b) => getComputedStyle(b).position === 'sticky')
      .map((b) => b.getBoundingClientRect().bottom)[0]!
    const at = (id: string) =>
      Math.round(
        document.querySelector(`[aria-labelledby="${id}"]`)!.getBoundingClientRect().top - band,
      )
    return { exercises: at('exercises-heading'), cardio: at('cardio-heading') }
  })
}

for (const mode of ['the week', 'Edit plan'] as const) {
  test(`in ${mode}, a fling up onto a tall tracker glides to its top in one movement (K116, K118)`, async ({
    page,
  }) => {
    // Ten exercises make Exercises taller than the window, so the browser could rest at its foot.
    await openApp(page, { moreExercises: 5 })
    const cdp = await page.context().newCDPSession(page)
    if (mode === 'Edit plan') await page.keyboard.press('e')
    await page.waitForTimeout(600)
    // Down until Cardio's top is under the band: a tall Exercises has a stop at its foot first.
    for (let i = 0; i < 8 && Math.abs((await tops(page)).cardio) > 1; i++)
      await fling(page, cdp, 210)
    expect(Math.abs((await tops(page)).cardio)).toBeLessThanOrEqual(1)
    const up = await fling(page, cdp, -210)
    expect(Math.abs((await tops(page)).exercises)).toBeLessThanOrEqual(1)
    // One movement: never back the other way, and no slowing at the foot and setting off again.
    expect(up).toEqual({ back: 0, secondLeg: false })
  })
}

test('Edit plan’s frame is 4px on a phone (K117)', async ({ page }) => {
  await openApp(page)
  await page.keyboard.press('e')
  const width = await page
    .locator('[data-slot="edit-frame"]')
    .evaluate((el) => getComputedStyle(el).borderTopWidth)
  expect(width).toBe('4px')
})
