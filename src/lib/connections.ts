import { request, type ApiResult } from '@/lib/api'
import { isRecord } from '@/lib/storage'

/**
 * The calls behind Settings › Connections and the consent screen (docs/api.md): personal tokens
 * (W2), the apps connected by OAuth, and a pending OAuth request (W4). Settings' calls are the
 * signed-in user's and say who that is (`X-Expected-User`); the consent screen's need no session.
 * Times are the API's Unix seconds.
 */

export type Scope = 'read' | 'write'

/** A personal token as the list shows it: never the token itself. */
export type TokenInfo = {
  name: string
  /** The 8 characters after `trk_`. */
  prefix: string
  scope: Scope
  createdAt: number
  lastUsedAt: number | null
}

/** An app connected by signing in from it. */
export type Connection = {
  id: string
  clientName: string
  clientHost: string
  scope: Scope
  createdAt: number
  lastUsedAt: number | null
  expiresAt: number
  /** Approved in the last 24 hours, on the server's clock. */
  isNew: boolean
}

/** A pending request on the consent screen. */
export type ConsentRequest = {
  clientName: string
  clientHost: string
  redirectHost: string
  /** What the app asked for; the screen picks Read only whatever it is. */
  scope: string | null
  expiresAt: number
}

/** The most personal tokens and live connections one account may hold (D6). */
export const MAX_TOKENS = 20
export const MAX_CONNECTIONS = 10
/** The longest token name the API takes. */
export const MAX_TOKEN_NAME = 64

/** The MCP endpoint's address on this site, to paste into Claude. */
export function mcpAddress(origin: string = location.origin): string {
  return `${origin}/api/mcp`
}

/** What a token's text looks like in a list: its prefix, then an ellipsis. */
export function tokenLabel(prefix: string): string {
  return `trk_${prefix}…`
}

