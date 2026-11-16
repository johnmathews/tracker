import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_NAME } from '@/lib/app'
import { BOX_PATH, MARK_SYMBOLS } from '@/components/ui/day-mark'

// The icons (K139) are files scripts/app_icon.py writes; nothing else checks them before a deploy.
const root = join(import.meta.dirname, '../../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const html = read('index.html')

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(path: string): [number, number] {
  const png = readFileSync(join(root, 'public', path))
  return [png.readUInt32BE(16), png.readUInt32BE(20)]
}

describe('the app icon and favicon', () => {
  it('links every icon from index.html, and each file is in public/', () => {
    const links = [
      ...html.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)" href="\/([^"]+)"/g),
    ]
    expect(links.map((m) => m[1])).toEqual([
      'favicon.ico',
      'favicon.svg',
      'apple-touch-icon.png',
      'manifest.webmanifest',
    ])
    for (const [, file] of links) expect(existsSync(join(root, 'public', file!))).toBe(true)
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="%APP_NAME%" />')
  })

  it('draws the planner’s own box and tick, in light and in dark', () => {
    const svg = read('public/favicon.svg')
    expect(svg).toContain(BOX_PATH)
    expect(svg).toContain(MARK_SYMBOLS.ticks.great.path)
    expect(svg).toContain('prefers-color-scheme:dark')
  })

  it('names the app in the manifest, with each icon at its stated size', () => {
    const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
      name: string
      short_name: string
      icons: { src: string; sizes: string; purpose?: string }[]
    }
    expect(manifest.name).toBe(APP_NAME)
    expect(manifest.short_name).toBe(APP_NAME)
    for (const icon of manifest.icons) {
      const [w, h] = icon.sizes.split('x').map(Number)
      expect(pngSize(icon.src.slice(1))).toEqual([w, h])
    }
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true)
    expect(pngSize('apple-touch-icon.png')).toEqual([180, 180])
  })
})
