import { readProgrammeFixture } from '@/lib/__tests__/fixtures'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { watch } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import ProgrammeBuilder, { CHECK_DELAY } from '@/components/ProgrammeBuilder.vue'
import { signedIn } from '@/lib/__tests__/signedIn'
import { withProgrammes, type Call, type Reply, type Route } from './programmesApi'
import LIBRARY_JSON from '@/lib/__tests__/programmes/library.json'
import START_JSON from '@/lib/__tests__/programmes/start-preview.json'
import { useProgrammesStore } from '@/stores/programmes'
import type { ProgrammeDoc } from '@/lib/programmeDraft'
import type { StartPreview } from '@/lib/programmes'

// jsdom has no scrollIntoView; Reka's menus and the copy landing reach for it.
Element.prototype.scrollIntoView ??= () => {}

const PID = LIBRARY_JSON.programmes[0]!.id
const NEW_ID = 'newprogramme1'
const BEGINNER = readProgrammeFixture('valid/beginner-5x5.json') as ProgrammeDoc
const RECORD = { ...LIBRARY_JSON.programmes[0]!, doc: BEGINNER }
const START = START_JSON as unknown as StartPreview
const LIMIT = 'week 6 comes to 510 kg. The most is 500.'

let wrapper: VueWrapper
let calls: Call[]
let routes: Record<string, Route>

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}
/** A change, then the check a moment after it. */
async function checked(): Promise<void> {
  await wait(CHECK_DELAY + 20)
  await settle()
}

/** The plan with the deadlift's weeks 6 to 8 over the limit, as the draft route marks them. */
function overLimitPlan(): StartPreview {
  const plan = structuredClone(START)
  plan.grid.weeks.forEach((week, i) => {
    if (i >= 5) week.cells.deadlift!.limits = { weight: 'activities[3].weight' }
  })
  return plan
}

/** The draft route as the server answers it, for the documents these tests make. */
function draft(body: unknown): Reply {
  const doc = (body as { doc: ProgrammeDoc }).doc
  const errors: { path: string; message: string }[] = []
  if (!doc.name.trim()) errors.push({ path: 'name', message: 'give a name of 1 to 60 characters.' })
  if (!doc.activities.length)
    errors.push({ path: 'activities', message: 'give 1 to 30 activities.' })
  doc.activities.forEach((a, i) => {
    if (!a.name)
      errors.push({ path: `activities[${i}].name`, message: 'give a name of 1 to 80 characters.' })
  })
  if (errors.length) return { body: { errors, plan: null } }
  const deadlift = doc.activities.findIndex(
    (a) => typeof a.weight === 'object' && (a.weight as { add?: number }).add === 90,
  )
  if (deadlift >= 0) {
    return {
      body: {
        errors: [{ path: `activities[${deadlift}].weight`, message: LIMIT }],
        plan: overLimitPlan(),
      },
    }
  }
  return { body: { errors: [], plan: START } }
}

async function open(
  hash: string,
  table: Record<string, Route> = {},
  runs: Record<string, unknown> = {},
): Promise<void> {
  history.replaceState(null, '', `/${hash}`)
  ;({ calls, routes } = withProgrammes(
    signedIn(),
    {
      'GET /programmes': { body: LIBRARY_JSON },
      [`GET /programmes/${PID}`]: { body: RECORD },
      'POST /programmes/draft': draft,
      'POST /programmes': (body) => ({
        body: { ...RECORD, id: NEW_ID, doc: (body as { doc: unknown }).doc },
      }),
      [`PUT /programmes/${PID}`]: (body) => ({
        body: { ...RECORD, rev: RECORD.rev + 1, doc: (body as { doc: unknown }).doc },
      }),
      ...table,
    },
    { today: '2026-11-12', runs },
  ))
  const pinia = createPinia()
  setActivePinia(pinia)
  wrapper = mount(App, { global: { plugins: [pinia] }, attachTo: document.body })
  await settle()
}

const openNew = (table?: Record<string, Route>) => open('#/programmes/new', table)
const openEdit = (table?: Record<string, Route>, runs?: Record<string, unknown>) =>
  open(`#/programmes/${PID}/edit`, table, runs)

const builder = () => wrapper.get('[data-testid="programme-builder"]')
const bar = () => wrapper.get('[data-testid="builder-bar"]')
const checkLine = () => wrapper.get('[data-testid="builder-check"]').text()
const save = () => wrapper.get<HTMLButtonElement>('[data-testid="builder-save"]')
const cards = () => wrapper.findAll('[data-testid="activity-card"]')
const card = (key: string) => wrapper.get(`[data-testid="activity-card"][data-activity="${key}"]`)
const drafts = () => calls.filter((c) => c.path === '/programmes/draft')
const confirmDialog = () => document.querySelector<HTMLElement>('[data-slot="confirm-dialog"]')
function dialogButton(label: string): HTMLElement {
  return [...confirmDialog()!.querySelectorAll<HTMLElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  )!
}
/** The open dialog: a question's ConfirmDialog, or the conflict's Dialog. */
const anyDialog = () =>
  document.querySelector<HTMLElement>('[data-slot="confirm-dialog"], [data-slot="dialog"]')
function anyDialogButton(label: string): HTMLElement {
  return [...anyDialog()!.querySelectorAll<HTMLElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  )!
}
/** An item of the open Menu, by its words. */
function menuItem(label: string): HTMLElement {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (i) => i.textContent?.trim() === label,
  )!
}
const menuItems = () =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((i) => i.textContent!.trim())
/** The draft the latest check sent. */
const lastDraft = () => (drafts().at(-1)!.body as { doc: ProgrammeDoc }).doc
/** What `get` finds: an element's wrapper. */
type Found = Omit<DOMWrapper<Element>, 'exists'>

function segment(root: Pick<Found, 'findAll'>, id: string, label: string) {
  return root.findAll(`[data-testid="${id}"] button`).find((b) => b.text() === label)!
}
function valueLine(root: Found, field: string) {
  return root.get(`[data-testid="value-line"][data-field="${field}"]`)
}
/** A primary-button press, as Reka's menu trigger hears it. */
async function press(target: Element): Promise<void> {
  target.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
  )
  ;(target as HTMLElement).click()
  await settle()
}

/** Each id the builder sets as the landing, as it sets it: the Programmes page clears it (W7). */
function landings(): (string | null)[] {
  const seen: (string | null)[] = []
  const store = useProgrammesStore()
  watch(
    () => store.landing,
    (id) => {
      if (id !== null) seen.push(id)
    },
    { flush: 'sync' },
  )
  return seen
}

// -- building, as a person does it --

/** Opens a value's line in an open card, sets its shape, and closes it again. */
async function setValue(
  at: Found,
  field: string,
  value:
    | number
    | {
        start: number
        add?: number
        rate?: number
        every?: number
        max?: number
        step?: number
      },
): Promise<void> {
  await valueLine(at, field).get('button').trigger('click')
  const line = valueLine(at, field)
  if (typeof value === 'number') {
    await segment(line, 'value-shape', 'Stays the same').trigger('click')
    await line.get('input[data-testid="value-start"]').setValue(String(value))
  } else {
    await segment(line, 'value-shape', 'Grows').trigger('click')
    await line.get('input[data-testid="value-start"]').setValue(String(value.start))
    if (value.rate !== undefined) {
      await segment(line, 'value-by', '%').trigger('click')
      await line.get('input[data-testid="value-amount"]').setValue(String(value.rate))
    } else {
      await line.get('input[data-testid="value-amount"]').setValue(String(value.add))
    }
    for (let n = 1; n < (value.every ?? 1); n++) {
      await line.get('[aria-label="More weeks between increases"]').trigger('click')
    }
    if (value.max !== undefined || value.step !== undefined) {
      await line.get('[data-testid="value-limits"]').trigger('click')
      if (value.max !== undefined) {
        await line.get('input[data-testid="value-max"]').setValue(String(value.max))
      }
      if (value.step !== undefined) {
        await line.get('input[data-testid="value-step"]').setValue(String(value.step))
      }
    }
  }
  await valueLine(at, field).get('button').trigger('click')
}

