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
  type PublishPreview,
  type Run,
  type RunSummary,
  type SharedRef,
  type SharedPreview,
  type SharedSummary,
  type StartPreview,
} from '@/lib/programmes'
import {
  CANT_REOPEN,
  type Confirmed,
  type ReopenBody,
  type ReopenPreview,
  type RestartBody,
  type RestartPreview,
  type Restarted,
} from '@/lib/runActions'
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

/** Why a run couldn't be read, for the item page's Programme row. */
function runLoadText(error: ApiError): string {
  return error.kind === 'offline'
    ? 'Can’t reach the server, so the programme couldn’t load. Try again when you’re online.'
    : 'The server had a problem, so the programme couldn’t load. Try again in a while.'
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
  /** The shared library (shared library spec §5), newest publish first; null until it loads. */
  const shared = ref<SharedSummary[] | null>(null)
  /** The runs by tracker id, as the state last listed them. */
  const runs = ref<Record<string, RunSummary>>({})
  /** The server's today (spec §8): the first day a start or a change may take. */
  const today = ref<string | null>(null)
  /** Why the page's data couldn't load, or null. */
  const loadFailure = ref<string | null>(null)
  /** The overview's run, as the server last sent it. */
  const run = ref<Run | null>(null)
  /**
   * Each programme tracker's run as the server last sent it, by tracker id: the week view's
   * paused rows and programme week, and the item page's chart, read their grid (P4).
   */
  const byTracker = ref<Record<string, Run>>({})
  /** The runs being read, so a second ask waits for the first. */
  const reading = new Map<string, Promise<Outcome<Run>>>()

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
    keep(res.data.tracker.id, res.data.run)
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
    keep(tracker, res.data)
    return { ok: true, data: res.data }
  }

  /** A run the server sent for `tracker`: the overview's, and the tracker's. */
  function keep(tracker: string, next: Run): void {
    run.value = next
    byTracker.value = { ...byTracker.value, [tracker]: next }
  }

  /**
   * The tracker's run, read when it isn't here or the state lists a newer one (its `rev`). Reads
   * of one tracker at once share one request. A failure keeps what was here: the week view then
   * shows the boxes, and the item page says why.
   */
  async function ensureRun(tracker: string): Promise<Outcome<Run> | null> {
    const listed = sync.runs[tracker]
    const have = byTracker.value[tracker]
    if (have && (!listed || listed.rev === have.rev)) return null
    const pending = reading.get(tracker)
    if (pending) return pending
    const read = (async (): Promise<Outcome<Run>> => {
      const res = await call<Run>('GET', `/runs/${tracker}`)
      if (!res.ok) return { ok: false, problems: [], message: runLoadText(res.error) }
      byTracker.value = { ...byTracker.value, [tracker]: res.data }
      return { ok: true, data: res.data }
    })().finally(() => reading.delete(tracker))
    reading.set(tracker, read)
    return read
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
    keep(tracker, res.data.run)
    void sync.refresh()
    return { ok: true, data: res.data.run }
  }

  /** End programme from today (spec §4): its weeks, marks and log stay. */
  async function endRun(tracker: string): Promise<Outcome<Run>> {
    const res = await call<{ run: Run }>('POST', `/runs/${tracker}/end`, {})
    if (!res.ok) return failed(res.error)
    keep(tracker, res.data.run)
    void sync.refresh()
    return { ok: true, data: res.data.run }
  }

  /** A restart's preview (K164, K167): the new tracker's name, start, weeks and last day. */
  async function previewRestart(
    tracker: string,
    body: RestartBody,
  ): Promise<Outcome<RestartPreview>> {
    return outcome(
      await call<RestartPreview>('POST', `/runs/${tracker}/restart`, { ...body, preview: true }),
    )
  }

  /**
   * Restart from week 1 with the preview's `rev`: a new tracker and run. Both runs stay here, the
   * new one as the overview's, and the week reads the state again so the new tracker shows. A
   * stale `rev` comes back as `stale`, with the restart previewed again.
   */
  async function restart(
    tracker: string,
    body: RestartBody,
    rev: string,
  ): Promise<Confirmed<Restarted, RestartPreview>> {
    const res = await call<Restarted>('POST', `/runs/${tracker}/restart`, {
      ...body,
      preview: false,
      rev,
    })
    if (!res.ok) {
      if (res.error.kind === 'conflict') {
        return { ok: false, stale: res.error.body.preview as RestartPreview }
      }
      return failed(res.error)
    }
    keep(res.data.tracker.id, res.data.run)
    void sync.refresh()
    return { ok: true, data: res.data }
  }

  /**
   * A re-open refused because the run can't be re-opened any more (409 `cant-reopen`): it changed
   * since the overview read it, so the run is read again for the overview to show what it can do.
   */
  async function reopenFailed(
    tracker: string,
    error: ApiError,
  ): Promise<{ ok: false; problems: Problem[]; message: string | null }> {
    if (error.kind !== 'refused' || error.code !== 'cant-reopen') return failed(error)
    await loadRun(tracker)
    return { ok: false, problems: [], message: CANT_REOPEN }
  }

  /** A re-open's preview (K165, K167), or Cancel the end's, from the end's own day. */
  async function previewReopen(tracker: string, body: ReopenBody): Promise<Outcome<ReopenPreview>> {
    const res = await call<ReopenPreview>('POST', `/runs/${tracker}/reopen`, {
      ...body,
      preview: true,
    })
    return res.ok ? { ok: true, data: res.data } : reopenFailed(tracker, res.error)
  }

  /** Re-open with the preview's `rev`, then take the run the server sends back. */
  async function reopen(
    tracker: string,
    body: ReopenBody,
    rev: string,
  ): Promise<Confirmed<Run, ReopenPreview>> {
    const res = await call<{ run: Run }>('POST', `/runs/${tracker}/reopen`, {
      ...body,
      preview: false,
      rev,
    })
    if (!res.ok) {
      if (res.error.kind === 'conflict') {
        return { ok: false, stale: res.error.body.preview as ReopenPreview }
      }
      return reopenFailed(tracker, res.error)
    }
    keep(tracker, res.data.run)
    void sync.refresh()
    return { ok: true, data: res.data.run }
  }

  // -- The shared library (docs/specs/2026-11-19-shared-library.md §5) --

  /**
   * The shared programmes. A failure keeps what was here and says nothing: the shared library is
   * an extra under the account's own, and the page's own load already says when the server can't
   * be reached. Until one load works, the Library tab shows no shared section.
   */
  async function loadShared(): Promise<void> {
    const res = await call<{ programmes: SharedSummary[] }>('GET', '/shared-programmes')
    if (res.ok) shared.value = res.data.programmes
  }

  /**
   * Copy a shared programme into the library (S4): a plain copy with a new id, which goes at the
   * top of the list, as the server lists the newest first.
   */
  async function copyShared(id: string): Promise<Outcome<ProgrammeRecord>> {
    const res = outcome(await call<ProgrammeRecord>('POST', `/shared-programmes/${id}/copy`))
    if (!res.ok) return res
    const { doc: _doc, ...summary } = res.data
    library.value = [summary, ...(library.value ?? [])]
    return res
  }

  /** A shared programme and its plan, to look at before copying it (K173). Writes nothing. */
  async function previewShared(id: string): Promise<Outcome<SharedPreview>> {
    return outcome(await call<SharedPreview>('GET', `/shared-programmes/${id}/preview`))
  }

  /** Publish's preview (S5): the programme as everyone will see it. The server writes nothing. */
  async function previewPublish(id: string): Promise<Outcome<PublishPreview>> {
    return outcome(
      await call<PublishPreview>('POST', `/programmes/${id}/publish`, { preview: true }),
    )
  }

  /**
   * Publish with the preview's `rev` (admin only, S1). The row is marked shared and the shared
   * library read again. A stale `rev` (the programme or its shared copy changed since) comes back
   * as `stale`, with the publish previewed again.
   */
  async function publish(id: string, rev: string): Promise<Confirmed<SharedRef, PublishPreview>> {
    const res = await call<{ preview: false; shared: SharedRef }>(
      'POST',
      `/programmes/${id}/publish`,
      { preview: false, rev },
    )
    if (!res.ok) {
      if (res.error.kind === 'conflict') {
        return { ok: false, stale: res.error.body.preview as PublishPreview }
      }
      return failed(res.error)
    }
    const done = res.data.shared
    if (library.value) {
      library.value = library.value.map((p) => (p.id === id ? { ...p, shared: done } : p))
    }
    await loadShared()
    return { ok: true, data: done }
  }

  /** Take a programme out of the shared library (admin only). Copies people made stay theirs. */
  async function unpublish(sharedId: string): Promise<Outcome<null>> {
    const res = await call<undefined>('DELETE', `/shared-programmes/${sharedId}`)
    if (!res.ok) return failed(res.error)
    if (library.value) {
      library.value = library.value.map((p) =>
        p.shared?.id === sharedId ? { ...p, shared: null } : p,
      )
    }
    if (shared.value) shared.value = shared.value.filter((p) => p.id !== sharedId)
    return { ok: true, data: null }
  }

  return {
    library,
    shared,
    runs,
    today,
    loadFailure,
    run,
    byTracker,
    offline,
    loadPage,
    readProgramme,
    addProgramme,
    duplicate,
    remove,
    previewStart,
    start,
    loadRun,
    ensureRun,
    previewChange,
    confirmChange,
    endRun,
    previewRestart,
    restart,
    previewReopen,
    reopen,
    loadShared,
    copyShared,
    previewShared,
    previewPublish,
    publish,
    unpublish,
  }
})
