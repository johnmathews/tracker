import { readProgrammeFixture } from '@/lib/__tests__/fixtures'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import { USER, signedIn } from '@/lib/__tests__/signedIn'
import { withProgrammes, type Call, type Route } from './programmesApi'
import LIBRARY_JSON from '@/lib/__tests__/programmes/library.json'
import START_JSON from '@/lib/__tests__/programmes/start-preview.json'
import RUN_JSON from '@/lib/__tests__/programmes/run.json'
import SHARED_JSON from '@/lib/__tests__/programmes/shared.json'
import { START_PREVIEW_DELAY } from '@/lib/programmes'

const PID = LIBRARY_JSON.programmes[0]!.id
const BEGINNER = readProgrammeFixture('valid/beginner-5x5.json')
// jsdom has no scrollIntoView; a copy landing scrolls to its row (K174).
Element.prototype.scrollIntoView ??= () => {}
const MINIMAL_DOC = readProgrammeFixture('valid/minimal.json')
const RECORD = { ...LIBRARY_JSON.programmes[0]!, doc: BEGINNER }
const RUNNING = {
  programmeId: PID,
  name: 'Beginner 5×5',
  status: 'running',
  week: 4,
  weeks: 8,
  start: '2026-10-23',
  end: '2026-12-13',
  pausedUntil: null,
  rev: 'r1',
}
const PAUSED = {
  ...RUNNING,
  name: 'Couch to 5K',
  status: 'paused',
  week: 3,
  weeks: 9,
  end: null,
  pausedUntil: null,
  pausedSince: '2026-12-07',
  pauseReason: 'A cold',
}

let wrapper: VueWrapper
let calls: Call[]
let routes: Record<string, Route>

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function openPage(
  table: Record<string, Route> = {},
  runs: Record<string, unknown> = { t1: RUNNING, t2: PAUSED },
  today: string | null = '2026-11-12',
  admin = false,
) {
  history.replaceState(null, '', '/#/programmes')
  const api = signedIn()
  if (admin) api.admins.add(USER)
  ;({ calls, routes } = withProgrammes(
    api,
    {
      'GET /programmes': { body: LIBRARY_JSON },
      [`GET /programmes/${PID}`]: { body: RECORD },
      [`POST /programmes/${PID}/preview`]: { body: START_JSON },
      ...table,
    },
    today ? { today, runs } : { runs },
  ))
  const pinia = createPinia()
  setActivePinia(pinia)
  wrapper = mount(App, { global: { plugins: [pinia] }, attachTo: document.body })
  await settle()
}

const page = () => wrapper.get('[data-testid="programmes-page"]')
const byTestId = (id: string) => page().get(`[data-testid="${id}"]`)

async function openTab(name: 'running' | 'library' | 'reference' | 'add'): Promise<void> {
  await byTestId(`programmes-tab-${name}`).trigger('mousedown')
  await settle()
}

async function openStart(): Promise<void> {
  await openTab('library')
  await byTestId('library-start').trigger('click')
  await settle()
  await wait(START_PREVIEW_DELAY + 20)
  await settle()
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  wrapper?.unmount()
  vi.unstubAllGlobals()
  history.replaceState(null, '', '/')
})

describe('the Programmes page (K147)', () => {
  it('is a page of its own with no bar, Back to the week, and four tabs opening on Started', async () => {
    await openPage()
    expect(wrapper.find('[data-slot="bar"]').exists()).toBe(false)
    expect(page().get('h1').text()).toBe('Programmes')
    expect(byTestId('back-to-week').attributes('href')).toBe('#/')
    expect(
      page()
        .findAll('[role="tab"]')
        .map((t) => t.text()),
    ).toEqual(['Started', 'Library', 'Reference', 'Add'])
    expect(page().get('[role="tab"][aria-selected="true"]').text()).toBe('Started')
  })

  it('lists each live run as a link to its overview, with its week and state', async () => {
    await openPage()
    const runs = page().findAll('[data-testid="programme-run"]')
    expect(runs.map((r) => r.attributes('data-state'))).toEqual(['running', 'paused'])
    expect(runs[0]!.get('a').attributes('href')).toBe('#/programme/t1')
    expect(runs[0]!.text()).toContain('Beginner 5×5')
    expect(runs[0]!.text()).toContain('Week 4 of 8. Started Fri 23 Oct. Ends Sun 13 Dec.')
    expect(runs[1]!.text()).toContain('Week 3 of 9. Paused since Mon 7 Dec. A cold.')
  })

  it('says when nothing is running, and leaves ended runs out', async () => {
    await openPage({}, { t1: { ...RUNNING, status: 'ended' } })
    expect(byTestId('programmes-running').text()).toBe(
      'No programme is running. Start one from the Library.',
    )
  })

  it('lists the library, each with its kind, weeks, activities and description', async () => {
    await openPage()
    await openTab('library')
    const entry = page().get(`[data-testid="library-programme"][data-programme="${PID}"]`)
    // Each name is an h2 under the page's h1, so the headings never skip a level (axe).
    expect(entry.get('h2').text()).toBe('Beginner 5×5')
    expect(entry.text()).toContain('Strength · 8 weeks · 5 activities')
    expect(entry.text()).toContain('Three full-body sessions a week')
    expect(entry.get('[data-testid="library-start"]').attributes('aria-expanded')).toBe('false')
  })

  it('says when the library is empty', async () => {
    await openPage({ 'GET /programmes': { body: { programmes: [] } } })
    await openTab('library')
    expect(byTestId('programmes-library').text()).toContain('The library is empty.')
  })
})