async function addActivity(name: string): Promise<Found> {
  await wrapper.get('[data-testid="activity-add"]').trigger('click')
  const added = cards().at(-1)!
  await added.get('input[data-testid="activity-name"]').setValue(name)
  return cards().at(-1)!
}

afterEach(() => {
  wrapper?.unmount()
  vi.unstubAllGlobals()
  history.replaceState(null, '', '/')
  document.body.replaceChildren()
})

describe('a new programme (spec B1)', () => {
  it('opens empty, with its head, its sections and the weeks waiting for a plan', async () => {
    await openNew()
    expect(builder().text()).toContain('Back to programmes')
    expect(builder().get('h1').text()).toBe('New programme')
    expect(builder().text()).toContain('Programmes')
    expect(wrapper.find('[data-testid="builder-runs"]').exists()).toBe(false)
    for (const id of [
      'builder-programme',
      'builder-activities',
      'builder-exceptions',
      'builder-params',
    ]) {
      expect(wrapper.find(`[data-testid="${id}"]`).exists()).toBe(true)
    }
    // A rest picks up where it stopped (K192); a deload carries on as planned.
    expect(wrapper.get('[data-testid="builder-exceptions"] p').text()).toBe(
      'A week whose values differ, such as a deload or a rest. After a deload the plan carries on as planned. After a rest, an activity picks up where it stopped.',
    )
    expect(wrapper.get<HTMLInputElement>('input[data-testid="builder-name"]').element.value).toBe(
      '',
    )
    expect(segment(wrapper, 'builder-kind', 'Strength').attributes('aria-pressed')).toBe('true')
    // The first check runs at once: an empty programme has two problems, and no plan yet.
    expect(drafts()).toHaveLength(1)
    expect(save().text()).toBe('Save to library')
    expect(wrapper.get('[data-testid="builder-kept"]').text()).toBe(
      'The weeks show the last version with no problems.',
    )
    expect(wrapper.find('[data-testid="programme-grid"]').exists()).toBe(false)
  })

  it('shows no problems until the first change or a press of Save (review fix 2)', async () => {
    await openNew()
    const name = () => wrapper.get('input[data-testid="builder-name"]')
    // Untouched: the check ran, but nothing is wrong yet in the person's eyes.
    expect(drafts()).toHaveLength(1)
    expect(checkLine()).toBe('Not saved yet.')
    expect(name().attributes('aria-invalid')).toBeUndefined()
    expect(wrapper.get('[data-testid="builder-activities"]').text()).not.toContain(
      'Give 1 to 30 activities.',
    )
    expect(save().element.disabled).toBe(false)
    // Save shows the problems, and sends nothing.
    await save().trigger('click')
    await settle()
    expect(calls.some((c) => c.method === 'POST' && c.path === '/programmes')).toBe(false)
    expect(checkLine()).toBe('Two problems, the first in the programme’s name. Fix them to save.')
    expect(save().element.disabled).toBe(true)
    // The problems show beside their fields, the server's sentence with a capital.
    expect(name().attributes('aria-invalid')).toBe('true')
    expect(document.getElementById(name().attributes('aria-describedby')!)!.textContent).toBe(
      'Give a name of 1 to 60 characters.',
    )
    expect(wrapper.get('[data-testid="builder-activities"]').text()).toContain(
      'Give 1 to 30 activities.',
    )
  })

  it('shows the problems once the first change is checked', async () => {
    await openNew()
    const name = wrapper.get('input[data-testid="builder-name"]')
    await name.setValue('Squats')
    // While the change is checked, the first check's problems stay out of sight.
    expect(checkLine()).toBe('Checking…')
    expect(wrapper.get('[data-testid="builder-activities"]').text()).not.toContain(
      'Give 1 to 30 activities.',
    )
    await checked()
    expect(checkLine()).toBe('One problem, in the activities. Fix it to save.')
    expect(wrapper.get('[data-testid="builder-activities"]').text()).toContain(
      'Give 1 to 30 activities.',
    )
  })

  it('builds the beginner 5×5 from empty and saves it to the library (B1, F8)', async () => {
    await openNew()
    const landed = landings()
    await wrapper.get('input[data-testid="builder-name"]').setValue('Beginner 5×5')
    await wrapper.get('textarea[data-testid="builder-description"]').setValue(BEGINNER.description!)
    let at = await addActivity('Back squat')
    await setValue(at, 'target', 3)
    await setValue(at, 'sets', 5)
    await setValue(at, 'reps', 5)
    await setValue(at, 'weight', { start: 40, rate: 5, step: 2.5 })
    for (const [name, start] of [
      ['Bench press', 30],
      ['Barbell row', 30],
    ] as const) {
      at = await addActivity(name)
      await setValue(at, 'target', 3)
      await setValue(at, 'sets', 5)
      await setValue(at, 'reps', 5)
      await setValue(at, 'weight', { start, add: 2.5, step: 2.5 })
    }
    at = await addActivity('Deadlift')
    await setValue(at, 'target', 3)
    await setValue(at, 'sets', 1)
    await setValue(at, 'reps', 5)
    await setValue(at, 'weight', { start: 60, add: 5, step: 2.5 })
    at = await addActivity('Plank')
    await setValue(at, 'target', 3)
    await segment(at, 'activity-measure', 'Time').trigger('click')
    await setValue(at, 'duration', { start: 30, add: 5, every: 2, max: 90 })
    // Only the newest card is open.
    expect(
      wrapper.findAll(
        '[data-testid="activity-card"] [aria-expanded="true"][data-slot="activity-toggle"]',
      ),
    ).toHaveLength(1)
    await checked()
    expect(checkLine()).toBe('Checked. No problems.')
    expect(wrapper.find('[data-testid="programme-grid"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="builder-kept"]').exists()).toBe(false)
    expect(save().element.disabled).toBe(false)
    await save().trigger('click')
    await settle()
    const post = calls.find((c) => c.method === 'POST' && c.path === '/programmes')!
    // Times a week stays at the 3 it shows, the format's default, so it is left out (B3).
    const expected = {
      format: 'tracker-programme/1',
      name: 'Beginner 5×5',
      description: BEGINNER.description,
      kind: 'strength',
      weeks: 8,
      activities: [
        {
          key: 'back-squat',
          name: 'Back squat',
          sets: 5,
          reps: 5,
          weight: { start: 40, rate: 5, step: 2.5 },
        },
        {
          key: 'bench-press',
          name: 'Bench press',
          sets: 5,
          reps: 5,
          weight: { start: 30, add: 2.5, step: 2.5 },
        },
        {
          key: 'barbell-row',
          name: 'Barbell row',
          sets: 5,
          reps: 5,
          weight: { start: 30, add: 2.5, step: 2.5 },
        },
        {
          key: 'deadlift',
          name: 'Deadlift',
          sets: 1,
          reps: 5,
          weight: { start: 60, add: 5, step: 2.5 },
        },
        {
          key: 'plank',
          name: 'Plank',
          sets: 3,
          duration: { start: 30, add: 5, every: 2, max: 90 },
        },
      ],
    }
    expect(JSON.stringify((post.body as { doc: unknown }).doc)).toBe(JSON.stringify(expected))
    // A new programme leaves the daily target out: its tracker starts at the kind's (K190).
    expect((post.body as { doc: object }).doc).not.toHaveProperty('dailyTarget')
    // The Programmes page opens, and the new row lands there (W7).
    expect(location.hash).toBe('#/programmes')
    expect(landed).toEqual([NEW_ID])
  })

  it('checks once, a moment after the last of several changes (F3)', async () => {
    await openNew()
    const name = wrapper.get('input[data-testid="builder-name"]')
    await name.setValue('B')
    await name.setValue('Be')
    await name.setValue('Bea')
    expect(checkLine()).toBe('Checking…')
    expect(save().element.disabled).toBe(true)
    await checked()
    expect(drafts()).toHaveLength(2)
    expect((drafts()[1]!.body as { doc: ProgrammeDoc }).doc.name).toBe('Bea')
  })

  it('drops an answer for a version that changed while it was on its way', async () => {
    let release: () => void = () => {}
    await openNew({
      'POST /programmes/draft': async (body) => {
        await new Promise<void>((resolve) => (release = resolve))
        return draft(body)
      },
    })
    release()
    await settle()
    await wrapper.get('input[data-testid="builder-name"]').setValue('Squats')
    await wait(CHECK_DELAY + 20)
    // The first check is on its way; a change now makes its answer stale.
    await wrapper.get('input[data-testid="builder-name"]').setValue('Squats only')
    release()
    await settle()
    expect(checkLine()).toBe('Checking…')
    await wait(CHECK_DELAY + 20)
    release()
    await settle()
    expect(checkLine()).toBe('One problem, in the activities. Fix it to save.')
  })

  it('keeps the last plan when the draft can’t be expanded (spec S2)', async () => {
    await openNew()
    await wrapper.get('input[data-testid="builder-name"]').setValue('Squats')
    await addActivity('Squat')
    await checked()
    expect(wrapper.find('[data-testid="programme-grid"]').exists()).toBe(true)
    await wrapper.get('input[data-testid="builder-name"]').setValue('')
    await checked()
    expect(wrapper.get('[data-testid="builder-kept"]').text()).toBe(
      'The weeks show the last version with no problems.',
    )
    expect(wrapper.find('[data-testid="programme-grid"]').exists()).toBe(true)
    expect(checkLine()).toBe('One problem, in the programme’s name. Fix it to save.')
  })

  it('writes the kind and the weeks', async () => {
    await openNew()
    await wrapper.get('[data-testid="builder-weeks"] [aria-label="More weeks"]').trigger('click')
    await segment(wrapper, 'builder-kind', 'Cardio').trigger('click')
    await checked()
    const doc = (drafts().at(-1)!.body as { doc: ProgrammeDoc }).doc
    expect(doc.weeks).toBe(9)
    expect(doc.kind).toBe('cardio')
    expect(doc).not.toHaveProperty('dailyTarget')
    expect(confirmDialog()).toBeNull()
  })

  it.each(['Strength', 'Mobility', 'Cardio'])(
    'has no Exercises a day for a %s programme: the tracker sets it (K190)',
    async (kind) => {
      await openNew()
      if (kind !== 'Strength') await segment(wrapper, 'builder-kind', kind).trigger('click')
      const programme = wrapper.get('[data-testid="builder-programme"]')
      expect(programme.text()).not.toContain('Exercises a day')
      expect(programme.find('[data-testid="builder-daily"]').exists()).toBe(false)
      expect(programme.find('[aria-label="More exercises a day"]').exists()).toBe(false)
    },
  )

  it('asks before a kind change drops fields, and keeps the kind on Cancel (F6)', async () => {
    await openEdit()
    await segment(wrapper, 'builder-kind', 'Mobility').trigger('click')
    await settle()
    expect(confirmDialog()!.textContent).toContain('Change to Mobility?')
    expect(confirmDialog()!.textContent).toContain('Weight goes from 4 activities.')
    dialogButton('Cancel').click()
    await settle()
    expect(segment(wrapper, 'builder-kind', 'Strength').attributes('aria-pressed')).toBe('true')
    await segment(wrapper, 'builder-kind', 'Mobility').trigger('click')
    await settle()
    dialogButton('Change kind').click()
    await settle()
    expect(segment(wrapper, 'builder-kind', 'Mobility').attributes('aria-pressed')).toBe('true')
    await card('squat').get('[data-slot="activity-toggle"]').trigger('click')
    expect(card('squat').find('[data-field="weight"]').exists()).toBe(false)
  })

  it('changes kind at once when nothing would go', async () => {
    await openEdit()
    await segment(wrapper, 'builder-kind', 'Strength').trigger('click')
    const doc = (await (async () => {
      await segment(wrapper, 'builder-kind', 'Mobility').trigger('click')
      await settle()
      dialogButton('Change kind').click()
      await settle()
      await segment(wrapper, 'builder-kind', 'Strength').trigger('click')
      await settle()
      return confirmDialog()
    })()) as HTMLElement | null
    // Mobility to strength drops nothing: no question.
    expect(doc).toBeNull()
    expect(segment(wrapper, 'builder-kind', 'Strength').attributes('aria-pressed')).toBe('true')
  })
})

