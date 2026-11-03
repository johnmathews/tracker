import { describe, expect, it } from 'vitest'
import {
  backTo,
  connectionFacts,
  dateAt,
  dayText,
  lastUsedText,
  mcpAddress,
  safeDestination,
  tokenFacts,
  tokenLabel,
} from '@/lib/connections'
import { describeConnectProblem } from '@/lib/problems'

const NOW = new Date(2026, 10, 3, 14, 10)
const s = (d: Date) => Math.floor(d.getTime() / 1000)

describe('connections', () => {
  it('words days as the list says them, the year only when far from now', () => {
    expect(dayText(s(new Date(2026, 10, 3, 0, 1)), NOW)).toBe('today')
    expect(dayText(s(new Date(2026, 10, 2, 23, 59)), NOW)).toBe('yesterday')
    expect(dayText(s(new Date(2026, 9, 24)), NOW)).toBe('24 Oct')
    expect(dayText(s(new Date(2025, 9, 24)), NOW)).toBe('24 Oct 2025')
    expect(dateAt(s(new Date(2026, 10, 3, 9, 5)), NOW)).toBe('3 Nov at 09:05')
    expect(lastUsedText(s(new Date(2026, 10, 3, 14, 5)), NOW)).toBe('today at 14:05')
    expect(lastUsedText(s(new Date(2026, 10, 1)), NOW)).toBe('1 Nov')
  })

  it('writes the facts of an app and a token', () => {
    const app = {
      id: 'g',
      clientName: 'Claude',
      clientHost: 'claude.ai',
      scope: 'read' as const,
      createdAt: s(new Date(2026, 10, 3, 14, 2)),
      lastUsedAt: null,
      expiresAt: s(new Date(2027, 1, 1)),
      isNew: true,
    }
    expect(connectionFacts(app, NOW)).toBe(
      'New · Read only · connected 3 Nov at 14:02 · never used · ends 1 Feb',
    )
    const token = {
      name: 'Laptop',
      prefix: 'Xq7mPa2L',
      scope: 'write' as const,
      createdAt: s(NOW),
      lastUsedAt: s(new Date(2026, 10, 2)),
    }
    expect(tokenLabel(token.prefix)).toBe('trk_Xq7mPa2L…')
    expect(tokenFacts(token, NOW)).toBe('Read and change · created today · last used yesterday')
  })

  it('gives the address and names a loopback redirect', () => {
    expect(mcpAddress('https://tracker.example')).toBe('https://tracker.example/api/mcp')
    for (const host of ['localhost', '127.0.0.1', '::1']) {
      expect(backTo(host)).toBe('this computer (localhost)')
    }
    expect(backTo('claude.ai')).toBe('claude.ai')
  })

  it('leaves only for https, or http to this computer', () => {
    expect(safeDestination('https://claude.ai/api/mcp/auth_callback?code=c&state=s')).toBe(true)
    expect(safeDestination('http://localhost:61234/callback?code=c')).toBe(true)
    expect(safeDestination('http://127.0.0.1:5000/callback')).toBe(true)
    expect(safeDestination('http://[::1]:5000/callback')).toBe(true)
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'http://example.com/cb',
      'myapp:/cb',
      'not a url',
    ]) {
      expect(safeDestination(bad)).toBe(false)
    }
  })

  it('words the consent screen’s refusals', () => {
    expect(describeConnectProblem({ code: 'too-many' })).toBe(
      'You have ten connections, the most there can be. Remove one in Settings › Connections, then try again.',
    )
    expect(describeConnectProblem({ code: 'no-request' })).toBe(
      'This link has expired. Go back to the app and connect again.',
    )
    expect(describeConnectProblem({ code: 'disabled' })).toBe(
      'This account is turned off. Ask whoever runs this planner.',
    )
    expect(describeConnectProblem({ code: 'invalid' })).toBe(
      'Wrong email or password. Check them and try again.',
    )
    expect(describeConnectProblem({ code: 'busy' })).toBe(
      'The server is busy. Try again in a moment.',
    )
  })
})
