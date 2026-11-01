import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  backToWeek,
  cameFromWeek,
  isItemHash,
  itemHref,
  markFromWeek,
  parseItemHash,
  webHost,
} from '@/lib/routes'

afterEach(() => {
  vi.restoreAllMocks()
  history.replaceState(null, '', '/')
})

describe('an item’s address (#/item/<section>/<id>)', () => {
  it('names the section and the id, the id encoded', () => {
    expect(itemHref('exercise', 'pu')).toBe('#/item/exercise/pu')
    expect(itemHref('diet', 'a/b c')).toBe('#/item/diet/a%2Fb%20c')
  })

  it('reads back what it wrote', () => {
    expect(parseItemHash('#/item/exercise/pu')).toEqual({ section: 'exercise', id: 'pu' })
    expect(parseItemHash(itemHref('diet', 'a/b c'))).toEqual({ section: 'diet', id: 'a/b c' })
  })

  it('reads nothing from an address that names no section or no good id', () => {
    for (const hash of [
      '',
      '#/',
      '#/settings',
      '#/item/exercise',
      '#/item/exercise/',
      '#/item/food/pu',
      '#/item/__proto__/pu',
      '#/item/exercise/__proto__',
      '#/item/exercise/%E0%A4%A',
      `#/item/exercise/${'x'.repeat(129)}`,
      '#/item/exercise/pu/more',
    ])
      expect(parseItemHash(hash)).toBeNull()
  })

  it('knows an item address by its start, good or not', () => {
    expect(isItemHash('#/item/food/pu')).toBe(true)
    expect(isItemHash('#/settings')).toBe(false)
  })
})

describe('whether the item page was opened from the week in this tab', () => {
  it('is marked on the page’s own history entry, keeping what was there', () => {
    expect(cameFromWeek()).toBe(false)
    history.replaceState({ other: 1 }, '')
    markFromWeek()
    expect(cameFromWeek()).toBe(true)
    expect(history.state).toMatchObject({ other: 1 })
    history.replaceState('not a record', '')
    expect(cameFromWeek()).toBe(false)
    markFromWeek()
    expect(cameFromWeek()).toBe(true)
  })
})

describe('backToWeek', () => {
  function click(init: MouseEventInit = {}): MouseEvent {
    return new MouseEvent('click', { cancelable: true, button: 0, ...init })
  }

  it('goes back through history when the week is the entry before', () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => {})
    markFromWeek()
    const ev = click()
    backToWeek(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(back).toHaveBeenCalledOnce()
  })

  it('replaces the page with the week when it was opened some other way', () => {
    const back = vi.spyOn(history, 'back')
    history.replaceState(null, '', '/#/item/exercise/pu')
    const ev = click()
    backToWeek(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(back).not.toHaveBeenCalled()
    expect(location.hash).toBe('#/')
  })

  it('leaves a press with a modifier key to the browser (a new tab or window)', () => {
    const back = vi.spyOn(history, 'back')
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      const ev = click(init)
      backToWeek(ev)
      expect(ev.defaultPrevented).toBe(false)
    }
    expect(back).not.toHaveBeenCalled()
  })
})

describe('webHost', () => {
  it('names the site of a web address, without www', () => {
    expect(webHost('https://youtube.com/watch?v=swing-form')).toBe('youtube.com')
    expect(webHost('  http://www.example.org/a ')).toBe('example.org')
  })

  it('is null for anything that isn’t an http or https address', () => {
    for (const text of ['', 'kettlebell', 'javascript:alert(1)', 'mailto:a@b.c', 'ftp://x.org'])
      expect(webHost(text)).toBeNull()
  })
})