describe('the activities', () => {
  it('opens one card at a time, and adds a card of the programme’s kind, open', async () => {
    await openEdit()
    expect(cards()).toHaveLength(5)
    expect(wrapper.get('[data-testid="builder-activities"]').text()).toContain(
      'Five of at most 30. Press one to change it.',
    )
    await card('bench').get('[data-slot="activity-toggle"]').trigger('click')
    await card('row').get('[data-slot="activity-toggle"]').trigger('click')
    expect(card('bench').get('[data-slot="activity-toggle"]').attributes('aria-expanded')).toBe(
      'false',
    )
    expect(card('row').get('[data-slot="activity-toggle"]').attributes('aria-expanded')).toBe(
      'true',
    )
    await card('row').get('[data-slot="activity-toggle"]').trigger('click')
    expect(card('row').get('[data-slot="activity-toggle"]').attributes('aria-expanded')).toBe(
      'false',
    )
    await wrapper.get('[data-testid="activity-add"]').trigger('click')
    await settle()
    expect(cards()).toHaveLength(6)
    expect(cards()[5]!.attributes('data-activity')).toBe('activity')
    expect(document.activeElement).toBe(
      cards()[5]!.get('input[data-testid="activity-name"]').element,
    )
  })

  it('moves a card, keeping it open and its ⋯ focused', async () => {
    await openEdit()
    await card('bench').get('[data-slot="activity-toggle"]').trigger('click')
    await press(card('bench').get('[data-testid="activity-menu"]').element)
    document.querySelector<HTMLElement>('[data-testid="activity-move-up"]')!.click()
    await settle()
    expect(cards().map((c) => c.attributes('data-activity'))).toEqual([
      'bench',
      'squat',
      'row',
      'deadlift',
      'plank',
    ])
    expect(card('bench').get('[data-slot="activity-toggle"]').attributes('aria-expanded')).toBe(
      'true',
    )
    expect(document.activeElement).toBe(card('bench').get('[data-testid="activity-menu"]').element)
    // Moving the card past the open one keeps that one open.
    await press(card('row').get('[data-testid="activity-menu"]').element)
    document.querySelector<HTMLElement>('[data-testid="activity-move-up"]')!.click()
    await settle()
    await press(card('row').get('[data-testid="activity-menu"]').element)
    document.querySelector<HTMLElement>('[data-testid="activity-move-up"]')!.click()
    await settle()
    expect(cards()[0]!.attributes('data-activity')).toBe('row')
    expect(card('bench').get('[data-slot="activity-toggle"]').attributes('aria-expanded')).toBe(
      'true',
    )
  })

  it('removes a card with its exception entries, and moves focus on (F7)', async () => {
    await openEdit()
    await card('row').get('[data-slot="activity-toggle"]').trigger('click')
    await press(card('deadlift').get('[data-testid="activity-menu"]').element)
    document.querySelector<HTMLElement>('[data-testid="activity-remove"]')!.click()
    await settle()
    expect(cards()).toHaveLength(4)
    expect(document.activeElement).toBe(card('plank').get('[data-slot="activity-toggle"]').element)
    expect(card('row').get('[data-slot="activity-toggle"]').attributes('aria-expanded')).toBe(
      'true',
    )
    // The deload's own deadlift entry went with it.
    expect(wrapper.get('[data-testid="builder-exceptions"]').text()).not.toContain('Deadlift')
    // The open card goes when removed; the last card's focus goes to Add activity.
    await press(card('row').get('[data-testid="activity-menu"]').element)
    document.querySelector<HTMLElement>('[data-testid="activity-remove"]')!.click()
    await settle()
    expect(wrapper.findAll('[data-slot="activity-toggle"][aria-expanded="true"]')).toHaveLength(0)
    await press(card('plank').get('[data-testid="activity-menu"]').element)
    document.querySelector<HTMLElement>('[data-testid="activity-remove"]')!.click()
    await settle()
    expect(document.activeElement).toBe(wrapper.get('[data-testid="activity-add"]').element)
  })

  it('removing a card before the open one keeps the same card open', async () => {
    await openEdit()
    await card('plank').get('[data-slot="activity-toggle"]').trigger('click')
    await press(card('squat').get('[data-testid="activity-menu"]').element)
    document.querySelector<HTMLElement>('[data-testid="activity-remove"]')!.click()
    await settle()
    expect(card('plank').get('[data-slot="activity-toggle"]').attributes('aria-expanded')).toBe(
      'true',
    )
  })
})

