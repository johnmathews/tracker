import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// nginx.conf ships in the web image, and nothing else checks it before a deploy.
const conf = readFileSync(join(import.meta.dirname, '../../../nginx.conf'), 'utf8')

function block(start: string): string {
  const from = conf.indexOf(start)
  expect(from).toBeGreaterThanOrEqual(0)
  return conf.slice(from, conf.indexOf('\n    }', from))
}

describe('nginx.conf', () => {
  it('keeps the CSP exactly as it was: the API is same-origin, so it needs no change', () => {
    expect(conf).toContain(
      `add_header Content-Security-Policy "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;`,
    )
  })

  it('proxies /api/ to the API container, resolving it per request', () => {
    const api = block('location /api/ {')
    // A variable upstream with Docker's resolver: nginx starts, and serves the app, while the
    // API is down; requests then get 502, which the client treats as offline.
    expect(api).toContain('resolver 127.0.0.11 valid=10s ipv6=off;')
    expect(api).toContain('set $api http://fitness-api:8000;')
    expect(api).toContain('proxy_pass $api;')
    // A stopped API's stale address times out rather than refusing; don't hold requests for 60 s.
    expect(api).toContain('proxy_connect_timeout 3s;')
    // An import may be a whole account (6 MiB); the API holds every other write to 1 MiB.
    expect(api).toContain('client_max_body_size 6m;')
    // The API's own Cache-Control is dropped so the server-level one is the only one sent.
    expect(api).toContain('proxy_hide_header Cache-Control;')
    expect(api).not.toContain('add_header')
  })

  it('marks API responses no-store', () => {
    expect(conf).toMatch(/~\^\/api\/\s+"no-store";/)
  })

  // OAuth discovery (RFC 9728, RFC 8414): the API serves the JSON, and these paths sit outside /api/,
  // so without their own locations they fall through to the SPA and return index.html.
  describe.each([
    '/.well-known/oauth-protected-resource/api/mcp',
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-authorization-server',
  ])('discovery path %s', (path) => {
    it('proxies to the API container, as /api/ does', () => {
      const loc = block(`location = ${path} {`)
      expect(loc).toContain('resolver 127.0.0.11 valid=10s ipv6=off;')
      expect(loc).toContain('set $api http://fitness-api:8000;')
      expect(loc).toContain('proxy_pass $api;')
      expect(loc).toContain('proxy_connect_timeout 3s;')
      expect(loc).toContain('proxy_http_version 1.1;')
      expect(loc).toContain('proxy_set_header Host $host;')
      expect(loc).toContain('proxy_hide_header Cache-Control;')
      // add_header here would drop the server-level security headers.
      expect(loc).not.toContain('add_header')
    })
  })

  it('answers any other /.well-known/ path with 404, not the SPA', () => {
    const wk = block('location ^~ /.well-known/ {')
    expect(wk).toContain('return 404;')
    expect(wk).not.toContain('add_header')
  })

  it('marks /.well-known/ responses no-store', () => {
    expect(conf).toMatch(/~\^\/\\\.well-known\/\s+"no-store";/)
  })
})
