import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { request, type ApiError, type ApiResult, type Problem } from '@/lib/api'
import {
  copyName,
  failureText,
  runsFromState,
  type ChangePreview,
  type ChangeRequest,
  type ConfirmOutcome,
  type Outcome,
  type ProgrammeRecord,
  type ProgrammeSummary,
  type Run,
  type RunSummary,
  type StartPreview,
} from '@/lib/programmes'
import { useSessionStore } from '@/stores/session'
import { useSyncStore } from '@/stores/sync'

/** A start's body: the tracker's name, the start day and the parameters (spec §4). */
export type StartBody = { name?: string; start?: string; params?: Record<string, unknown> }

const NOT_JSON =
  'This isn’t JSON the app can read. Check its brackets, commas and quotes, then check it again.'

/** Why the Programmes page couldn't load. */
function loadText(error: ApiError): string {
  return error.kind === 'offline'
    ? 'Can’t reach the server, so the programmes couldn’t load. Try again when you’re online.'
    : 'The server had a problem, so the programmes couldn’t load. Try again in a while.'
}

/** A failed request as an outcome: a refusal's problems when it lists them, else why. */
function failed(error: ApiError): { ok: false; problems: Problem[]; message: string | null } {
  if (error.kind === 'refused' && error.errors?.length) {
    return { ok: false, problems: error.errors, message: null }
  }
  return { ok: false, problems: [], message: failureText(error) }
}

function outcome<T>(res: ApiResult<T>): Outcome<T> {
  return res.ok ? { ok: true, data: res.data } : failed(res.error)
}

/**
 * Programmes (docs/specs/2026-11-17-programmes.md §11.2): the library, the runs the state lists,
 * and the open overview's run. Changes need the server, as Ask does (spec §11.2): nothing here
 * queues. Every number comes from the server (P4): previews ask it, and a confirmed change takes
 * the run it sends back, then reads the state again so the week shows the new plans.
 */