describe('problems beside their fields (F4)', () => {
  it('shows a week over the limit under its field and on its closed card; Save waits', async () => {
    await openEdit()
    await checked()
    expect(checkLine()).toBe('Checked. No problems.')
    const deadlift = card('deadlift')
    await deadlift.get('[data-slot="activity-toggle"]').trigger('click')
    await valueLine(deadlift, 'weight').get('button').trigger('click')
    await valueLine(deadlift, 'weight').get('input[data-testid="value-amount"]').setValue('90')
    await checked()
    const message = 'Week 6 comes to 510 kg. The most is 500.'
    // Open, the problem sits at the foot of the weight's group.
    expect(valueLine(card('deadlift'), 'weight').get('[role="group"]').text()).toContain(message)
    expect(checkLine()).toBe('One problem, in Deadlift. Fix it to save.')
    expect(save().element.disabled).toBe(true)
    // The grid marks the weeks over the limit.
    const marked = wrapper.findAll('td[data-activity="deadlift"][data-limit]')
    expect(marked.map((td) => td.attributes('data-week'))).toEqual(['6', '7', '8'])
    // Closed, the card says it under its rule.
    await card('deadlift').get('[data-slot="activity-toggle"]').trigger('click')
    expect(card('deadlift').get('[data-testid="activity-problem"]').text()).toBe(message)
    // Fixed, the check passes and Save is ready.
    await card('deadlift').get('[data-slot="activity-toggle"]').trigger('click')
    await valueLine(card('deadlift'), 'weight').get('button').trigger('click')
    await valueLine(card('deadlift'), 'weight')
      .get('input[data-testid="value-amount"]')
      .setValue('5')
    await checked()
    expect(checkLine()).toBe('Checked. No problems.')
    expect(save().element.disabled).toBe(false)
  })

  it('opens the card and focuses the field when the foot bar’s problem is pressed', async () => {
    const plan = overLimitPlan()
    await openEdit({
      'POST /programmes/draft': {
        body: { errors: [{ path: 'activities[3].weight.add', message: LIMIT }], plan },
      },
    })
    expect(checkLine()).toBe('One problem, in Deadlift. Fix it to save.')
    await wrapper.get('button[data-testid="builder-check"]').trigger('click')
    await settle()
    expect(card('deadlift').get('[data-slot="activity-toggle"]').attributes('aria-expanded')).toBe(
      'true',
    )
    expect(document.activeElement).toBe(
      card('deadlift').get('input[data-testid="value-amount"]').element,
    )
  })

  it('names the first of several problems, and focuses a programme field', async () => {
    await openEdit({
      'POST /programmes/draft': {
        body: {
          errors: [
            { path: 'weeks', message: 'give a whole number of weeks from 1 to 156.' },
            { path: 'activities[0].name', message: 'give a name of 1 to 80 characters.' },
            { path: 'description', message: 'keep it to 2,000 characters.' },
          ],
          plan: null,
        },
      },
    })
    expect(checkLine()).toBe('Three problems, the first in the number of weeks. Fix them to save.')
    expect(wrapper.get('[data-testid="builder-programme"]').text()).toContain(
      'Give a whole number of weeks from 1 to 156.',
    )
    expect(
      wrapper.get('textarea[data-testid="builder-description"]').attributes('aria-invalid'),
    ).toBe('true')
    await wrapper.get('button[data-testid="builder-check"]').trigger('click')
    await settle()
    expect(document.activeElement).toBe(wrapper.get('[data-testid="builder-weeks"] input').element)
  })

  /** The draft route finding one problem, at `path`. */
  const oneProblem = (path: string) => ({
    'POST /programmes/draft': {
      body: { errors: [{ path, message: 'something is wrong.' }], plan: null },
    },
  })

  it.each([
    ['name', 'the programme’s name', 'input[data-testid="builder-name"]'],
    ['description', 'the description', 'textarea[data-testid="builder-description"]'],
    ['kind', 'the kind', '[data-testid="builder-kind"] button[aria-pressed="true"]'],
    ['activities', 'the activities', '[data-testid="activity-add"]'],
    ['overrides[0].weeks', 'the exception weeks', 'input[data-testid="exception-weeks"]'],
    [
      'overrides[0].activities.deadlift.sets',
      'the exception weeks',
      '[data-testid="exception-group"][data-activity="deadlift"] [data-testid="exception-value"] input',
    ],
    ['overrides[3]', 'the exception weeks', '[data-testid="builder-exceptions"] h2'],
    ['params.squat.default', 'Squat start', 'input[data-testid="start-value-default"]'],
    ['params.rate.key', 'Weekly increase', 'input[data-testid="start-value-key"]'],
    ['params.gone', 'the values chosen at start', '[data-testid="builder-params"] h2'],
    ['activities[9].name', 'the activities', '[data-testid="activity-add"]'],
  ])('names a problem at %s as “%s” and focuses its place', async (path, where, focus) => {
    await openEdit(oneProblem(path))
    expect(checkLine()).toBe(`One problem, in ${where}. Fix it to save.`)
    await wrapper.get('button[data-testid="builder-check"]').trigger('click')
    await settle()
    expect(document.activeElement).toBe(wrapper.get(focus).element)
  })

  it.each([
    ['format', true],
    ['', false],
  ])('names a problem at “%s” in the foot bar, as no button', async (path, inSection) => {
    await openEdit(oneProblem(path))
    expect(checkLine()).toBe('One problem, in the programme. Fix it to save.')
    expect(wrapper.find('button[data-testid="builder-check"]').exists()).toBe(false)
    // A programme key with no field shows at the section's top; a problem with no path doesn't.
    expect(
      wrapper.get('[data-testid="builder-programme"]').text().includes('Something is wrong.'),
    ).toBe(inSection)
  })

  it('shows a problem with the daily target in the programme section (K190)', async () => {
    await openEdit(oneProblem('dailyTarget'))
    expect(checkLine()).toBe('One problem, in the daily target. Fix it to save.')
    expect(wrapper.find('button[data-testid="builder-check"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="builder-programme"]').text()).toContain('Something is wrong.')
  })

  it('names an unnamed activity by its place', async () => {
    await openNew()
    await wrapper.get('input[data-testid="builder-name"]').setValue('Squats')
    await wrapper.get('[data-testid="activity-add"]').trigger('click')
    await checked()
    expect(checkLine()).toBe('One problem, in activity 1. Fix it to save.')
  })

  it('shows exception week and start value problems beside their fields', async () => {
    await openEdit({
      'POST /programmes/draft': {
        body: {
          errors: [
            { path: 'overrides[0].weeks', message: 'week 9 is after the last week.' },
            { path: 'params.squat.default', message: 'give a default from 20 to 200.' },
            { path: 'overrides', message: 'give at most 20 exception weeks.' },
            { path: 'params', message: 'give at most 20 values.' },
          ],
          plan: null,
        },
      },
    })
    // Closed, each row says its problem under its words.
    expect(wrapper.get('[data-testid="exception-week"]').text()).toContain(
      'Week 9 is after the last week.',
    )
    expect(wrapper.get('[data-testid="start-value"][data-param="squat"]').text()).toContain(
      'Give a default from 20 to 200.',
    )
    // A problem with the section as a whole sits at its top.
    expect(wrapper.get('[data-testid="builder-exceptions"]').text()).toContain(
      'Give at most 20 exception weeks.',
    )
    expect(wrapper.get('[data-testid="builder-params"]').text()).toContain(
      'Give at most 20 values.',
    )
    // Open, the problem is under its field.
    await wrapper.get('[data-testid="exception-open"]').trigger('click')
    const weeks = wrapper.get('input[data-testid="exception-weeks"]')
    expect(weeks.attributes('aria-invalid')).toBe('true')
    expect(document.getElementById(weeks.attributes('aria-describedby')!)!.textContent).toBe(
      'Week 9 is after the last week.',
    )
    await wrapper
      .get('[data-testid="start-value"][data-param="squat"] [data-testid="start-value-open"]')
      .trigger('click')
    const def = wrapper.get('input[data-testid="start-value-default"]')
    expect(def.attributes('aria-invalid')).toBe('true')
    expect(document.getElementById(def.attributes('aria-describedby')!)!.textContent).toBe(
      'Give a default from 20 to 200.',
    )
  })

  it('says why the check didn’t run, and runs it again after the next change', async () => {
    await openNew({ 'POST /programmes/draft': { status: 500, body: {} } })
    expect(checkLine()).toBe(
      'The check didn’t run. The server had a problem, so nothing changed. Try again in a while.',
    )
    expect(save().element.disabled).toBe(true)
    routes['POST /programmes/draft'] = draft
    await wrapper.get('input[data-testid="builder-name"]').setValue('Squats')
    await checked()
    expect(checkLine()).toBe('One problem, in the activities. Fix it to save.')
  })

  it('shows the problems a check found as a refusal', async () => {
    await openEdit({
      'POST /programmes/draft': {
        status: 400,
        body: { error: 'invalid', errors: [{ path: 'name', message: 'give a name.' }] },
      },
    })
    expect(checkLine()).toBe('One problem, in the programme’s name. Fix it to save.')
  })
})

