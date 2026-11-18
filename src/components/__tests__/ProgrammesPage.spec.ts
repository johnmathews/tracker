import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import { signedIn } from '@/lib/__tests__/signedIn'
import { withProgrammes, type Call, type Route } from './programmesApi'
import LIBRARY_JSON from '@/lib/__tests__/programmes/library.json'
import START_JSON from '@/lib/__tests__/programmes/start-preview.json'
import RUN_JSON from '@/lib/__tests__/programmes/run.json'
import BEGINNER from '../../../fixtures/programmes/valid/beginner-5x5.json'
import MINIMAL_DOC from '../../../fixtures/programmes/valid/minimal.json'
import { START_PREVIEW_DELAY } from '@/lib/programmes'

const PID = LIBRARY_JSON.programmes[0]!.id
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
  pausedUntil: '2026-11-26',
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
) {
  history.replaceState(null, '', '/#/programmes')
  const api = signedIn()
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

async function openTab(name: 'running' | 'library' | 'add'): Promise<void> {
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
  it('is a page of its own with no bar, Back to the week, and three tabs opening on Running', async () => {
    await openPage()
    expect(wrapper.find('[data-slot="bar"]').exists()).toBe(false)
    expect(page().get('h1').text()).toBe('Programmes')
    expect(byTestId('back-to-week').attributes('href')).toBe('#/')
    expect(
      page()
        .findAll('[role="tab"]')
        .map((t) => t.text()),
    ).toEqual(['Running', 'Library', 'Add'])
    expect(page().get('[role="tab"][aria-selected="true"]').text()).toBe('Running')
  })

  it('lists each live run as a link to its overview, with its week and state', async () => {
    await openPage()
    const runs = page().findAll('[data-testid="programme-run"]')
    expect(runs.map((r) => r.attributes('data-state'))).toEqual(['running', 'paused'])
    expect(runs[0]!.get('a').attributes('href')).toBe('#/programme/t1')
    expect(runs[0]!.text()).toContain('Beginner 5×5')
    expect(runs[0]!.text()).toContain('Week 4 of 8. Running. Ends Sun 13 Dec.')
    expect(runs[1]!.text()).toContain('Week 3 of 9. Paused until Thu 26 Nov.')
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
    expect(entry.get('h3').text()).toBe('Beginner 5×5')
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
    { path: 'weeks', message: 'a programme runs 1 to 52 weeks; this one has 60.' },
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
    await box.setValue('{"weeks": 60}')
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
    expect((box.element as HTMLTextAreaElement).value).toBe('{"weeks": 60}')
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
