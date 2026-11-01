import { isRecord } from '@/lib/storage'

/**
 * The one way the client talks to the API (docs/api.md). Every reply becomes a typed result, so
 * callers branch on what happened rather than on status codes. `request` reads a JSON reply;
 * `stream` reads Ask's server-sent events (§3.1). Both map a refusal the same way (`errorFor`).
 */

export type ApiError =
  /** No network, or the proxy could not reach the API (502, 503 or 504 without an API body). */
  | { kind: 'offline' }
  /** No session, or it ended (401 `auth`). */
  | { kind: 'auth' }
  /** The server failed (a 5xx with no API error code): worth retrying later. */
  | { kind: 'server'; status: number }
  /** A stale plan write; the body carries the server's `items` and `rev`. */
  | { kind: 'conflict'; body: { items: unknown; rev: number } }
  /** Any other refusal, with the API's error code (`error` when the reply was not the API's). */
  | { kind: 'refused'; status: number; code: string; retryAfter?: number }

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError }

const OFFLINE: ApiError = { kind: 'offline' }
/** A request with no answer by then counts as offline, so one dead connection can't stall sync. */
export const TIMEOUT_MS = 15_000

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await res.json()
    return isRecord(body) ? body : null
  } catch {
    return null
  }
}

/** What a reply that isn't a success means, from its status and its JSON body (if any). */
function errorFor(status: number, json: Record<string, unknown> | null): ApiError {
  // A gateway error with no API body means nginx could not reach the API: treat it as offline.
  const code = typeof json?.error === 'string' ? json.error : null
  if ([502, 503, 504].includes(status) && code === null) return OFFLINE
  // A 401 means the session has ended, unless the API says otherwise (a wrong password is
  // 401 `invalid`, which the login form has to tell apart).
  if (status === 401 && (code === null || code === 'auth')) return { kind: 'auth' }
  // Only a plan write conflicts; any other 409 (a sign-up's `exists`) is a refusal like the rest.
  if (status === 409 && json !== null && code === 'conflict') {
    return { kind: 'conflict', body: json as { items: unknown; rev: number } }
  }
  if (status >= 500 && code === null) return { kind: 'server', status }
  const error: ApiError = { kind: 'refused', status, code: code ?? 'error' }
  if (typeof json?.retryAfter === 'number') error.retryAfter = json.retryAfter
  return error
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

/**
 * The fetch options for a call. A write sends `Content-Type: application/json` even with no body
 * (a DELETE), because the API refuses a write without it (docs/api.md §3); the browser adds the
 * `Origin` header to every write itself.
 */
function initFor(
  method: Method,
  body: unknown,
  headers: Record<string, string>,
  signal: AbortSignal,
): RequestInit {
  const init: RequestInit = { method, credentials: 'same-origin', signal }
  if (body !== undefined) {
    headers = { ...headers, 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  } else if (method === 'DELETE') {
    headers = { ...headers, 'Content-Type': 'application/json' }
  }
  if (Object.keys(headers).length) init.headers = headers
  return init
}

/** A promise that rejects when `signal` aborts, for racing a fetch that ignores it. */
function aborted(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_, reject) =>
    signal.addEventListener('abort', () => reject(new Error('aborted'))),
  )
}

export async function request<T = unknown>(
  method: Method,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResult<T>> {
  const abort = new AbortController()
  const init = initFor(method, body, headers, abort.signal)
  let res: Response
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)
  try {
    // The fetch rejects on a network error, or when the timer aborts it.
    res = await Promise.race([fetch(`/api${path}`, init), aborted(abort.signal)])
  } catch {
    return { ok: false, error: OFFLINE }
  } finally {
    clearTimeout(timer)
  }
  if (res.status === 204) return { ok: true, data: undefined as T }
  const json = await readJson(res)
  if (res.ok && json !== null) return { ok: true, data: json as T }
  return { ok: false, error: errorFor(res.status, json) }
}