describe('starting a programme, opened in place (K147)', () => {
  it('opens in an ink frame with Name, Start and each parameter, and focus on Name', async () => {
    await openPage()
    await openStart()
    const form = byTestId('programme-start')
    expect(form.attributes('role')).toBe('group')
    const name = byTestId('start-name').element as HTMLInputElement
    expect(name.value).toBe('Beginner 5×5')
    expect(document.activeElement).toBe(name)
    expect(form.text()).toContain('Its tracker’s name. You can change it later.')
    const start = byTestId('start-date').element as HTMLInputElement
    expect(start.value).toBe('2026-11-12')
    expect(start.min).toBe('2026-11-12')
    expect(form.text()).toContain(
      'Today, Thu 12 Nov, or any later day. Week 1 starts on its Monday.',
    )
    const params = form.findAll('[data-testid="start-param"]')
    expect(params.map((p) => p.attributes('data-param'))).toEqual(['squat', 'rate'])
    expect(form.text()).toContain('Squat start in kg')
    expect(form.text()).toContain('The programme’s own: 40.')
    expect(form.text()).toContain('Weekly increase in %')
    // Its own actions give way to the form.
    expect(page().find('[data-testid="library-start"]').exists()).toBe(false)
  })

  it('previews the plan from the server as the fields change, debounced', async () => {
    await openPage()
    await openStart()
    const previews = () => calls.filter((c) => c.path === `/programmes/${PID}/preview`)
    expect(previews()).toHaveLength(1)
    expect(previews()[0]!.body).toEqual({ start: '2026-11-12', params: { squat: 40, rate: 5 } })
    const preview = byTestId('start-preview')
    expect(preview.find('[data-testid="programme-grid"]').exists()).toBe(true)
    expect(preview.text()).toContain(
      'Eight weeks, Mon 26 Oct to Sun 20 Dec. Deload in weeks 4 and 8.',
    )
    await page().get('[data-param="squat"]').setValue('50')
    await page().get('[data-param="rate"]').setValue('7.5')
    await settle()
    expect(previews()).toHaveLength(1)
    await wait(START_PREVIEW_DELAY + 20)
    await settle()
    expect(previews()).toHaveLength(2)
    expect(previews()[1]!.body).toEqual({ start: '2026-11-12', params: { squat: 50, rate: 7.5 } })
  })

  it('shows the server’s problems on their fields, and keeps no stale plan', async () => {
    await openPage()
    await openStart()
    routes[`POST /programmes/${PID}/preview`] = {
      status: 400,
      body: {
        error: 'invalid',
        errors: [
          { path: 'params.squat', message: 'give a number from 20 to 200.' },
          { path: 'start', message: 'a programme starts today or later.' },
        ],
      },
    }
    await page().get('[data-param="squat"]').setValue('5')
    await wait(START_PREVIEW_DELAY + 20)
    await settle()
    const form = byTestId('programme-start')
    expect(form.text()).toContain('Give a number from 20 to 200.')
    expect(form.text()).toContain('A programme starts today or later.')
    expect(byTestId('start-preview').find('[data-testid="programme-grid"]').exists()).toBe(false)
  })

  it('starts the programme and opens its overview', async () => {
    await openPage({
      [`POST /programmes/${PID}/start`]: {
        status: 201,
        body: { tracker: { id: 't9' }, run: RUN_JSON },
      },
      'GET /runs/t9': { body: RUN_JSON },
    })
    await openStart()
    await page().get('[data-testid="start-name"]').setValue('My 5×5')
    await byTestId('start-confirm').trigger('click')
    await settle()
    expect(calls.find((c) => c.path === `/programmes/${PID}/start`)!.body).toEqual({
      name: 'My 5×5',
      start: '2026-11-12',
      params: { squat: 40, rate: 5 },
    })
    expect(location.hash).toBe('#/programme/t9')
    expect(wrapper.find('[data-testid="programme-overview"]').exists()).toBe(true)
  })

  it('keeps the form open with the start’s problems', async () => {
    await openPage({
      [`POST /programmes/${PID}/start`]: {
        status: 400,
        body: {
          error: 'invalid',
          errors: [{ path: 'name', message: 'give a name of 1 to 60 characters.' }],
        },
      },
    })
    await openStart()
    await byTestId('start-confirm').trigger('click')
    await settle()
    expect(byTestId('programme-start').text()).toContain('Give a name of 1 to 60 characters.')
    routes[`POST /programmes/${PID}/start`] = 'offline'
    await byTestId('start-confirm').trigger('click')
    await settle()
    expect(byTestId('programme-start').text()).toContain('Can’t reach the server')
  })

  it('closes on Cancel, putting focus back on Preview and start', async () => {
    await openPage()
    await openStart()
    await byTestId('start-cancel').trigger('click')
    await settle()
    expect(page().find('[data-testid="programme-start"]').exists()).toBe(false)
    expect(document.activeElement).toBe(byTestId('library-start').element)
  })

  it('says when the programme can’t be read', async () => {
    await openPage({ [`GET /programmes/${PID}`]: 'offline' })
    await openTab('library')
    await byTestId('library-start').trigger('click')
    await settle()
    expect(byTestId('programmes-library').text()).toContain('Can’t reach the server')
    expect(page().find('[data-testid="programme-start"]').exists()).toBe(false)
  })
})

