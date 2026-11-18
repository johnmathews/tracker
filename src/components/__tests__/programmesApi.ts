import { vi } from 'vitest'
import type { FakeApi } from '@/lib/__tests__/fakeApi'

/** A reply: a status and a JSON body, or no network at all. */
export type Reply = { status?: number; body?: unknown } | 'offline'
/** A reply, or one made from the request's body, which a test may hold back until it resolves. */
export type Route = Reply | ((body: unknown) => Reply | Promise<Reply>)
export type Call = { method: string; path: string; body: unknown }

/**
 * The programme routes (spec §11.2) layered over the fake API: each "METHOD /path" in `routes`
 * answers from the table, `GET /state` gains `today` and `runs`, and everything else is the fake
 * API's. Returns the programme calls made, in order.
 */
export function withProgrammes(
  api: FakeApi,
  routes: Record<string, Route>,
  extra: { today?: string; runs: Record<string, unknown> } = { today: '2026-11-12', runs: {} },
): { calls: Call[]; routes: Record<string, Route>; extra: typeof extra } {
  const calls: Call[] = []
  const table = { routes, extra }
  const inner = api.fetch
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    const path = String(input).replace(/^\/api/, '')
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    const route = table.routes[`${method} ${path}`]
    if (route !== undefined) {
      calls.push({ method, path, body })
      const reply = typeof route === 'function' ? await route(body) : route
      if (reply === 'offline') throw new TypeError('Failed to fetch')
      if (reply.status === 204) return new Response(null, { status: 204 })
      return Response.json(reply.body ?? {}, { status: reply.status ?? 200 })
    }
    const res = await inner(input, init)
    if (method === 'GET' && path === '/state' && res.ok) {
      return Response.json({ ...(await res.json()), ...table.extra })
    }
    return res
  })
  return { calls, ...table }
}
