import { afterEach, describe, expect, it, vi } from 'vitest'
import { STREAM_IDLE_MS, TIMEOUT_MS, request, stream, type StreamEvent } from '@/lib/api'

function respond(status: number, body?: unknown, raw?: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(
      async () =>
        new Response(raw ?? (body === undefined ? null : JSON.stringify(body)), { status }),
    ),
  )
}

describe('request', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends JSON to /api with the method and parses the reply', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ rev: 2 }))
    vi.stubGlobal('fetch', fetch)
    expect(await request('PUT', '/plans/exercise/2026-10-19', { items: [], rev: 1 })).toEqual({
      ok: true,
      data: { rev: 2 },
    })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('/api/plans/exercise/2026-10-19')
    expect(init).toMatchObject({
      method: 'PUT',
      body: '{"items":[],"rev":1}',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
    })
  })

  it('sends no body or content type on GET', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetch)
    await request('GET', '/healthz')
    expect(fetch.mock.calls[0]![1]).toEqual({
      method: 'GET',
      credentials: 'same-origin',
      signal: expect.any(AbortSignal),
    })
  })

  it('returns undefined data for 204', async () => {
    respond(204)
    expect(await request('POST', '/auth/logout', {})).toEqual({ ok: true, data: undefined })
  })

  it('maps 401 to auth and 409 to a conflict carrying the body', async () => {
    respond(401, { error: 'auth' })
    expect(await request('GET', '/state')).toEqual({ ok: false, error: { kind: 'auth' } })
    respond(401)
    expect(await request('GET', '/state')).toEqual({ ok: false, error: { kind: 'auth' } })
    respond(409, { error: 'conflict', items: [], rev: 3 })
    expect(await request('PUT', '/plans/diet/2026-10-19', {})).toEqual({
      ok: false,
      error: { kind: 'conflict', body: { error: 'conflict', items: [], rev: 3 } },
    })
  })

  it('treats any other 409 as a refusal with its code', async () => {
    respond(409, { error: 'exists' })
    expect(await request('POST', '/auth/signup', {})).toEqual({
      ok: false,
      error: { kind: 'refused', status: 409, code: 'exists' },
    })
  })

  it.each([502, 503, 504])('treats a %i from the proxy as offline', async (status) => {
    respond(status, undefined, '<html>Bad Gateway</html>')
    expect(await request('GET', '/state')).toEqual({ ok: false, error: { kind: 'offline' } })
  })

  it('treats a network failure as offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    expect(await request('GET', '/state')).toEqual({ ok: false, error: { kind: 'offline' } })
  })

  it('keeps a 401 that is not about the session, such as a wrong password', async () => {
    respond(401, { error: 'invalid' })
    expect(await request('POST', '/auth/login', {})).toEqual({
      ok: false,
      error: { kind: 'refused', status: 401, code: 'invalid' },
    })
  })

  it('passes the API’s own refusals through, with Retry-After', async () => {
    respond(423, { error: 'locked', retryAfter: 600 })
    expect(await request('POST', '/auth/login', {})).toEqual({
      ok: false,
      error: { kind: 'refused', status: 423, code: 'locked', retryAfter: 600 },
    })
    respond(503, { error: 'busy', retryAfter: 1 })
    expect(await request('POST', '/auth/login', {})).toEqual({
      ok: false,
      error: { kind: 'refused', status: 503, code: 'busy', retryAfter: 1 },
    })
    respond(400, { error: 'invalid' })
    expect(await request('PUT', '/settings', {})).toEqual({
      ok: false,
      error: { kind: 'refused', status: 400, code: 'invalid' },
    })
  })

  it('calls a successful reply that is not a JSON object an error', async () => {
    respond(200, [1, 2])
    expect(await request('GET', '/state')).toEqual({
      ok: false,
      error: { kind: 'refused', status: 200, code: 'error' },
    })
  })

  it('calls a 5xx with no API code a server failure, to be retried', async () => {
    respond(500, undefined, 'Internal Server Error')
    expect(await request('GET', '/state')).toEqual({
      ok: false,
      error: { kind: 'server', status: 500 },
    })
  })

  it('sends extra headers alongside the content type', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ rev: 1 }))
    vi.stubGlobal('fetch', fetch)
    await request('PUT', '/settings', {}, { 'X-Expected-User': 'alice' })
    expect(fetch.mock.calls[0]![1]!.headers).toEqual({
      'X-Expected-User': 'alice',
      'Content-Type': 'application/json',
    })
    await request('GET', '/state', undefined, { 'X-Expected-User': 'alice' })
    expect(fetch.mock.calls[1]![1]!.headers).toEqual({ 'X-Expected-User': 'alice' })
  })

  it('gives up after the timeout and calls it offline', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => new Promise<Response>(() => {})),
    )
    const pending = request('GET', '/state')
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    expect(await pending).toEqual({ ok: false, error: { kind: 'offline' } })
    vi.useRealTimers()
  })
})

