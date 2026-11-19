import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The print block in main.css writes the light theme's colours out literally, because a dark
// screen must still print light; this keeps them from drifting from tokens.json.
const css = readFileSync(join(import.meta.dirname, '../main.css'), 'utf8')
const tokens = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '../../../brand/design-system/project/tokens.json'),
    'utf8',
  ),
) as { color: { tokens: { name: string; value: { light: string } }[] } }
const light = new Map(tokens.color.tokens.map((t) => [t.name, t.value.light]))

function printRoles(): Map<string, string> {
  const from = css.indexOf('@media print {')
  expect(from).toBeGreaterThanOrEqual(0)
  const block = css.slice(from, css.indexOf('\n  }', css.indexOf(':root,', from)))
  return new Map([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]))
}

describe('print', () => {
  it('keeps the light theme’s words, boxes and marks in either theme', () => {
    const roles = printRoles()
    for (const role of [
      'line',
      'control-border',
      'ink',
      'on-ink',
      'ink-secondary',
      'error-ink',
      'caution-ink',
      'paused-ink',
      'pen',
      'pen-partial',
      'pen-missed',
    ]) {
      expect([role, roles.get(role)]).toEqual([role, light.get(role)])
    }
  })

  it('leaves the paper white: every surface is transparent', () => {
    const roles = printRoles()
    for (const role of ['canvas', 'panel', 'tile']) {
      expect([role, roles.get(role)]).toEqual([role, 'transparent'])
    }
  })
})