describe('the library’s other actions', () => {
  it('duplicates a programme', async () => {
    await openPage({ 'POST /programmes': { status: 201, body: { ...RECORD, id: 'p2' } } })
    await openTab('library')
    await byTestId('library-duplicate').trigger('click')
    await settle()
    expect(calls.find((c) => c.method === 'POST' && c.path === '/programmes')!.body).toEqual({
      doc: { ...BEGINNER, name: 'Copy of Beginner 5×5' },
    })
  })

  it('says why a duplicate failed', async () => {
    await openPage({ 'POST /programmes': { status: 409, body: { error: 'too-many' } } })
    await openTab('library')
    await byTestId('library-duplicate').trigger('click')
    await settle()
    expect(byTestId('programmes-library').text()).toContain('There’s no room for another.')
  })

  it('asks before deleting, then deletes', async () => {
    await openPage({ [`DELETE /programmes/${PID}`]: { status: 204 } })
    await openTab('library')
    await byTestId('library-delete').trigger('click')
    await settle()
    const dialog = new DOMWrapper(document.querySelector<HTMLElement>('[role="alertdialog"]')!)
    expect(dialog.text()).toContain('Delete Beginner 5×5?')
    expect(dialog.text()).toContain('Runs started from it keep their own copy.')
    await dialog
      .findAll('button')
      .find((b) => b.text() === 'Delete')!
      .trigger('click')
    await settle()
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true)
    expect(page().find('[data-testid="library-programme"]').exists()).toBe(false)
  })

  it('keeps the programme when the question is cancelled, and says why a delete failed', async () => {
    await openPage({ [`DELETE /programmes/${PID}`]: 'offline' })
    await openTab('library')
    await byTestId('library-delete').trigger('click')
    await settle()
    let dialog = new DOMWrapper(document.querySelector<HTMLElement>('[role="alertdialog"]')!)
    await dialog
      .findAll('button')
      .find((b) => b.text() === 'Cancel')!
      .trigger('click')
    await settle()
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    await byTestId('library-delete').trigger('click')
    await settle()
    dialog = new DOMWrapper(document.querySelector<HTMLElement>('[role="alertdialog"]')!)
    await dialog
      .findAll('button')
      .find((b) => b.text() === 'Delete')!
      .trigger('click')
    await settle()
    expect(byTestId('programmes-library').text()).toContain('Can’t reach the server')
  })
})

describe('adding a programme', () => {
  const PROBLEMS = [
    { path: 'weeks', message: 'a programme runs 1 to 156 weeks; this one has 160.' },
    { path: 'activities[2].weight.rate', message: 'a progression has add or rate, not both.' },
    { path: 'activities[4].key', message: 'a key is a-z, 0-9 and -.' },
  ]

  it('lists the validator’s problems, each with its path, and keeps the text', async () => {
    await openPage({
      'POST /programmes': { status: 400, body: { error: 'invalid', errors: PROBLEMS } },
    })
    await openTab('add')
    const box = byTestId('add-json')
    expect(page().text()).toContain(
      'Paste a programme in the tracker-programme/1 format, or choose a file.',
    )
    await box.setValue('{"weeks": 160}')
    await byTestId('add-check').trigger('click')
    await settle()
    const errors = byTestId('add-errors')
    expect(errors.text()).toContain(
      'This programme has three problems. Fix them, then check it again.',
    )
    expect(
      errors.findAll('[data-testid="add-error"]').map((e) => e.attributes('data-path')),
    ).toEqual(['weeks', 'activities[2].weight.rate', 'activities[4].key'])
    expect(errors.findAll('[data-testid="add-error"]')[1]!.text()).toBe(
      'activities[2].weight.rate: a progression has add or rate, not both.',
    )
    expect(box.attributes('aria-invalid')).toBe('true')
    expect(box.attributes('aria-describedby')).toContain(errors.attributes('id'))
    expect((box.element as HTMLTextAreaElement).value).toBe('{"weeks": 160}')
  })

  it('says when the text isn’t JSON', async () => {
    await openPage()
    await openTab('add')
    await byTestId('add-json').setValue('{ "name": ')
    await byTestId('add-check').trigger('click')
    await settle()
    expect(byTestId('add-errors').text()).toContain('This isn’t JSON the app can read.')
  })

  it('adds a programme with no problems and shows the library', async () => {
    await openPage({ 'POST /programmes': { status: 201, body: RECORD } })
    await openTab('add')
    await byTestId('add-json').setValue(JSON.stringify(BEGINNER))
    await byTestId('add-check').trigger('click')
    await settle()
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ doc: BEGINNER })
    expect(page().get('[role="tab"][aria-selected="true"]').text()).toBe('Library')
    expect(byTestId('programmes-library').text()).toContain('Beginner 5×5 is in the library.')
  })

  it('reads a chosen file into the box', async () => {
    await openPage()
    await openTab('add')
    const input = byTestId('add-file').element as HTMLInputElement
    const file = new File(['{"name": "From a file"}'], 'p.json', { type: 'application/json' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await byTestId('add-file').trigger('change')
    await settle()
    expect((byTestId('add-json').element as HTMLTextAreaElement).value).toBe(
      '{"name": "From a file"}',
    )
    const click = vi.spyOn(input, 'click').mockImplementation(() => {})
    await byTestId('add-choose-file').trigger('click')
    expect(click).toHaveBeenCalled()
    Object.defineProperty(input, 'files', { value: [], configurable: true })
    await byTestId('add-file').trigger('change')
  })
})

describe('the Programmes page offline (spec §11.2)', () => {
  it('disables what needs the server, with one line saying why, and keeps the lists', async () => {
    await openPage()
    window.dispatchEvent(new Event('offline'))
    await settle()
    expect(byTestId('programmes-offline').text()).toBe(
      'Can’t reach the server, so programmes can’t be added or started now. Try again when you’re online.',
    )
    expect(page().findAll('[data-testid="programme-run"]')).toHaveLength(2)
    await openTab('library')
    for (const id of ['library-start', 'library-duplicate', 'library-delete'])
      expect(byTestId(id).attributes('disabled')).toBeDefined()
    await openTab('add')
    expect(byTestId('add-check').attributes('disabled')).toBeDefined()
    window.dispatchEvent(new Event('online'))
    await settle()
    expect(page().find('[data-testid="programmes-offline"]').exists()).toBe(false)
  })

  it('says when the page couldn’t load', async () => {
    await openPage({ 'GET /programmes': 'offline' })
    expect(page().text()).toContain('Can’t reach the server, so the programmes couldn’t load.')
    await openTab('library')
    expect(page().find('[data-testid="library-programme"]').exists()).toBe(false)
  })
})

describe('the bar’s way in', () => {
  it('opens the Programmes page from the bar, and Back returns focus to it', async () => {
    await openPage()
    location.hash = '#/'
    await settle()
    const button = wrapper.get('[data-testid="programmes-button"]')
    expect(button.text()).toBe('Programmes')
    await button.trigger('click')
    await settle()
    expect(location.hash).toBe('#/programmes')
    expect(wrapper.find('[data-testid="programmes-page"]').exists()).toBe(true)
    location.hash = '#/'
    await settle()
    expect(document.activeElement).toBe(wrapper.get('[data-testid="programmes-button"]').element)
  })
})