describe('a library programme (spec B2, B3)', () => {
  it('opens the programme as stored, under “Edit programme”', async () => {
    await openEdit()
    expect(builder().get('h1').text()).toBe('Beginner 5×5')
    expect(builder().text()).toContain('Edit programme')
    expect(wrapper.get<HTMLInputElement>('input[data-testid="builder-name"]').element.value).toBe(
      'Beginner 5×5',
    )
    expect(wrapper.find('[data-testid="builder-runs"]').exists()).toBe(false)
    expect(save().text()).toBe('Save changes')
    expect(checkLine()).toBe('Checked. No problems.')
    // The exception weeks and the values chosen at start, as their closed rows.
    const exceptions = wrapper.get('[data-testid="exception-week"]').text()
    expect(exceptions).toContain('Weeks 4 and 8 · Deload')
    expect(exceptions).toContain('Every activity: 3 sets, 90% of the weight.')
    expect(exceptions).toContain('Deadlift: 1 set.')
    const squat = wrapper.get('[data-testid="start-value"][data-param="squat"]').text()
    expect(squat).toContain('Squat start')
    expect(squat).toContain('40 kg by default')
    expect(squat).toContain('Used by Back squat’s weight')
  })

  it('saves an untouched programme as the same document, at the rev it loaded (B3)', async () => {
    await openEdit()
    const landed = landings()
    await save().trigger('click')
    await settle()
    const put = calls.find((c) => c.method === 'PUT')!
    const body = put.body as { doc: unknown; rev: number }
    expect(JSON.stringify(body.doc)).toBe(JSON.stringify(BEGINNER))
    expect(body.rev).toBe(RECORD.rev)
    expect(location.hash).toBe('#/programmes')
    expect(landed).toEqual([PID])
  })

  it('keeps a loaded daily target as it is, in its place, on save (B3, K190)', async () => {
    const doc = { ...BEGINNER, dailyTarget: 2 }
    await openEdit({ [`GET /programmes/${PID}`]: { body: { ...RECORD, doc } } })
    await wrapper.get('input[data-testid="builder-name"]').setValue('Beginner 5×5, two a day')
    await checked()
    await save().trigger('click')
    await settle()
    const saved = (calls.find((c) => c.method === 'PUT')!.body as { doc: ProgrammeDoc }).doc
    expect(saved.dailyTarget).toBe(2)
    expect(Object.keys(saved)).toEqual(Object.keys(doc))
    expect(JSON.stringify(saved)).toBe(JSON.stringify({ ...doc, name: 'Beginner 5×5, two a day' }))
  })

  it('says runs keep their own copy when the programme has a run (F10)', async () => {
    await openEdit(
      {},
      {
        t1: {
          programmeId: PID,
          name: 'Beginner 5×5',
          status: 'running',
          week: 4,
          weeks: 8,
          start: '2026-10-23',
          end: '2026-12-13',
          pausedUntil: null,
          rev: 'r1',
        },
      },
    )
    expect(wrapper.get('[data-testid="builder-runs"]').text()).toBe(
      'Runs already started keep their own copy.',
    )
  })

  it('says why the programme couldn’t open', async () => {
    await openEdit({ [`GET /programmes/${PID}`]: { status: 404, body: { error: 'not-found' } } })
    expect(builder().text()).toContain(
      'The programme couldn’t open. That programme is gone. It may have been deleted on another device.',
    )
    expect(wrapper.find('[data-testid="builder-programme"]').exists()).toBe(false)
    expect(save().element.disabled).toBe(true)
  })

  it('says it can’t open offline', async () => {
    await openEdit({ [`GET /programmes/${PID}`]: 'offline' })
    expect(builder().text()).toContain(
      'The programme couldn’t open. Can’t reach the server, so nothing changed.',
    )
  })
})