describe('request DELETE', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends no body but the JSON content type, which every write must carry', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    expect(await request('DELETE', '/ask/conversations/c1')).toEqual({ ok: true, data: undefined })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('/api/ask/conversations/c1')
    expect(init!.method).toBe('DELETE')
    expect(init!.body).toBeUndefined()
    expect(init!.headers).toEqual({ 'Content-Type': 'application/json' })
  })
})

const encoder = new TextEncoder()

/** A reply whose body arrives in these pieces, one read each, then ends (or stays open). */
function streamed(pieces: string[], { open = false } = {}) {
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of pieces) c.enqueue(encoder.encode(p))
      if (!open) c.close()
    },
    cancel() {
      cancelled = true
    },
  })
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
  )
  vi.stubGlobal('fetch', fetch)
  return { fetch, cancelled: () => cancelled }
}

describe('stream', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('posts JSON with the headers and reads frames split anywhere across chunks', async () => {
    const { fetch } = streamed([
      'event: start\ndata: {"remaining": 29, "conv',
      'ersation": "c1"}\n\n: keep-alive\n\nevent: text\r\ndata: {"delta": "Three of"}\r\n\r\n',
      'event: text\ndata: {"delta": " four"}\n',
      '\nevent: done\ndata: {"stop": "end_turn", "saved": true}\n\n',
    ])
    const events: StreamEvent[] = []
    const result = await stream('/ask', { question: 'Q' }, (e) => events.push(e), {
      headers: { 'X-Expected-User': 'alice' },
    })
    expect(result).toEqual({ ok: true })
    expect(events).toEqual([
      { event: 'start', data: { remaining: 29, conversation: 'c1' } },
      { event: 'text', data: { delta: 'Three of' } },
      { event: 'text', data: { delta: ' four' } },
      { event: 'done', data: { stop: 'end_turn', saved: true } },
    ])
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('/api/ask')
    expect(init).toMatchObject({
      method: 'POST',
      body: '{"question":"Q"}',
      credentials: 'same-origin',
      headers: { 'X-Expected-User': 'alice', 'Content-Type': 'application/json' },
    })
  })

  it('ends at an error event, and stops reading there', async () => {
    const s = streamed(
      ['event: start\ndata: {"remaining": 1}\n\nevent: error\ndata: {"error": "busy"}\n\n'],
      { open: true },
    )
    const events: StreamEvent[] = []
    expect(await stream('/ask', {}, (e) => events.push(e))).toEqual({ ok: true })
    expect(events.at(-1)).toEqual({ event: 'error', data: { error: 'busy' } })
    expect(s.cancelled()).toBe(true)
  })

  it('skips frames with no data or data that is not a JSON object', async () => {
    streamed([
      'event: tool\n\nevent: text\ndata: not json\n\ndata: [1]\n\n',
      // Fields it doesn't use (`retry`, `id`, a line with no colon) are skipped.
      'retry: 3000\nid\nevent: done\ndata: {"stop": "end_turn"}\n\n',
    ])
    const events: StreamEvent[] = []
    await stream('/ask', {}, (e) => events.push(e))
    expect(events).toEqual([{ event: 'done', data: { stop: 'end_turn' } }])
  })

  it('calls a stream that ends with no done or error cut, as a proxy cut arrives as 200', async () => {
    streamed(['event: start\ndata: {"remaining": 1}\n\nevent: text\ndata: {"delta": "Th"}\n\n'])
    const events: StreamEvent[] = []
    expect(await stream('/ask', {}, (e) => events.push(e))).toEqual({
      ok: false,
      error: { kind: 'cut' },
    })
    expect(events).toHaveLength(2)
  })

  it('calls a dropped connection cut', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        c.error(new TypeError('network error'))
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response(body)),
    )
    expect(await stream('/ask', {}, () => {})).toEqual({ ok: false, error: { kind: 'cut' } })
  })

  it('gives up after 30 s with no frame, keep-alives counting as frames', async () => {
    vi.useFakeTimers()
    const s = streamed([': keep-alive\n\n'], { open: true })
    const pending = stream('/ask', {}, () => {})
    let settled = false
    void pending.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(STREAM_IDLE_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toEqual({ ok: false, error: { kind: 'cut' } })
    expect(s.cancelled()).toBe(true)
  })

  it('gives up on a reply that never comes', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => new Promise<Response>(() => {})),
    )
    const pending = stream('/ask', {}, () => {})
    await vi.advanceTimersByTimeAsync(STREAM_IDLE_MS)
    expect(await pending).toEqual({ ok: false, error: { kind: 'cut' } })
  })

  it('stops when its signal aborts, mid-answer or before the reply', async () => {
    const s = streamed(['event: text\ndata: {"delta": "Th"}\n\n'], { open: true })
    const stop = new AbortController()
    const events: StreamEvent[] = []
    const pending = stream('/ask', {}, (e) => events.push(e), { signal: stop.signal })
    await vi.waitFor(() => expect(events).toHaveLength(1))
    stop.abort()
    expect(await pending).toEqual({ ok: false, error: { kind: 'stopped' } })
    expect(s.cancelled()).toBe(true)

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => new Promise<Response>(() => {})),
    )
    const early = new AbortController()
    const waiting = stream('/ask', {}, () => {}, { signal: early.signal })
    early.abort()
    expect(await waiting).toEqual({ ok: false, error: { kind: 'stopped' } })

    const already = new AbortController()
    already.abort()
    expect(await stream('/ask', {}, () => {}, { signal: already.signal })).toEqual({
      ok: false,
      error: { kind: 'stopped' },
    })
  })

  it('stops when the browser fails the body on abort, as a real fetch does', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (_, init) => {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(encoder.encode('event: text\ndata: {"delta": "Th"}\n\n'))
            init!.signal!.addEventListener('abort', () =>
              c.error(new DOMException('aborted', 'AbortError')),
            )
          },
        })
        return new Response(body)
      }),
    )
    const stop = new AbortController()
    const events: StreamEvent[] = []
    const pending = stream('/ask', {}, (e) => events.push(e), { signal: stop.signal })
    await vi.waitFor(() => expect(events).toHaveLength(1))
    stop.abort()
    expect(await pending).toEqual({ ok: false, error: { kind: 'stopped' } })
  })

  it('maps a refusal before the stream as request() does', async () => {
    respond(429, { error: 'too-many', retryAfter: 120 })
    expect(await stream('/ask', {}, () => {})).toEqual({
      ok: false,
      error: { kind: 'refused', status: 429, code: 'too-many', retryAfter: 120 },
    })
    // 503 with the API's own code is Ask being off, not the proxy failing to reach the API.
    respond(503, { error: 'ask-off' })
    expect(await stream('/ask', {}, () => {})).toEqual({
      ok: false,
      error: { kind: 'refused', status: 503, code: 'ask-off' },
    })
    respond(503, undefined, '<html>Bad Gateway</html>')
    expect(await stream('/ask', {}, () => {})).toEqual({ ok: false, error: { kind: 'offline' } })
    respond(401, { error: 'auth' })
    expect(await stream('/ask', {}, () => {})).toEqual({ ok: false, error: { kind: 'auth' } })
  })

  it('calls a network failure offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    expect(await stream('/ask', {}, () => {})).toEqual({ ok: false, error: { kind: 'offline' } })
  })

  it('calls a 200 with no body cut', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response(null, { status: 200 })),
    )
    expect(await stream('/ask', {}, () => {})).toEqual({ ok: false, error: { kind: 'cut' } })
  })
})