describe('the start form’s edges', () => {
  const MINIMAL = {
    id: 'p-min',
    name: 'Push-ups',
    description: null,
    kind: 'strength',
    weeks: 1,
    activities: 1,
    rev: 1,
    createdAt: 0,
    updatedAt: 0,
  }

  it('writes one week and one activity in the singular, and starts one with no parameters', async () => {
    await openPage(
      {
        'GET /programmes': { body: { programmes: [MINIMAL] } },
        'GET /programmes/p-min': { body: { ...MINIMAL, doc: MINIMAL_DOC } },
        'POST /programmes/p-min/preview': { body: START_JSON },
      },
      {},
      null,
    )
    await openTab('library')
    expect(byTestId('library-programme').text()).toContain('Strength · 1 week · 1 activity')
    await byTestId('library-start').trigger('click')
    await settle()
    expect(page().findAll('[data-testid="start-param"]')).toHaveLength(0)
    // With no day from the server yet, the start is left for the person to pick.
    const start = byTestId('start-date').element as HTMLInputElement
    expect(start.value).toBe('')
    expect(start.min).toBe('')
    expect(byTestId('programme-start').text()).toContain('Week 1 starts on its Monday.')
    await byTestId('start-date').setValue('2026-11-16')
    await wait(START_PREVIEW_DELAY + 20)
    await settle()
    expect(calls.filter((c) => c.path === '/programmes/p-min/preview').at(-1)!.body).toEqual({
      start: '2026-11-16',
      params: {},
    })
  })

  it('lists a problem with no field of its own over the actions', async () => {
    await openPage({
      [`POST /programmes/${PID}/preview`]: {
        status: 400,
        body: { error: 'invalid', errors: [{ path: 'params', message: 'give an object.' }] },
      },
    })
    await openStart()
    expect(byTestId('programme-start').text()).toContain('Give an object.')
  })

  it('drops a preview answered after a newer one', async () => {
    let release: (reply: { body: unknown }) => void = () => {}
    await openPage({
      [`POST /programmes/${PID}/preview`]: () =>
        new Promise((resolve) => {
          release = resolve
        }),
    })
    await openStart()
    const first = release
    routes[`POST /programmes/${PID}/preview`] = { body: START_JSON }
    await page().get('[data-param="squat"]').setValue('45')
    await wait(START_PREVIEW_DELAY + 20)
    await settle()
    expect(byTestId('start-preview').find('[data-testid="programme-grid"]').exists()).toBe(true)
    first({ body: { ...START_JSON, grid: { ...START_JSON.grid, weeks: [] } } })
    await settle()
    expect(byTestId('start-preview').findAll('thead th[data-week]')).toHaveLength(8)
  })

  it('starts once, however often Start programme is pressed', async () => {
    await openPage({
      [`POST /programmes/${PID}/start`]: {
        status: 201,
        body: { tracker: { id: 't9' }, run: RUN_JSON },
      },
      'GET /runs/t9': { body: RUN_JSON },
    })
    await openStart()
    const button = byTestId('start-confirm').element as HTMLButtonElement
    button.click()
    button.click()
    await settle()
    expect(calls.filter((c) => c.path === `/programmes/${PID}/start`)).toHaveLength(1)
  })

  it('checks once, however often Check and add is pressed', async () => {
    await openPage({ 'POST /programmes': { status: 201, body: RECORD } })
    await openTab('add')
    await byTestId('add-json').setValue(JSON.stringify(BEGINNER))
    const button = byTestId('add-check').element as HTMLButtonElement
    button.click()
    button.click()
    await settle()
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/programmes')).toHaveLength(1)
  })
})