/** One server-sent event: its name and its JSON data. */
export type StreamEvent = { event: string; data: Record<string, unknown> }

export type StreamError =
  | ApiError
  /** The stream ended, dropped or went quiet before its `done` or `error` event. */
  | { kind: 'cut' }
  /** The caller's signal aborted it (Stop). */
  | { kind: 'stopped' }

/** `ok` once a `done` or `error` event has arrived: the answer's own last word. */
export type StreamResult = { ok: true } | { ok: false; error: StreamError }

/**
 * With no frame for this long, the stream counts as cut. The API sends a keep-alive comment every
 * 15 s (docs/api.md §3.1), so a healthy stream is never quiet this long.
 */
export const STREAM_IDLE_MS = 30_000

/** The events that end a stream: what comes after them is never read. */
const LAST = ['done', 'error']

/**
 * One frame of `text/event-stream` (the lines between blank lines): its `event:` name and its
 * `data:` lines joined, or null for a frame with no data, such as a `:` keep-alive comment, or
 * data that isn't a JSON object.
 */
function parseFrame(frame: string): StreamEvent | null {
  let event = 'message'
  const data: string[] = []
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  if (!data.length) return null
  try {
    const parsed: unknown = JSON.parse(data.join('\n'))
    return isRecord(parsed) ? { event, data: parsed } : null
  } catch {
    return null
  }
}

/**
 * POST `body` to `path` and read the reply as server-sent events, handing each to `onEvent` in
 * order (docs/api.md §3.1). A refusal before the stream maps as `request` maps it. Once the
 * stream has started it ends well only at a `done` or `error` event; ending without one, a
 * dropped connection, or `idleMs` with no frame at all is `cut`, because a proxy that cuts a
 * stream still answered 200. Aborting `signal` (Stop) ends it as `stopped`. Either way the reader
 * is cancelled, so the request closes and the server stops the answer.
 */
export async function stream(
  path: string,
  body: unknown,
  onEvent: (event: StreamEvent) => void,
  {
    signal,
    headers = {},
    idleMs = STREAM_IDLE_MS,
  }: { signal?: AbortSignal; headers?: Record<string, string>; idleMs?: number } = {},
): Promise<StreamResult> {
  if (signal?.aborted) return { ok: false, error: { kind: 'stopped' } }
  const abort = new AbortController()
  let quiet = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const heard = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      quiet = true
      abort.abort()
    }, idleMs)
  }
  const stop = () => abort.abort()
  signal?.addEventListener('abort', stop)
  const ended = (): StreamResult => ({
    ok: false,
    error: quiet ? { kind: 'cut' } : { kind: 'stopped' },
  })
  heard()
  try {
    let res: Response
    try {
      res = await Promise.race([
        fetch(`/api${path}`, initFor('POST', body, headers, abort.signal)),
        aborted(abort.signal),
      ])
    } catch {
      return abort.signal.aborted ? ended() : { ok: false, error: OFFLINE }
    }
    if (!res.ok) return { ok: false, error: errorFor(res.status, await readJson(res)) }
    if (!res.body) return { ok: false, error: { kind: 'cut' } }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    const cancel = () => void reader.cancel().catch(() => {})
    abort.signal.addEventListener('abort', cancel)
    let buffer = ''
    heard()
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        // An abort cancels the reader, which ends this read; a browser's fetch fails it instead.
        chunk = await reader.read()
      } catch {
        return abort.signal.aborted ? ended() : { ok: false, error: { kind: 'cut' } }
      }
      if (abort.signal.aborted) return ended()
      if (chunk.done) return { ok: false, error: { kind: 'cut' } }
      heard()
      buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n?/g, '\n')
      const frames = buffer.split('\n\n')
      buffer = frames.pop()!
      for (const frame of frames) {
        const event = parseFrame(frame)
        if (!event) continue
        onEvent(event)
        if (LAST.includes(event.event)) {
          cancel()
          return { ok: true }
        }
      }
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', stop)
  }
}
