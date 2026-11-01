import { isRecord } from '@/lib/storage'

/**
 * The one way the client talks to the API (docs/api.md). Every reply becomes a typed result, so
 * callers branch on what happened rather than on status codes.
 */

/**
 * A 409 `conflict`'s body: the server's revision, and its copy. A plan write's carries `items`
 * (null when the server has no plan for the week); a details write's carries `details` (`{}` once
 * cleared, null when the item never had any). Neither copy is validated here.
 */
export type ConflictBody = { rev: number; items?: unknown; details?: unknown }

export type ApiError =
  /** No network, or the proxy could not reach the API (502, 503 or 504 without an API body). */
  | { kind: 'offline' }
  /** No session, or it ended (401 `auth`). */
  | { kind: 'auth' }
  /** The server failed (a 5xx with no API error code): worth retrying later. */
  | { kind: 'server'; status: number }
  /** A stale plan or details write; the body carries the server's copy and `rev`. */
  | { kind: 'conflict'; body: ConflictBody }
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

export async function request<T = unknown>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResult<T>> {
  const init: RequestInit = { method, credentials: 'same-origin' }
  if (body !== undefined) {
    headers = { ...headers, 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  if (Object.keys(headers).length) init.headers = headers
  const abort = new AbortController()
  init.signal = abort.signal
  let res: Response
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)
  try {
    // The fetch rejects on a network error, or when the timer aborts it.
    res = await Promise.race([
      fetch(`/api${path}`, init),
      new Promise<never>((_, reject) =>
        abort.signal.addEventListener('abort', () => reject(new Error('timeout'))),
      ),
    ])
  } catch {
    return { ok: false, error: OFFLINE }
  } finally {
    clearTimeout(timer)
  }
  if (res.status === 204) return { ok: true, data: undefined as T }
  const json = await readJson(res)
  if (res.ok && json !== null) return { ok: true, data: json as T }
  // A gateway error with no API body means nginx could not reach the API: treat it as offline.
  const code = typeof json?.error === 'string' ? json.error : null
  if ([502, 503, 504].includes(res.status) && code === null) return { ok: false, error: OFFLINE }
  // A 401 means the session has ended, unless the API says otherwise (a wrong password is
  // 401 `invalid`, which the login form has to tell apart).
  if (res.status === 401 && (code === null || code === 'auth')) {
    return { ok: false, error: { kind: 'auth' } }
  }
  // Only a plan or details write conflicts; any other 409 (a sign-up's `exists`) is a refusal
  // like the rest.
  if (res.status === 409 && json !== null && code === 'conflict') {
    return { ok: false, error: { kind: 'conflict', body: json as ConflictBody } }
  }
  if (res.status >= 500 && code === null)
    return { ok: false, error: { kind: 'server', status: res.status } }
  const error: ApiError = { kind: 'refused', status: res.status, code: code ?? 'error' }
  if (typeof json?.retryAfter === 'number') error.retryAfter = json.retryAfter
  return { ok: false, error }
}