describe('saving (F8)', () => {
  it('offers the saved version or saving over it on a conflict: Save mine over it', async () => {
    const server = { ...RECORD, rev: RECORD.rev + 3, doc: { ...BEGINNER, name: 'Beginner 5×5, B' } }
    let puts = 0
    await openEdit({
      [`PUT /programmes/${PID}`]: (body) => {
        puts++
        if (puts === 1)
          return { status: 409, body: { error: 'conflict', rev: server.rev, programme: server } }
        return { body: { ...server, rev: server.rev + 1, doc: (body as { doc: unknown }).doc } }
      },
    })
    await wrapper.get('input[data-testid="builder-name"]').setValue('Beginner 5×5, mine')
    await checked()
    await save().trigger('click')
    await settle()
    expect(anyDialog()!.textContent).toContain('Beginner 5×5 changed since you opened it')
    expect(anyDialog()!.textContent).toContain(
      'It was saved somewhere else. Load the saved version to see it, or save yours over it.',
    )
    anyDialogButton('Save mine over it').click()
    await settle()
    const second = calls.filter((c) => c.method === 'PUT')[1]!.body as {
      doc: ProgrammeDoc
      rev: number
    }
    expect(second.rev).toBe(server.rev)
    expect(second.doc.name).toBe('Beginner 5×5, mine')
    expect(location.hash).toBe('#/programmes')
  })

  it('loads the saved version on a conflict, then saves at its rev', async () => {
    const server = { ...RECORD, rev: RECORD.rev + 3, doc: { ...BEGINNER, name: 'Beginner 5×5, B' } }
    await openEdit({
      [`PUT /programmes/${PID}`]: {
        status: 409,
        body: { error: 'conflict', rev: server.rev, programme: server },
      },
    })
    await wrapper.get('input[data-testid="builder-name"]').setValue('Beginner 5×5, mine')
    await checked()
    await save().trigger('click')
    await settle()
    anyDialogButton('Load the saved version').click()
    await settle()
    expect(wrapper.get<HTMLInputElement>('input[data-testid="builder-name"]').element.value).toBe(
      'Beginner 5×5, B',
    )
    expect(builder().get('h1').text()).toBe('Beginner 5×5, B')
    expect(location.hash).toBe(`#/programmes/${PID}/edit`)
    routes[`PUT /programmes/${PID}`] = (body) => ({
      body: { ...server, doc: (body as { doc: unknown }).doc },
    })
    await settle()
    expect(save().element.disabled).toBe(false)
    await save().trigger('click')
    await settle()
    expect((calls.filter((c) => c.method === 'PUT').at(-1)!.body as { rev: number }).rev).toBe(
      server.rev,
    )
  })

  /** Opens the programme, changes its name, and saves into a 409. */
  async function conflictOnSave(): Promise<void> {
    const server = { ...RECORD, rev: RECORD.rev + 3, doc: { ...BEGINNER, name: 'Beginner 5×5, B' } }
    await openEdit({
      [`PUT /programmes/${PID}`]: {
        status: 409,
        body: { error: 'conflict', rev: server.rev, programme: server },
      },
    })
    await wrapper.get('input[data-testid="builder-name"]').setValue('Beginner 5×5, mine')
    await checked()
    await save().trigger('click')
    await settle()
    expect(anyDialog()!.textContent).toContain('Beginner 5×5 changed since you opened it')
  }
  /** The page still holds the person's draft, at its own address, and saved nothing more. */
  function keptMine(): void {
    expect(anyDialog()).toBeNull()
    expect(wrapper.get<HTMLInputElement>('input[data-testid="builder-name"]').element.value).toBe(
      'Beginner 5×5, mine',
    )
    expect(builder().get('h1').text()).toBe('Beginner 5×5')
    expect(location.hash).toBe(`#/programmes/${PID}/edit`)
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1)
  }

  it('keeps the person’s changes when the conflict is closed with Escape (review fix 1)', async () => {
    await conflictOnSave()
    ;(document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    await settle()
    keptMine()
    // Saving again meets the conflict again: the choice is still the person's.
    expect(save().element.disabled).toBe(false)
    await save().trigger('click')
    await settle()
    expect(anyDialog()!.textContent).toContain('Beginner 5×5 changed since you opened it')
  })

  it('keeps the person’s changes when the conflict is closed with its Close button', async () => {
    await conflictOnSave()
    const close = anyDialog()!.querySelector<HTMLElement>('[aria-label="Close"]')
    expect(close).not.toBeNull()
    close!.click()
    await settle()
    keptMine()
  })

  it('shows the problems a save was refused with, and says why a save failed', async () => {
    await openEdit({
      [`PUT /programmes/${PID}`]: {
        status: 400,
        body: { error: 'invalid', errors: [{ path: 'name', message: 'that name is taken.' }] },
      },
    })
    await save().trigger('click')
    await settle()
    expect(checkLine()).toBe('One problem, in the programme’s name. Fix it to save.')
    expect(wrapper.text()).toContain('That name is taken.')
    routes[`PUT /programmes/${PID}`] = { status: 500, body: {} }
    await wrapper.get('input[data-testid="builder-name"]').setValue('Beginner 5×5 again')
    await checked()
    await save().trigger('click')
    await settle()
    expect(bar().text()).toContain(
      'The server had a problem, so nothing changed. Try again in a while.',
    )
    expect(save().element.disabled).toBe(false)
    expect(location.hash).toBe(`#/programmes/${PID}/edit`)
  })

  it('says why a new programme wasn’t added', async () => {
    await openNew({ 'POST /programmes': { status: 500, body: {} } })
    await wrapper.get('input[data-testid="builder-name"]').setValue('Squats')
    await addActivity('Squat')
    await checked()
    await save().trigger('click')
    await settle()
    expect(bar().text()).toContain('The server had a problem, so nothing changed.')
    routes['POST /programmes'] = {
      status: 400,
      body: {
        error: 'invalid',
        errors: [{ path: 'activities[0].key', message: 'that key is taken.' }],
      },
    }
    await save().trigger('click')
    await settle()
    expect(checkLine()).toBe('One problem, in Squat. Fix it to save.')
  })

  it('waits offline: the check and Save need the server', async () => {
    await openEdit()
    window.dispatchEvent(new Event('offline'))
    await settle()
    expect(checkLine()).toBe('Offline. Saving needs the server.')
    expect(save().element.disabled).toBe(true)
    await wrapper.get('input[data-testid="builder-name"]').setValue('Beginner 5×5, offline')
    await checked()
    const before = drafts().length
    expect(checkLine()).toBe('Offline. Saving needs the server.')
    window.dispatchEvent(new Event('online'))
    await settle()
    expect(drafts().length).toBe(before + 1)
    expect(checkLine()).toBe('Checked. No problems.')
  })
})