describe('the shared library on the Reference tab (K171, K177)', () => {
  const SID = SHARED_JSON.programmes[0]!.id
  const COPY = {
    ...RECORD,
    id: 'p-copy',
    name: 'Strength 5×5',
    description: 'Three full-body sessions a week, adding weight each week.',
    doc: { ...BEGINNER, name: 'Strength 5×5' },
  }
  const section = () => page().find('[data-testid="shared-library"]')
  const question = () => document.querySelector<HTMLElement>('[role="alertdialog"]')
  async function answer(label: string): Promise<void> {
    const button = [...question()!.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === label,
    )!
    button.click()
    await settle()
  }
  /** Copy to library on the first shared row, answered Copy (K172). */
  async function copyFirst(): Promise<void> {
    await byTestId('shared-copy').trigger('click')
    await settle()
    await answer('Copy')
  }

  it('lists the shared programmes on the Reference tab, each with Preview and Copy (K177)', async () => {
    await openPage({ 'GET /shared-programmes': { body: SHARED_JSON } })
    await openTab('reference')
    const shared = byTestId('shared-library')
    expect(shared.text()).toContain(
      'Programmes anyone with an account can copy. A copy is yours to change and start.',
    )
    expect(shared.get('ul').attributes('aria-label')).toBe('Reference')
    const rows = shared.findAll('[data-testid="shared-programme"]')
    expect(rows.map((r) => r.attributes('data-shared'))).toEqual(
      SHARED_JSON.programmes.map((p) => p.id),
    )
    // The tab has no heading of its own, so the names are h2s, as the Library's are.
    expect(rows[0]!.get('h2').text()).toBe('Strength 5×5')
    expect(rows[0]!.text()).toContain('Strength · 8 weeks · 5 activities')
    expect(rows[0]!.text()).toContain('Three full-body sessions a week')
    expect(rows[1]!.text()).toContain('Cardio · 9 weeks · 1 activity')
    expect(rows[0]!.get('[data-testid="shared-copy"]').text()).toBe('Copy to library')
    // The Library is the account's own: no shared programme there.
    await openTab('library')
    expect(byTestId('programmes-library').find('[data-testid="shared-library"]').exists()).toBe(
      false,
    )
  })

  it('says when there are none, and lists nothing when they can’t be read', async () => {
    await openPage({ 'GET /shared-programmes': { body: { programmes: [] } } })
    await openTab('reference')
    expect(section().text()).toContain('No reference programmes yet.')
    wrapper.unmount()
    await openPage({ 'GET /shared-programmes': 'offline' })
    await openTab('reference')
    expect(section().find('[data-testid="shared-programme"]').exists()).toBe(false)
    expect(section().text()).not.toContain('No reference programmes yet.')
  })

  it('copies a programme into the library, which then lists it first', async () => {
    await openPage({
      'GET /shared-programmes': { body: SHARED_JSON },
      [`POST /shared-programmes/${SID}/copy`]: { status: 201, body: COPY },
    })
    await openTab('reference')
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView')
    await copyFirst()
    expect(
      calls.some((c) => c.method === 'POST' && c.path === `/shared-programmes/${SID}/copy`),
    ).toBe(true)
    const own = page().findAll('[data-testid="library-programme"]')
    expect(own.map((r) => r.attributes('data-programme'))).toEqual(['p-copy', PID])
    // It lands (K174): the page scrolls to it, focus goes to its name, and it holds a tile. The
    // copy itself says where it went, so no line over the library says so.
    const landed = own[0]!
    expect(scrolled.mock.contexts).toContain(landed.element)
    expect(scrolled).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'start' })
    expect(document.activeElement).toBe(landed.get('h2').element)
    expect(landed.attributes('data-landing')).toBe('')
    expect(landed.classes()).toContain('before:bg-tile')
    expect(byTestId('programmes-library').find('[data-slot="inline-message"]').exists()).toBe(false)
    scrolled.mockRestore()
    // The copy landed in Library, so that tab opened (K177).
    expect(page().get('[role="tab"][aria-selected="true"]').text()).toBe('Library')
    // Back on Reference, the shared row stays, its button now Added to library (K172).
    await openTab('reference')
    expect(section().findAll('[data-testid="shared-programme"]')).toHaveLength(2)
    const buttons = section().findAll('[data-testid="shared-copy"]')
    expect(buttons.map((b) => b.text())).toEqual(['Added to library', 'Copy to library'])
    expect(buttons[0]!.attributes('data-copied')).toBe('true')
    // Pressed again, it asks again, and says the library already has one (S4: a second copy).
    await buttons[0]!.trigger('click')
    await settle()
    expect(question()!.textContent).toContain(
      'Your library already has a programme called Strength 5×5. Copying adds another one.',
    )
    await answer('Cancel')
  })

  it('lets the tile go: it holds 1.5 seconds, fades, then the row is plain again (K174)', async () => {
    await openPage({
      'GET /shared-programmes': { body: SHARED_JSON },
      [`POST /shared-programmes/${SID}/copy`]: { status: 201, body: COPY },
    })
    await openTab('reference')
    await copyFirst()
    const row = () => page().get('[data-programme="p-copy"]')
    expect(row().attributes('data-landing')).toBe('')
    await vi.waitFor(() => expect(row().attributes('data-landing')).toBe('settled'), {
      timeout: 2000,
    })
    expect(row().classes()).toContain('before:opacity-0')
    await vi.waitFor(() => expect(row().attributes('data-landing')).toBeUndefined(), {
      timeout: 1000,
    })
    expect(row().classes()).not.toContain('before:bg-tile')
  })

  it('lands at once with reduced motion (K174)', async () => {
    const matchMedia = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
    try {
      await openPage({
        'GET /shared-programmes': { body: SHARED_JSON },
        [`POST /shared-programmes/${SID}/copy`]: { status: 201, body: COPY },
      })
      await openTab('reference')
      const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView')
      await copyFirst()
      expect(scrolled).toHaveBeenLastCalledWith({ behavior: 'auto', block: 'start' })
      scrolled.mockRestore()
    } finally {
      window.matchMedia = matchMedia
    }
  })

  it('fills the page’s column with the lists, closed or open (K175, K176)', async () => {
    await openPage({ 'GET /shared-programmes': { body: SHARED_JSON } })
    await openTab('library')
    const row = () => page().get('[data-testid="library-programme"]')
    expect(page().get('ul[aria-label="Library"]').classes()).not.toContain('max-w-[820px]')
    expect(row().classes()).not.toContain('max-w-[820px]')
    await byTestId('library-start').trigger('click')
    await settle()
    expect(row().classes()).not.toContain('max-w-[820px]')
  })

  it('asks before copying, and copies nothing on Cancel (K172)', async () => {
    await openPage({
      'GET /shared-programmes': { body: SHARED_JSON },
      [`POST /shared-programmes/${SID}/copy`]: { status: 201, body: COPY },
    })
    await openTab('reference')
    await byTestId('shared-copy').trigger('click')
    await settle()
    expect(question()!.textContent).toContain('Copy Strength 5×5 to your library?')
    expect(question()!.textContent).toContain('The copy is yours to change and start.')
    await answer('Cancel')
    expect(calls.some((c) => c.path === `/shared-programmes/${SID}/copy`)).toBe(false)
    expect(byTestId('shared-copy').text()).toBe('Copy to library')
  })

  it('warns when the library already has a programme of that name (K172)', async () => {
    await openPage({ 'GET /shared-programmes': { body: SHARED_JSON } })
    await openTab('library')
    const own = page().get('[data-testid="library-programme"] h2').text()
    const twin = { ...SHARED_JSON.programmes[0]!, name: ` ${own.toUpperCase()} ` }
    wrapper.unmount()
    await openPage({ 'GET /shared-programmes': { body: { programmes: [twin] } } })
    await openTab('reference')
    await byTestId('shared-copy').trigger('click')
    await settle()
    expect(question()!.textContent).toContain(
      `Your library already has a programme called ${twin.name}. Copying adds another one.`,
    )
    await answer('Cancel')
  })

  it('says why a copy failed', async () => {
    await openPage({
      'GET /shared-programmes': { body: SHARED_JSON },
      [`POST /shared-programmes/${SID}/copy`]: { status: 409, body: { error: 'too-many' } },
    })
    await openTab('reference')
    await copyFirst()
    // Said on the Reference tab, which stays open; the button stays, to try again.
    expect(section().get('[data-slot="inline-message"]').text()).toContain(
      'There’s no room for another.',
    )
    expect(byTestId('shared-copy').text()).toBe('Copy to library')
    await openTab('library')
    expect(page().findAll('[data-testid="library-programme"]')).toHaveLength(1)
  })

  // -- Preview on a shared row (K173): a Dialog with the plan and the activities --
  const PREVIEW = {
    programme: { ...SHARED_JSON.programmes[0]!, doc: { ...BEGINNER, name: 'Strength 5×5' } },
    plan: START_JSON,
  }
  const previewDialog = () => {
    const el = document.querySelector<HTMLElement>('[data-slot="dialog"]')
    return el ? new DOMWrapper(el) : null
  }

  it('opens Preview in a Dialog: the facts, the plan by week number, the activities', async () => {
    await openPage({
      'GET /shared-programmes': { body: SHARED_JSON },
      [`GET /shared-programmes/${SID}/preview`]: { body: PREVIEW },
    })
    await openTab('reference')
    await byTestId('shared-preview-open').trigger('click')
    await settle()
    const d = previewDialog()!
    expect(d.get('h2').text()).toBe('Strength 5×5')
    expect(d.text()).toContain('Strength · 8 weeks · 5 activities')
    expect(d.get('[data-testid="shared-preview-line"]').text()).toBe(
      'Eight weeks, at the programme’s own values. Deload in weeks 4 and 8. You choose your own values and start day when you start your copy.',
    )
    expect(d.get('th[data-week="1"]').text()).not.toMatch(/Oct|Nov/)
    // The fixed activity column sits on the dialog's panel, not the page's canvas.
    expect(d.get('[data-testid="programme-grid"]').attributes('style')).toContain(
      '--grid-ground: var(--panel)',
    )
    expect(d.findAll('[data-testid="shared-activity"]')).toHaveLength(
      (BEGINNER.activities as unknown[]).length,
    )
    expect(d.find('[data-testid="shared-preview-warning"]').exists()).toBe(false)
    // Looking writes nothing, and Close puts it away.
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([])
    await d
      .findAll('button')
      .find((b) => b.text() === 'Close')!
      .trigger('click')
    await settle()
    expect(previewDialog()).toBeNull()
    expect(byTestId('shared-copy').text()).toBe('Copy to library')
    // The Dialog's own close (its X) puts it away too.
    await byTestId('shared-preview-open').trigger('click')
    await settle()
    const x = previewDialog()!.get('[data-slot="dialog"] button[aria-label="Close"]')
    await x.trigger('click')
    await settle()
    expect(previewDialog()).toBeNull()
  })

  it('copies from the Dialog without asking again, then closes it (K173)', async () => {
    await openPage({
      'GET /shared-programmes': { body: SHARED_JSON },
      [`GET /shared-programmes/${SID}/preview`]: { body: PREVIEW },
      [`POST /shared-programmes/${SID}/copy`]: { status: 201, body: COPY },
    })
    await openTab('reference')
    await byTestId('shared-preview-open').trigger('click')
    await settle()
    await previewDialog()!.get('[data-testid="shared-preview-copy"]').trigger('click')
    await settle()
    expect(question()).toBeNull()
    expect(calls.some((c) => c.path === `/shared-programmes/${SID}/copy`)).toBe(true)
    expect(previewDialog()).toBeNull()
    // It lands as a copy from the row does (K174), in Library, focus on its name, not on Preview.
    const landed = page().get('[data-programme="p-copy"]')
    expect(landed.attributes('data-landing')).toBe('')
    expect(document.activeElement).toBe(landed.get('h2').element)
    await openTab('reference')
    expect(byTestId('shared-copy').text()).toBe('Added to library')
    // Opened again, the Dialog says the library already has one.
    await byTestId('shared-preview-open').trigger('click')
    await settle()
    expect(previewDialog()!.get('[data-testid="shared-preview-warning"]').text()).toBe(
      'Your library already has a programme called Strength 5×5. Copying adds another one.',
    )
  })

  it('says in the Dialog why a copy failed, and keeps it open', async () => {
    await openPage({
      'GET /shared-programmes': { body: SHARED_JSON },
      [`GET /shared-programmes/${SID}/preview`]: { body: PREVIEW },
      [`POST /shared-programmes/${SID}/copy`]: { status: 409, body: { error: 'too-many' } },
    })
    await openTab('reference')
    await byTestId('shared-preview-open').trigger('click')
    await settle()
    await previewDialog()!.get('[data-testid="shared-preview-copy"]').trigger('click')
    await settle()
    expect(previewDialog()!.get('[data-testid="shared-preview-error"]').text()).toContain(
      'There’s no room for another.',
    )
    expect(byTestId('shared-copy').text()).toBe('Copy to library')
  })

  it('says why a Preview couldn’t open', async () => {
    await openPage({
      'GET /shared-programmes': { body: SHARED_JSON },
      [`GET /shared-programmes/${SID}/preview`]: 'offline',
    })
    await openTab('reference')
    await byTestId('shared-preview-open').trigger('click')
    await settle()
    expect(previewDialog()).toBeNull()
    expect(section().get('[data-slot="inline-message"]').text()).toContain('Can’t reach the server')
  })

  it('disables Copy to library offline, as the library’s other actions', async () => {
    await openPage({ 'GET /shared-programmes': { body: SHARED_JSON } })
    await openTab('reference')
    window.dispatchEvent(new Event('offline'))
    await settle()
    for (const copy of section().findAll('[data-testid="shared-copy"]'))
      expect(copy.attributes('disabled')).toBeDefined()
    for (const preview of section().findAll('[data-testid="shared-preview-open"]'))
      expect(preview.attributes('disabled')).toBeDefined()
    window.dispatchEvent(new Event('online'))
    await settle()
  })
})

