// The programme builder (docs/specs/2026-11-20-programme-builder.md §11): build a programme from
// empty and save it to the Library; a problem beside its field and on its closed card, with Save
// waiting for the fix; Save changes on a Library programme, and a 409 conflict; an exception week
// that rests two activities (K191).
//
// /api is mocked with replies saved from the real API (e2e/fixtures/programmes/generate.py,
// e2e/builder-support.ts): each check the page sends is answered by the server's reply to that
// same document, so the problems and the weeks are the server's own.
import { expect, test, type Page } from '@playwright/test'
import {
  BEGINNER,
  CONFLICT,
  DRAFTS,
  SAVED,
  card,
  checkLine,
  checked,
  openBuilder,
  openEditWithDeadlift,
  openEditWithLegsRest,
  restRow,
  valueLine,
  type Sent,
} from './builder-support'

/** The bodies of the app's requests to `path` with `method`, in order. */
const bodies = (sent: Sent, method: string, path: string) =>
  sent.requests
    .filter((r) => r.method() === method && new URL(r.url()).pathname === `/api${path}`)
    .map((r) => r.postDataJSON() as unknown)

/** A row of the Library tab. */
const libraryRow = (page: Page, id: string) =>
  page.locator(`[data-testid="library-programme"][data-programme="${id}"]`)

const SAVE = (page: Page) => page.getByTestId('builder-save')
const LIMIT = 'Week 6 comes to 510 kg. The most is 500.'