describe('exception weeks and values chosen at start (W6)', () => {
  /** The beginner 5×5 without some of its parts, as a Library programme. */
  function without(change: (doc: ProgrammeDoc) => void): Record<string, Route> {
    const doc = structuredClone(BEGINNER) as ProgrammeDoc
    change(doc)
    return { [`GET /programmes/${PID}`]: { body: { ...RECORD, doc } } }
  }
  const exception = (i = 0) => wrapper.findAll('[data-testid="exception-week"]')[i]!
  const group = (key: string) =>
    exception().get(`[data-testid="exception-group"][data-activity="${key}"]`)
  const value = (key: string, field: string) =>
    group(key).get(`[data-testid="exception-value"][data-field="${field}"]`)
  async function addValue(key: string, field: string): Promise<void> {
    await press(group(key).get('[data-testid="exception-value-add"]').element)
    menuItem(field).click()
    await settle()
  }
  const startValue = (key: string) =>
    wrapper.get(`[data-testid="start-value"][data-param="${key}"]`)
  const openStart = () =>
    wrapper.findAll('[data-testid="start-value"]').find((r) => r.find('[role="group"]').exists())!

  it('builds the beginner’s deload, which comes out as the fixture’s overrides', async () => {
    await openEdit(without((doc) => delete doc.overrides))
    expect(wrapper.findAll('[data-testid="exception-week"]')).toHaveLength(0)
    await wrapper.get('[data-testid="exception-add"]').trigger('click')
    await settle()
    // Added open, its Weeks field focused, with every field empty.
    expect(document.activeElement).toBe(
      exception().get('input[data-testid="exception-weeks"]').element,
    )
    await exception().get('input[data-testid="exception-weeks"]').setValue('4, 8')
    await exception().get('input[data-testid="exception-label"]').setValue('Deload')
    await addValue('*', 'Sets')
    await value('*', 'sets').get('input').setValue('3')
    await addValue('*', 'Weight')
    await segment(value('*', 'weight'), 'exception-value-mode', '% of planned').trigger('click')
    await value('*', 'weight').get('input').setValue('90')
    await press(exception().get('[data-testid="exception-group-add"]').element)
    expect(menuItems()).toEqual(['Back squat', 'Bench press', 'Barbell row', 'Deadlift', 'Plank'])
    menuItem('Deadlift').click()
    await settle()
    await addValue('deadlift', 'Sets')
    await value('deadlift', 'sets').get('input').setValue('1')
    await checked()
    expect(JSON.stringify(lastDraft().overrides)).toBe(JSON.stringify(BEGINNER.overrides))
    expect(JSON.stringify(lastDraft())).toBe(JSON.stringify(BEGINNER))
    // Closed again, the row says what it changes.
    await exception().get('[data-slot="exception-toggle"]').trigger('click')
    expect(exception().text()).toContain('Weeks 4 and 8 · Deload')
    expect(document.activeElement).toBe(exception().get('[data-testid="exception-open"]').element)
  })

  it('removes an exception week, and focus moves to Add exception week', async () => {
    await openEdit()
    // A new week, removed at once, leaves the deload.
    await wrapper.get('[data-testid="exception-add"]').trigger('click')
    await settle()
    await exception(1).get('[data-testid="exception-remove"]').trigger('click')
    await settle()
    expect(wrapper.findAll('[data-testid="exception-week"]')).toHaveLength(1)
    expect(document.activeElement).toBe(wrapper.get('[data-testid="exception-add"]').element)
    await wrapper.get('[data-testid="exception-open"]').trigger('click')
    await exception().get('[data-testid="exception-remove"]').trigger('click')
    await settle()
    expect(wrapper.findAll('[data-testid="exception-week"]')).toHaveLength(0)
    expect(document.activeElement).toBe(wrapper.get('[data-testid="exception-add"]').element)
    await checked()
    expect(lastDraft()).not.toHaveProperty('overrides')
  })

  it('keeps the open exception week open when a change elsewhere takes an earlier one', async () => {
    await openEdit(
      without((doc) => {
        doc.overrides = [
          { weeks: [4], activities: { deadlift: { sets: 1 } } },
          { weeks: [6], activities: { '*': { reps: 3 } } },
          { weeks: [7], activities: { deadlift: { reps: 2 } } },
        ]
      }),
    )
    await exception(1).get('[data-testid="exception-open"]').trigger('click')
    // Removing the deadlift takes the weeks that held only its values; week 6 stays open.
    await press(card('deadlift').get('[data-testid="activity-menu"]').element)
    document.querySelector<HTMLElement>('[data-testid="activity-remove"]')!.click()
    await settle()
    expect(wrapper.findAll('[data-testid="exception-week"]')).toHaveLength(1)
    expect(exception().get('[data-slot="exception-head"]').text()).toBe('Week 6')
    expect(exception().find('[data-testid="exception-remove"]').exists()).toBe(true)
    // A kind with no reps takes week 6 itself: nothing is left open.
    await segment(wrapper, 'builder-kind', 'Cardio').trigger('click')
    await settle()
    anyDialogButton('Change kind').click()
    await settle()
    expect(wrapper.findAll('[data-testid="exception-week"]')).toHaveLength(0)
    await wrapper.get('[data-testid="exception-add"]').trigger('click')
    await settle()
    expect(exception().find('[data-testid="exception-remove"]').exists()).toBe(true)
  })

  it('builds the squat and rate values, and a field picks them from its Menu', async () => {
    await openEdit(
      without((doc) => {
        delete doc.params
        doc.activities[0]!.weight = { start: 40, rate: 5, step: 2.5 }
      }),
    )
    for (const [label, unit, def, min, max, key] of [
      ['Squat start', 'kg', '40', '20', '200', 'squat'],
      ['Weekly increase', '%', '5', '0', '20', 'rate'],
    ] as const) {
      await wrapper.get('[data-testid="start-value-add"]').trigger('click')
      await settle()
      // Added open, its Label focused.
      expect(document.activeElement).toBe(
        openStart().get('input[data-testid="start-value-label"]').element,
      )
      await openStart().get('input[data-testid="start-value-label"]').setValue(label)
      await openStart().get('input[data-testid="start-value-unit"]').setValue(unit)
      await openStart().get('input[data-testid="start-value-default"]').setValue(def)
      await openStart().get('input[data-testid="start-value-min"]').setValue(min)
      await openStart().get('input[data-testid="start-value-max"]').setValue(max)
      await openStart().get('[data-testid="start-value-more"]').trigger('click')
      await openStart().get('input[data-testid="start-value-key"]').setValue(key)
    }
    // Back squat's weight takes both: its start, and its amount as a percentage.
    await card('squat').get('[data-slot="activity-toggle"]').trigger('click')
    // Opening the card closed the value.
    expect(wrapper.findAll('[data-testid="start-value"] [role="group"]')).toHaveLength(0)
    await valueLine(card('squat'), 'weight').get('button').trigger('click')
    const weight = valueLine(card('squat'), 'weight')
    await weight.findAll('[data-testid="value-use-param"]')[0]!.trigger('click')
    await valueLine(card('squat'), 'weight')
      .findAll('[data-testid="value-use-param"]')[0]!
      .trigger('click')
    expect(
      valueLine(card('squat'), 'weight')
        .findAll('[data-testid="value-param-pick"]')
        .map((b) => b.text()),
    ).toEqual(['Squat start · 40 kg', 'Weekly increase · 5%'])
    await checked()
    expect(JSON.stringify(lastDraft())).toBe(JSON.stringify(BEGINNER))
    expect(startValue('squat').text()).toContain('Used by Back squat’s weight')
  })

  it('refuses to remove a value a field uses, naming the field; an unused one goes', async () => {
    await openEdit()
    await startValue('squat').get('[data-testid="start-value-open"]').trigger('click')
    await startValue('squat').get('[data-testid="start-value-remove"]').trigger('click')
    expect(startValue('squat').get('[data-testid="start-value-refused"]').text()).toBe(
      'Back squat’s weight uses Squat start. Give that field a number first, then remove it.',
    )
    await checked()
    expect(Object.keys(lastDraft().params!)).toEqual(['squat', 'rate'])
    // A new value, unused, goes at once; focus moves to Add a value.
    await wrapper.get('[data-testid="start-value-add"]').trigger('click')
    await settle()
    expect(wrapper.findAll('[data-testid="start-value"]')).toHaveLength(3)
    await openStart().get('[data-testid="start-value-remove"]').trigger('click')
    await settle()
    expect(wrapper.findAll('[data-testid="start-value"]')).toHaveLength(2)
    expect(document.activeElement).toBe(wrapper.get('[data-testid="start-value-add"]').element)
    await checked()
    expect(JSON.stringify(lastDraft())).toBe(JSON.stringify(BEGINNER))
  })

  it('keeps one card open across the page: activities, exception weeks and values', async () => {
    await openEdit()
    const openOnes = () =>
      wrapper.findAll('[aria-expanded="true"]').filter((b) => !b.attributes('aria-haspopup'))
    await card('bench').get('[data-slot="activity-toggle"]').trigger('click')
    await wrapper.get('[data-testid="exception-open"]').trigger('click')
    expect(card('bench').get('[data-slot="activity-toggle"]').attributes('aria-expanded')).toBe(
      'false',
    )
    expect(openOnes()).toHaveLength(1)
    await startValue('rate').get('[data-testid="start-value-open"]').trigger('click')
    expect(wrapper.find('[data-testid="exception-remove"]').exists()).toBe(false)
    expect(openOnes()).toHaveLength(1)
    // Its head closes it again.
    await startValue('rate').get('[data-slot="start-value-toggle"]').trigger('click')
    expect(openOnes()).toHaveLength(0)
    await startValue('rate').get('[data-testid="start-value-open"]').trigger('click')
    await card('bench').get('[data-slot="activity-toggle"]').trigger('click')
    expect(wrapper.findAll('[data-testid="start-value"] [role="group"]')).toHaveLength(0)
    // Adding opens the new one and closes the rest.
    await wrapper.get('[data-testid="exception-open"]').trigger('click')
    await wrapper.get('[data-testid="start-value-add"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-testid="exception-remove"]').exists()).toBe(false)
    expect(openStart().attributes('data-param')).toBe('value')
    await wrapper.get('[data-testid="exception-add"]').trigger('click')
    await settle()
    expect(wrapper.findAll('[data-testid="start-value"] [role="group"]')).toHaveLength(0)
    expect(openOnes()).toHaveLength(1)
    await wrapper.get('[data-testid="activity-add"]').trigger('click')
    await settle()
    expect(wrapper.findAll('[data-testid="exception-remove"]')).toHaveLength(0)
    expect(openOnes()).toHaveLength(1)
  })
})