export const useProgrammesStore = defineStore('programmes', () => {
  const session = useSessionStore()
  const sync = useSyncStore()

  /** The library, or null until it has loaded. */
  const library = ref<ProgrammeSummary[] | null>(null)
  /** The runs by tracker id, as the state last listed them. */
  const runs = ref<Record<string, RunSummary>>({})
  /** The server's today (spec §8): the first day a start or a change may take. */
  const today = ref<string | null>(null)
  /** Why the page's data couldn't load, or null. */
  const loadFailure = ref<string | null>(null)
  /** The overview's run, as the server last sent it. */
  const run = ref<Run | null>(null)

  // The browser's own word on the connection, and the sync's: either one offline turns the
  // controls off, as Ask's box does.
  const online = ref(navigator.onLine)
  window.addEventListener('online', () => (online.value = true))
  window.addEventListener('offline', () => (online.value = false))
  const offline = computed(() => !online.value || sync.status === 'offline')

  function call<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) {
    return request<T>(method, path, body, { 'X-Expected-User': session.user ?? '' })
  }

  /** The library, the runs and today, for the Programmes page. */
  async function loadPage(): Promise<void> {
    const [list, state] = await Promise.all([
      call<{ programmes: ProgrammeSummary[] }>('GET', '/programmes'),
      call<unknown>('GET', '/state'),
    ])
    if (!list.ok || !state.ok) {
      loadFailure.value = loadText(list.ok ? (state as { error: ApiError }).error : list.error)
      return
    }
    loadFailure.value = null
    library.value = list.data.programmes
    const read = runsFromState(state.data)
    runs.value = read.runs
    today.value = read.today
  }

  async function readProgramme(id: string): Promise<Outcome<ProgrammeRecord>> {
    return outcome(await call<ProgrammeRecord>('GET', `/programmes/${id}`))
  }

  async function add(doc: unknown): Promise<Outcome<ProgrammeRecord>> {
    const res = outcome(await call<ProgrammeRecord>('POST', '/programmes', { doc }))
    if (res.ok) await loadPage()
    return res
  }

  /** Check and add (spec §3.4): pasted text, refused with every problem when it has any. */
  async function addProgramme(text: string): Promise<Outcome<ProgrammeRecord>> {
    let doc: unknown
    try {
      doc = JSON.parse(text)
    } catch {
      return { ok: false, problems: [], message: NOT_JSON }
    }
    return add(doc)
  }

  /** A copy of a library programme, named as one. */
  async function duplicate(id: string): Promise<Outcome<ProgrammeRecord>> {
    const read = await readProgramme(id)
    if (!read.ok) return read
    return add({ ...read.data.doc, name: copyName(read.data.doc.name) })
  }

  /** Delete from the library; runs started from it keep their own copy. */
  async function remove(id: string): Promise<Outcome<null>> {
    const res = await call<undefined>('DELETE', `/programmes/${id}`)
    if (!res.ok) return failed(res.error)
    library.value = (library.value ?? []).filter((p) => p.id !== id)
    return { ok: true, data: null }
  }

  async function previewStart(id: string, body: StartBody): Promise<Outcome<StartPreview>> {
    return outcome(await call<StartPreview>('POST', `/programmes/${id}/preview`, body))
  }

  /** Start a run; the week then reads the state again, so its tracker shows. */
  async function start(
    id: string,
    body: StartBody,
  ): Promise<Outcome<{ tracker: { id: string }; run: Run }>> {
    const res = outcome(
      await call<{ tracker: { id: string }; run: Run }>('POST', `/programmes/${id}/start`, body),
    )
    if (!res.ok) return res
    run.value = res.data.run
    void sync.refresh()
    await loadPage()
    return res
  }

  /** The overview's run. A tracker with no run comes back with no problems and no message. */
  async function loadRun(tracker: string): Promise<Outcome<Run>> {
    const res = await call<Run>('GET', `/runs/${tracker}`)
    if (!res.ok) {
      const gone = res.error.kind === 'refused' && res.error.status === 404
      return gone ? { ok: false, problems: [], message: null } : failed(res.error)
    }
    run.value = res.data
    return { ok: true, data: res.data }
  }

  /** A change's preview (spec §7.3): the server writes nothing. */
  async function previewChange(
    tracker: string,
    change: ChangeRequest,
  ): Promise<Outcome<ChangePreview>> {
    return outcome(
      await call<ChangePreview>('POST', `/runs/${tracker}/changes`, { ...change, preview: true }),
    )
  }

  /**
   * Apply a change with its preview's `rev`. A stale `rev` gets the change previewed again (409
   * `conflict`), which comes back as `stale` for the sheet to show.
   */
  async function confirmChange(
    tracker: string,
    change: ChangeRequest,
    rev: string,
  ): Promise<ConfirmOutcome> {
    const res = await call<{ run: Run }>('POST', `/runs/${tracker}/changes`, {
      ...change,
      preview: false,
      rev,
    })
    if (!res.ok) {
      if (res.error.kind === 'conflict') {
        return { ok: false, stale: res.error.body.preview as ChangePreview }
      }
      return failed(res.error)
    }
    run.value = res.data.run
    void sync.refresh()
    return { ok: true, data: res.data.run }
  }

  /** End programme from today (spec §4): its weeks, marks and log stay. */
  async function endRun(tracker: string): Promise<Outcome<Run>> {
    const res = await call<{ run: Run }>('POST', `/runs/${tracker}/end`, {})
    if (!res.ok) return failed(res.error)
    run.value = res.data.run
    void sync.refresh()
    return { ok: true, data: res.data.run }
  }

  return {
    library,
    runs,
    today,
    loadFailure,
    run,
    offline,
    loadPage,
    readProgramme,
    addProgramme,
    duplicate,
    remove,
    previewStart,
    start,
    loadRun,
    previewChange,
    confirmChange,
    endRun,
  }
})