test('builds a programme from empty, sees its weeks, and saves it to the Library', async ({
  page,
}) => {
  const sent = await openBuilder(page, { hash: '#/programmes' })
  await page.getByTestId('programmes-tab-add').click()
  await page.getByTestId('add-build').click()
  await expect(page).toHaveURL(/#\/programmes\/new$/)
  const builder = page.getByTestId('programme-builder')
  await expect(builder.getByRole('heading', { level: 1 })).toHaveText('New programme')

  // An empty form isn't wrong yet: the check's problems wait for the first change.
  await checked(page, sent, 1)
  await expect(checkLine(page)).toHaveText('Not saved yet.')
  await expect(builder.getByText('Give a name of 1 to 60 characters.')).toHaveCount(0)

  await page.getByTestId('builder-name').fill('Squat block')
  await checked(page, sent, 2)
  await expect(builder.getByTestId('builder-activities')).toContainText('Give 1 to 30 activities.')
  await expect(checkLine(page)).toHaveText('One problem, in the activities. Fix it to save.')
  await expect(SAVE(page)).toBeDisabled()

  // A new activity opens with its name focused, and the server asks for the name beside it.
  await page.getByTestId('activity-add').click()
  const name = page.getByTestId('activity-name')
  await expect(name).toBeFocused()
  await checked(page, sent, 3)
  await expect(name).toHaveAttribute('aria-invalid', 'true')
  await expect(card(page, 'activity')).toContainText('Give a name of 1 to 80 characters.')

  // Named, the key follows the name, and the weeks come from the server.
  await name.fill('Back squat')
  await checked(page, sent, 4)
  await expect(checkLine(page)).toHaveText('Checked. No problems.')
  const grid = page.getByTestId('programme-grid')
  await expect(grid.locator('tr[data-activity="back-squat"]')).toContainText('Back squat')
  await expect(grid.locator('th[data-week]')).toHaveCount(8)

  // The weight grows: from 20 kg by 2.5 kg a week, then from 40 kg as typed.
  await valueLine(page, 'back-squat', 'weight').locator('> button').click()
  await page.getByTestId('value-shape').getByRole('button', { name: 'Grows' }).click()
  await checked(page, sent, 5)
  await page.getByTestId('value-start').fill('40')
  await checked(page, sent, 6)
  const cell = (w: number) => grid.locator(`td[data-activity="back-squat"][data-week="${w}"]`)
  await expect(cell(1)).toContainText('40 kg')
  await expect(cell(2)).toContainText('42.5 kg')
  await expect(cell(8)).toContainText('57.5 kg')

  // Each change was checked once, in order, as the server's draft replies were saved.
  expect(sent.drafts).toEqual(['new', 'named', 'activity', 'squat', 'squat-grows', 'squat-40'])

  await expect(SAVE(page)).toHaveText('Save to library')
  await SAVE(page).click()
  expect(bodies(sent, 'POST', '/programmes')).toEqual([{ doc: DRAFTS['squat-40'].doc }])
  // It lands in Library, as a copy does (K177): the tab opens, and the new row has focus.
  await expect(page).toHaveURL(/#\/programmes$/)
  await expect(page.getByTestId('programmes-tab-library')).toHaveAttribute('aria-selected', 'true')
  const row = libraryRow(page, SAVED.id)
  await expect(row).toContainText('Squat block')
  await expect(row).toBeInViewport()
  await expect(row.getByRole('heading', { name: 'Squat block' })).toBeFocused()
})

test('a problem shows beside its field and on its closed card, and Save waits for the fix', async ({
  page,
}) => {
  const sent = await openBuilder(page, { hash: '#/programmes' })
  await page.getByTestId('programmes-tab-library').click()
  await libraryRow(page, BEGINNER.id).getByTestId('library-edit').click()
  await expect(page).toHaveURL(new RegExp(`#/programmes/${BEGINNER.id}/edit$`))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Beginner 5×5')
  await checked(page, sent, 1)
  await expect(checkLine(page)).toHaveText('Checked. No problems.')
  await expect(SAVE(page)).toBeEnabled()

  // The deadlift at +90 kg a week: week 6 comes to 510 kg.
  const deadlift = card(page, 'deadlift')
  const toggle = deadlift.locator('[data-slot="activity-toggle"]')
  await toggle.click()
  const weight = valueLine(page, 'deadlift', 'weight')
  await weight.locator('> button').click()
  await page.getByTestId('value-amount').fill('90')
  await checked(page, sent, 2)
  expect(sent.drafts).toEqual(['beginner', 'deadlift-90'])

  // Under the weight, inside its open line, and the line's group is described by it.
  await expect(weight.getByTestId('value-error')).toHaveText(LIMIT)
  await expect(weight.locator('> [role="group"]')).toHaveAccessibleDescription(LIMIT)
  // Closed, the line still says it.
  await weight.locator('> button').click()
  await expect(weight.getByTestId('value-error')).toHaveText(LIMIT)
  await expect(weight.locator('> button')).toHaveAccessibleDescription(LIMIT)
  // The closed card says it under its rule.
  await toggle.click()
  await expect(deadlift.getByTestId('activity-problem')).toHaveText(LIMIT)
  await expect(toggle).toHaveAccessibleDescription(LIMIT)
  // The weeks over the limit are marked in the grid: 6 to 8.
  const over = page.locator('[data-limit="activities[3].weight"]')
  await expect(over).toHaveCount(3)
  expect(await over.evaluateAll((els) => els.map((e) => e.getAttribute('data-week')))).toEqual([
    '6',
    '7',
    '8',
  ])
  await expect(SAVE(page)).toBeDisabled()

  // The foot bar's problem opens the card and focuses the weight's line.
  await expect(checkLine(page)).toHaveText('One problem, in Deadlift. Fix it to save.')
  await checkLine(page).click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(weight.locator('> button')).toBeFocused()

  // Fixed at +10 kg a week: no problems, the marks go, and Save is back.
  await weight.locator('> button').click()
  await page.getByTestId('value-amount').fill('10')
  await checked(page, sent, 3)
  expect(sent.drafts).toEqual(['beginner', 'deadlift-90', 'deadlift-10'])
  await expect(checkLine(page)).toHaveText('Checked. No problems.')
  await expect(weight.getByTestId('value-error')).toHaveCount(0)
  await expect(over).toHaveCount(0)
  await expect(SAVE(page)).toBeEnabled()
})

test('Save changes sends the loaded rev; on a 409, Escape keeps the edits and Save mine over it saves at the server’s rev', async ({
  page,
}) => {
  const sent = await openEditWithDeadlift(page)
  await valueLine(page, 'deadlift', 'weight').locator('> button').click()
  const amount = page.getByTestId('value-amount')
  await amount.fill('10')
  await checked(page, sent, 2)
  await expect(SAVE(page)).toHaveText('Save changes')
  const fixed = DRAFTS['deadlift-10'].doc
  const puts = () => bodies(sent, 'PUT', `/programmes/${BEGINNER.id}`)

  await SAVE(page).click()
  const dialog = page.getByRole('dialog', { name: 'Beginner 5×5 changed since you opened it' })
  await expect(dialog).toBeVisible()
  expect(puts()).toEqual([{ doc: fixed, rev: BEGINNER.rev }])

  // Escape closes the question and keeps the draft and the page.
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(new RegExp(`#/programmes/${BEGINNER.id}/edit$`))
  await expect(amount).toHaveValue('10')
  await expect(card(page, 'deadlift')).toContainText('+10 kg')

  // Saving again meets the conflict again; Save mine over it sends at the server's rev.
  await SAVE(page).click()
  await expect(dialog).toBeVisible()
  await dialog.getByTestId('conflict-mine').click()
  await expect(page).toHaveURL(/#\/programmes$/)
  expect(puts()).toEqual([
    { doc: fixed, rev: BEGINNER.rev },
    { doc: fixed, rev: BEGINNER.rev },
    { doc: fixed, rev: CONFLICT.rev },
  ])
  await expect(page.getByTestId('programmes-tab-library')).toHaveAttribute('aria-selected', 'true')
  await expect(
    libraryRow(page, BEGINNER.id).getByRole('heading', { name: 'Beginner 5×5' }),
  ).toBeFocused()
})

test('an exception week rests the legs in week 3: two ticks, Rest week in their cells only, saved', async ({
  page,
}) => {
  const sent = await openEditWithLegsRest(page)
  expect(sent.drafts).toEqual([
    'beginner',
    'exception-new',
    'exception-week-3',
    'rest-squat',
    'rest-legs',
  ])
  const rest = page.getByTestId('exception-rest')
  await expect(rest.getByRole('group')).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Rest these activities' })).toBeVisible()
  await expect(rest.getByRole('checkbox')).toHaveText([
    'Every activity',
    'Back squat',
    'Bench press',
    'Barbell row',
    'Deadlift',
    'Plank',
  ])
  await expect(restRow(page, 'Back squat')).toBeChecked()
  await expect(restRow(page, 'Deadlift')).toBeChecked()
  await expect(restRow(page, 'Bench press')).not.toBeChecked()
  await expect(restRow(page, 'Every activity')).not.toBeChecked()

  // The grid says Rest week in the two activities' week 3, and nowhere else.
  const grid = page.getByTestId('programme-grid')
  const rested = grid.locator('td[data-rest]')
  await expect(rested).toHaveCount(2)
  expect(
    await rested.evaluateAll((tds) =>
      tds.map((td) => `${td.getAttribute('data-activity')}:${td.getAttribute('data-week')}`),
    ),
  ).toEqual(['squat:3', 'deadlift:3'])
  await expect(rested).toContainText(['Rest week', 'Rest week'])
  await expect(grid.locator('td[data-activity="bench"][data-week="3"]')).not.toContainText(
    'Rest week',
  )

  // Closed, the exception week names its rests.
  await page.locator('[data-slot="exception-toggle"]').click()
  const week3 = page.getByTestId('exception-week').filter({ hasText: 'Week 3' })
  await expect(week3).toContainText('Rest: Back squat, Deadlift.')

  // Saved: the 409 first, as the beginner was saved elsewhere, then over it at the server's rev.
  await SAVE(page).click()
  const dialog = page.getByRole('dialog', { name: 'Beginner 5×5 changed since you opened it' })
  await dialog.getByTestId('conflict-mine').click()
  await expect(page).toHaveURL(/#\/programmes$/)
  const doc = DRAFTS['rest-legs'].doc
  expect(bodies(sent, 'PUT', `/programmes/${BEGINNER.id}`)).toEqual([
    { doc, rev: BEGINNER.rev },
    { doc, rev: CONFLICT.rev },
  ])
})