describe('leaving (F9)', () => {
  it('leaves at once with no changes: Cancel and the back link', async () => {
    await openEdit()
    await wrapper.get('[data-testid="builder-cancel"]').trigger('click')
    await settle()
    expect(location.hash).toBe('#/programmes')
    expect(confirmDialog()).toBeNull()
  })

  it('asks before leaving with changes; Cancel stays, Leave goes', async () => {
    await openEdit()
    await wrapper.get('input[data-testid="builder-name"]').setValue('Beginner 5×5, changed')
    await wrapper.get('[data-testid="builder-back"]').trigger('click')
    await settle()
    expect(confirmDialog()!.textContent).toContain('Leave without saving?')
    expect(confirmDialog()!.textContent).toContain(
      'Your changes to Beginner 5×5, changed are not saved anywhere.',
    )
    dialogButton('Cancel').click()
    await settle()
    expect(location.hash).toBe(`#/programmes/${PID}/edit`)
    await wrapper.get('[data-testid="builder-cancel"]').trigger('click')
    await settle()
    dialogButton('Leave').click()
    await settle()
    expect(location.hash).toBe('#/programmes')
  })

  it('lets a modified press on the back link through, for a new tab', async () => {
    await openEdit()
    await wrapper.get('input[data-testid="builder-name"]').setValue('Beginner 5×5, changed')
    const link = wrapper.get('[data-testid="builder-back"]')
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })
    // The browser opens the link in a new tab; this page neither asks nor moves. jsdom would
    // follow it, so the test stops it once the page has had its say.
    let prevented: boolean | null = null
    const stop = (e: Event) => {
      prevented = e.defaultPrevented
      e.preventDefault()
    }
    window.addEventListener('click', stop)
    link.element.dispatchEvent(ev)
    window.removeEventListener('click', stop)
    expect(prevented).toBe(false)
  })

  it('names an unnamed new programme in its question', async () => {
    await openNew()
    await wrapper.get('[data-testid="activity-add"]').trigger('click')
    await wrapper.get('[data-testid="builder-cancel"]').trigger('click')
    await settle()
    expect(confirmDialog()!.textContent).toContain('This programme is not saved anywhere.')
  })

  it('asks on a hash change away, and keeps the page until the answer', async () => {
    await openEdit()
    await wrapper.get('input[data-testid="builder-name"]').setValue('Beginner 5×5, changed')
    history.replaceState(null, '', '/#/')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await settle()
    expect(location.hash).toBe(`#/programmes/${PID}/edit`)
    expect(wrapper.find('[data-testid="programme-builder"]').exists()).toBe(true)
    dialogButton('Leave').click()
    await settle()
    expect(location.hash).toBe('#/')
    expect(wrapper.find('[data-testid="programme-builder"]').exists()).toBe(false)
  })

  it('stays on a hash change within the page, and when Cancel is the answer', async () => {
    await openEdit()
    await wrapper.get('input[data-testid="builder-name"]').setValue('Beginner 5×5, changed')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await settle()
    expect(confirmDialog()).toBeNull()
    history.replaceState(null, '', '/#/settings')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await settle()
    dialogButton('Cancel').click()
    await settle()
    expect(location.hash).toBe(`#/programmes/${PID}/edit`)
    expect(wrapper.find('[data-testid="programme-builder"]').exists()).toBe(true)
  })

  it('asks the browser before the tab closes with changes', async () => {
    await openEdit()
    const quiet = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(quiet)
    expect(quiet.defaultPrevented).toBe(false)
    await wrapper.get('input[data-testid="builder-name"]').setValue('Beginner 5×5, changed')
    const asked = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(asked)
    expect(asked.defaultPrevented).toBe(true)
    wrapper.unmount()
    wrapper = undefined as unknown as VueWrapper
    const after = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
  })
})

describe('the builder mounted on its own', () => {
  it('names its page by the title', async () => {
    await openNew()
    const page = wrapper.getComponent(ProgrammeBuilder)
    const h1 = page.get('h1')
    expect(page.get('[data-testid="programme-builder"]').attributes('aria-labelledby')).toBe(
      h1.attributes('id'),
    )
    expect(bar().attributes('role')).toBe('region')
    expect(bar().attributes('aria-label')).toBe('Check and save')
    expect(
      wrapper.get('[data-testid="builder-check"]').element.closest('[role="status"]'),
    ).not.toBeNull()
  })
})

describe('the builder’s edges', () => {
  it('opens from the Programmes page without reading the library again', async () => {
    await open('#/programmes')
    const lists = () => calls.filter((c) => c.method === 'GET' && c.path === '/programmes').length
    expect(lists()).toBe(1)
    history.replaceState(null, '', `/#/programmes/${PID}/edit`)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await settle()
    expect(builder().get('h1').text()).toBe('Beginner 5×5')
    expect(lists()).toBe(1)
  })

  it('drops an older check’s answer when the same document was checked again', async () => {
    const held: Array<() => void> = []
    await openEdit({
      'POST /programmes/draft': async (body) => {
        await new Promise<void>((resolve) => held.push(resolve))
        return draft(body)
      },
    })
    const name = wrapper.get('input[data-testid="builder-name"]')
    // A change undone within the moment: the check runs again on the same document.
    await name.setValue('Beginner 5×5!')
    await name.setValue('Beginner 5×5')
    await wait(CHECK_DELAY + 20)
    expect(held).toHaveLength(2)
    held[0]!()
    await settle()
    expect(checkLine()).toBe('Checking…')
    held[1]!()
    await settle()
    expect(checkLine()).toBe('Checked. No problems.')
  })

  it('leaves an emptied description out', async () => {
    await openEdit()
    await wrapper.get('textarea[data-testid="builder-description"]').setValue('')
    await checked()
    expect((drafts().at(-1)!.body as { doc: ProgrammeDoc }).doc).not.toHaveProperty('description')
  })

  it('names an exception entry by its key when no activity has it', async () => {
    const doc = structuredClone(BEGINNER) as ProgrammeDoc
    doc.overrides![0]!.activities = { ghost: { sets: 1 } }
    await openEdit({ [`GET /programmes/${PID}`]: { body: { ...RECORD, doc } } })
    expect(wrapper.get('[data-testid="builder-exceptions"]').text()).toContain('ghost: 1 set.')
  })
})