/** The access, as the screens name it. */
export function scopeName(scope: Scope): string {
  return scope === 'write' ? 'Read and change' : 'Read only'
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** Where the browser goes back to: a loopback redirect is the person's own computer. */
export function backTo(host: string): string {
  return LOOPBACK.has(host) ? 'this computer (localhost)' : host
}

/** A reply whose body isn't the shape the API promises counts as the server's fault. */
function shaped<T>(res: ApiResult<unknown>, ok: (data: Record<string, unknown>) => T | null) {
  if (!res.ok) return res
  const data = isRecord(res.data) ? ok(res.data) : null
  return data === null
    ? ({ ok: false, error: { kind: 'server', status: 200 } } as const)
    : ({ ok: true, data } as const)
}

const as = (user: string | null) => ({ 'X-Expected-User': user ?? '' })

export async function listTokens(user: string | null): Promise<ApiResult<TokenInfo[]>> {
  const res = await request('GET', '/tokens', undefined, as(user))
  return shaped(res, (d) => (Array.isArray(d.tokens) ? (d.tokens as TokenInfo[]) : null))
}

/** Create a token. The reply is the one place its plaintext ever appears. */
export async function createToken(
  user: string | null,
  name: string,
  scope: Scope,
): Promise<ApiResult<{ token: string; info: TokenInfo }>> {
  const res = await request('POST', '/tokens', { name, scope }, as(user))
  return shaped(res, (d) =>
    typeof d.token === 'string' && isRecord(d.info)
      ? { token: d.token, info: d.info as TokenInfo }
      : null,
  )
}

export function removeToken(user: string | null, prefix: string): Promise<ApiResult<void>> {
  return request<void>('DELETE', `/tokens/${encodeURIComponent(prefix)}`, undefined, as(user))
}

export async function listConnections(user: string | null): Promise<ApiResult<Connection[]>> {
  const res = await request('GET', '/connections', undefined, as(user))
  return shaped(res, (d) => (Array.isArray(d.connections) ? (d.connections as Connection[]) : null))
}

export function removeConnection(user: string | null, id: string): Promise<ApiResult<void>> {
  return request<void>('DELETE', `/connections/${encodeURIComponent(id)}`, undefined, as(user))
}

const requestPath = (id: string) => `/oauth/requests/${encodeURIComponent(id)}`

export async function getRequest(id: string): Promise<ApiResult<ConsentRequest>> {
  const res = await request('GET', requestPath(id))
  return shaped(res, (d) =>
    typeof d.clientName === 'string' &&
    typeof d.clientHost === 'string' &&
    typeof d.redirectHost === 'string'
      ? (d as ConsentRequest)
      : null,
  )
}

const redirect = (d: Record<string, unknown>) =>
  typeof d.redirectTo === 'string' ? d.redirectTo : null

/** Approve with the account's email and password; the answer is the address to go back to. */
export async function approveRequest(
  id: string,
  answer: { email: string; password: string; write: boolean },
): Promise<ApiResult<string>> {
  return shaped(await request('POST', `${requestPath(id)}/approve`, answer), redirect)
}

/**
 * Say no; the answer is the address to go back to. The `{}` body matters: `request` sends the
 * JSON content type only with a body (or a DELETE), and the API refuses a write without it.
 */
export async function denyRequest(id: string): Promise<ApiResult<string>> {
  return shaped(await request('POST', `${requestPath(id)}/deny`, {}), redirect)
}

/** Whether an address the API gave is one to leave for: https, or http to this computer. The API
 * only hands back such addresses; this is the second lock on the door. */
export function safeDestination(url: string): boolean {
  try {
    const u = new URL(url)
    return (
      u.protocol === 'https:' ||
      (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
    )
  } catch {
    return false
  }
}

/** Leave the app for the address the API gave (Claude's callback). Tests replace it: jsdom can't
 * navigate, and its `location` can't be stubbed. */
/* v8 ignore next 3 */
export function navigateTo(url: string): void {
  if (safeDestination(url)) window.location.assign(url)
}

// ---------------------------------------------------------------- dates

/** Half a year either way of now: close enough that "1 Feb" can't be mistaken for another. */
const NEAR_MS = 183 * 24 * 3600 * 1000

function dayKey(d: Date): string {
  return d.toDateString()
}

function shortDate(d: Date, now: Date): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  if (Math.abs(d.getTime() - now.getTime()) > NEAR_MS) opts.year = 'numeric'
  return d.toLocaleDateString('en-GB', opts)
}

/** "09:14", in the browser's time. */
function clock(d: Date): string {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** "today", "yesterday" or "24 Oct" (with the year when it's far from now). */
export function dayText(seconds: number, now: Date): string {
  const d = new Date(seconds * 1000)
  if (dayKey(d) === dayKey(now)) return 'today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (dayKey(d) === dayKey(yesterday)) return 'yesterday'
  return shortDate(d, now)
}

/** "3 Nov at 14:02": when an app was connected. */
export function dateAt(seconds: number, now: Date): string {
  const d = new Date(seconds * 1000)
  return `${shortDate(d, now)} at ${clock(d)}`
}

/** "today at 14:05", "yesterday" or "2 Nov": when something was last used. */
export function lastUsedText(seconds: number, now: Date): string {
  const day = dayText(seconds, now)
  return day === 'today' ? `today at ${clock(new Date(seconds * 1000))}` : day
}

/** The line of facts under a connected app. */
export function connectionFacts(c: Connection, now: Date): string {
  return [
    ...(c.isNew ? ['New'] : []),
    scopeName(c.scope),
    `connected ${dateAt(c.createdAt, now)}`,
    c.lastUsedAt === null ? 'never used' : `last used ${lastUsedText(c.lastUsedAt, now)}`,
    `ends ${shortDate(new Date(c.expiresAt * 1000), now)}`,
  ].join(' · ')
}

/** The line of facts under a token, after its prefix. */
export function tokenFacts(t: TokenInfo, now: Date): string {
  return [
    scopeName(t.scope),
    `created ${dayText(t.createdAt, now)}`,
    t.lastUsedAt === null ? 'never used' : `last used ${dayText(t.lastUsedAt, now)}`,
  ].join(' · ')
}