describe('publishing, for an admin (K171, option 2B)', () => {
  const SID = SHARED_JSON.programmes[0]!.id
  const LINKED = {
    ...BEGINNER,
    activities: (BEGINNER.activities as Record<string, unknown>[]).map((a) =>
      a.key === 'squat' ? { ...a, link: 'https://www.stronglifts.com/squat' } : a,
    ),
  }
  const PREVIEW = {
    preview: true,
    rev: 'pub1',
    publish: {
      programme: { ...LIBRARY_JSON.programmes[0]!, id: 'preview', doc: LINKED },
      replaces: null as { id: string; updatedAt: number } | null,
    },
  }
  const SHARED_ROW = {
    ...LIBRARY_JSON.programmes[0]!,
    shared: { id: SID, updatedAt: new Date(2026, 10, 17, 12).getTime() / 1000 },
  }
  const published = { preview: false, shared: { id: SID, updatedAt: 1794999600 } }

  /** The open dialog: Reka renders it in a portal on document.body. */
  function dialog(): DOMWrapper<HTMLElement> | null {
    const el = document.querySelector<HTMLElement>('[data-slot="dialog"]')
    return el ? new DOMWrapper(el) : null
  }
  function asked(): DOMWrapper<HTMLElement> {
    return new DOMWrapper(document.querySelector<HTMLElement>('[role="alertdialog"]')!)
  }
  function items(): string[] {
    return [...document.querySelectorAll<HTMLElement>('[data-slot="menu-item"]')].map(
      (i) => i.textContent?.trim() ?? '',
    )
  }
  async function sharedIds(): Promise<string[]> {
    await openTab('reference')
    const ids = page()
      .findAll('[data-testid="shared-programme"]')
      .map((r) => r.attributes('data-shared')!)
    await openTab('library')
    return ids
  }
  async function more(): Promise<void> {
    await byTestId('library-more').trigger('click')
    await settle()
  }
  async function choose(label: string): Promise<void> {
    ;[...document.querySelectorAll<HTMLElement>('[data-slot="menu-item"]')]
      .find((i) => i.textContent?.trim() === label)!
      .click()
    await settle()
  }
  async function answer(dialogEl: DOMWrapper<HTMLElement>, label: string): Promise<void> {
    await dialogEl
      .findAll('button')
      .find((b) => b.text() === label)!
      .trigger('click')
    await settle()
  }
  async function openAdmin(table: Record<string, Route> = {}): Promise<void> {
    await openPage(
      { 'GET /shared-programmes': { body: SHARED_JSON }, ...table },
      undefined,
      undefined,
      true,
    )
    await openTab('library')
  }
  const isPreview = (body: unknown) => (body as { preview: boolean }).preview

  it('shows nobody else the More menu or the Published chip', async () => {
    await openPage({
      'GET /shared-programmes': { body: SHARED_JSON },
      // Even were the server to send the field, a non-admin is offered nothing.
      'GET /programmes': { body: { programmes: [SHARED_ROW] } },
    })
    await openTab('library')
    expect(page().find('[data-testid="library-more"]').exists()).toBe(false)
    expect(page().find('[data-testid="library-shared"]').exists()).toBe(false)
    await openTab('reference')
    expect(page().find('[data-testid="shared-library"]').exists()).toBe(true)
  })

  it('gives an admin’s row a More menu with Publish', async () => {
    await openAdmin()
    const button = byTestId('library-more')
    expect(button.attributes('aria-label')).toBe('More for Beginner 5×5')
    expect(button.attributes('aria-haspopup')).toBe('menu')
    expect(page().find('[data-testid="library-shared"]').exists()).toBe(false)
    await more()
    expect(items()).toEqual(['Publish'])
  })

  it('marks a shared row with the Shared chip, and offers Publish again and Unpublish', async () => {
    await openAdmin({ 'GET /programmes': { body: { programmes: [SHARED_ROW] } } })
    expect(byTestId('library-shared').text()).toBe('Published')
    await more()
    expect(items()).toEqual(['Publish again', 'Unpublish'])
  })

  it('publishes from the preview: what everyone will see, then Publish programme', async () => {
    await openAdmin({
      [`POST /programmes/${PID}/publish`]: (body) =>
        isPreview(body) ? { body: PREVIEW } : { body: published },
    })
    await more()
    await choose('Publish')
    expect(calls.find((c) => c.path === `/programmes/${PID}/publish`)!.body).toEqual({
      preview: true,
    })
    const d = dialog()!
    expect(d.get('h2').text()).toBe('Publish Beginner 5×5')
    const seen = d.get('[data-testid="publish-preview"]')
    expect(seen.get('h3').text()).toBe('What everyone will see')
    expect(seen.text()).toContain('Beginner 5×5')
    expect(seen.text()).toContain('Strength · 8 weeks · 5 activities')
    expect(seen.text()).toContain('Three full-body sessions a week')
    const acts = seen.findAll('[data-testid="shared-activity"]')
    expect(acts).toHaveLength(LINKED.activities.length)
    expect(acts[0]!.text()).toContain('Back squat')
    expect(acts[0]!.get('[data-slot="chip"]').text()).toBe('5 × 5')
    expect(acts[0]!.text()).toContain('Belt from week 5.')
    const link = acts[0]!.get('a')
    expect(link.text()).toBe('Open stronglifts.com in a new tab')
    expect(link.attributes('href')).toBe('https://www.stronglifts.com/squat')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
    expect(acts[1]!.text()).toContain('No notes.')
    expect(d.text()).toContain(
      'Everyone with an account can see and copy it. Your name is not shown.',
    )
    expect(d.find('[data-testid="publish-replaces"]').exists()).toBe(false)
    const confirm = d.get('[data-testid="publish-confirm"]')
    expect(confirm.text()).toBe('Publish programme')
    await confirm.trigger('click')
    await settle()
    expect(calls.filter((c) => c.path === `/programmes/${PID}/publish`).at(-1)!.body).toEqual({
      preview: false,
      rev: 'pub1',
    })
    expect(dialog()).toBeNull()
    expect(byTestId('programmes-library').get('[data-slot="inline-message"]').text()).toBe(
      'Beginner 5×5 is in Reference.',
    )
    expect(byTestId('library-shared').text()).toBe('Published')
  })

  it('says what Publish again replaces', async () => {
    const again = { ...PREVIEW, publish: { ...PREVIEW.publish, replaces: SHARED_ROW.shared } }
    await openAdmin({
      'GET /programmes': { body: { programmes: [SHARED_ROW] } },
      [`POST /programmes/${PID}/publish`]: { body: again },
    })
    await more()
    await choose('Publish again')
    const d = dialog()!
    expect(d.get('h2').text()).toBe('Publish Beginner 5×5 again')
    expect(d.get('[data-testid="publish-replaces"]').text()).toBe(
      'It replaces the shared copy from Tue 17 Nov. Copies people have made stay as they are.',
    )
    expect(d.get('[data-testid="publish-confirm"]').text()).toBe('Publish again')
    // The Dialog's own Close shuts it, publishing nothing.
    await d.get('button[aria-label="Close"]').trigger('click')
    await settle()
    expect(dialog()).toBeNull()
    const publishes = calls.filter((c) => c.path === `/programmes/${PID}/publish`)
    expect(publishes.map((c) => c.body)).toEqual([{ preview: true }])
  })

  it('shows the fresh preview when the programme changed since, then publishes with its rev', async () => {
    const fresh = {
      ...PREVIEW,
      rev: 'pub2',
      publish: {
        ...PREVIEW.publish,
        programme: { ...PREVIEW.publish.programme, description: 'Now with a deload.' },
      },
    }
    let confirms = 0
    await openAdmin({
      [`POST /programmes/${PID}/publish`]: (body) => {
        if (isPreview(body)) return { body: PREVIEW }
        confirms++
        return confirms === 1
          ? { status: 409, body: { error: 'conflict', rev: 'pub2', preview: fresh } }
          : { body: published }
      },
    })
    await more()
    await choose('Publish')
    await dialog()!.get('[data-testid="publish-confirm"]').trigger('click')
    await settle()
    const d = dialog()!
    expect(d.get('[data-testid="publish-stale"]').text()).toBe(
      'The programme changed since this preview. Check it, then publish.',
    )
    expect(d.get('[data-testid="publish-preview"]').text()).toContain('Now with a deload.')
    await d.get('[data-testid="publish-confirm"]').trigger('click')
    await settle()
    expect(calls.filter((c) => c.path === `/programmes/${PID}/publish`).at(-1)!.body).toEqual({
      preview: false,
      rev: 'pub2',
    })
    expect(dialog()).toBeNull()
  })

  it('says why a publish failed, in the dialog, and why its preview couldn’t open', async () => {
    await openAdmin({
      [`POST /programmes/${PID}/publish`]: (body) =>
        isPreview(body) ? { body: PREVIEW } : { status: 403, body: { error: 'not-admin' } },
    })
    await more()
    await choose('Publish')
    await dialog()!.get('[data-testid="publish-confirm"]').trigger('click')
    await settle()
    expect(dialog()!.get('[data-testid="publish-error"]').text()).toBe(
      'Only an admin can publish to the shared library.',
    )
    await answer(dialog()!, 'Cancel')
    expect(dialog()).toBeNull()
    // Opened again, it starts from the new preview, with no line left from the last time.
    await more()
    await choose('Publish')
    expect(dialog()!.find('[data-testid="publish-error"]').exists()).toBe(false)
    await answer(dialog()!, 'Cancel')
    routes[`POST /programmes/${PID}/publish`] = 'offline'
    await more()
    await choose('Publish')
    expect(dialog()).toBeNull()
    expect(byTestId('programmes-library').text()).toContain('Can’t reach the server')
  })

  it('publishes once, however often Publish programme is pressed', async () => {
    await openAdmin({
      [`POST /programmes/${PID}/publish`]: (body) =>
        isPreview(body) ? { body: PREVIEW } : { body: published },
    })
    await more()
    await choose('Publish')
    const button = dialog()!.get('[data-testid="publish-confirm"]').element as HTMLButtonElement
    button.click()
    button.click()
    await settle()
    const confirms = calls.filter(
      (c) => c.path === `/programmes/${PID}/publish` && !isPreview(c.body),
    )
    expect(confirms).toHaveLength(1)
  })

  it('asks before unpublishing, then unpublishes, and keeps it when cancelled', async () => {
    await openAdmin({
      'GET /programmes': { body: { programmes: [SHARED_ROW] } },
      [`DELETE /shared-programmes/${SID}`]: { status: 204 },
    })
    expect(await sharedIds()).toContain(SID)
    await more()
    await choose('Unpublish')
    expect(asked().text()).toContain('Unpublish Beginner 5×5?')
    expect(asked().text()).toContain('It leaves Reference. Copies people have made stay theirs.')
    await answer(asked(), 'Cancel')
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    await more()
    await choose('Unpublish')
    await answer(asked(), 'Unpublish')
    expect(calls.some((c) => c.method === 'DELETE' && c.path === `/shared-programmes/${SID}`)).toBe(
      true,
    )
    expect(page().find('[data-testid="library-shared"]').exists()).toBe(false)
    expect(await sharedIds()).not.toContain(SID)
  })

  it('says why an unpublish failed', async () => {
    await openAdmin({
      'GET /programmes': { body: { programmes: [SHARED_ROW] } },
      [`DELETE /shared-programmes/${SID}`]: 'offline',
    })
    await more()
    await choose('Unpublish')
    await answer(asked(), 'Unpublish')
    expect(byTestId('programmes-library').text()).toContain('Can’t reach the server')
    expect(page().find('[data-testid="library-shared"]').exists()).toBe(true)
  })

  it('disables More offline, as the library’s other actions', async () => {
    await openAdmin()
    window.dispatchEvent(new Event('offline'))
    await settle()
    expect(byTestId('library-more').attributes('disabled')).toBeDefined()
    window.dispatchEvent(new Event('online'))
    await settle()
  })
})
