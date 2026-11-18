import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  backToWeek,
  cameFromWeek,
  isItemHash,
  itemHref,
  leaveForWeek,
  markFromWeek,
  newItemHref,
  NEW_TRACKER_HREF,
  isNewTrackerHash,
  parseItemHash,
  parseNewHash,
  parseSettingsHash,
  isProgrammesHash,
  parseProgrammeHash,
  programmeHref,
  PROGRAMMES_HREF,
  SETTINGS_TABS,
  settingsHref,
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
    // Any tracker id reads: whether the account has it is the app's to check (K123).
    expect(parseItemHash(itemHref('xk3j9a2b1c', 'pu'))).toEqual({ section: 'xk3j9a2b1c', id: 'pu' })
    expect(parseItemHash(itemHref('diet', 'a/b c'))).toEqual({ section: 'diet', id: 'a/b c' })
  })

  it('reads nothing from an address that names no section or no good id', () => {
    for (const hash of [
      '',
      '#/',
      '#/settings',
      '#/item/exercise',
      '#/item/exercise/',
      '#/item/a.b/pu',
      '#/item/a%20b/pu',
      `#/item/${'t'.repeat(65)}/pu`,
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

describe('the new item page’s address (#/new/<section>, K104)', () => {
  it('names the section, and reads it back', () => {
    expect(newItemHref('cardio')).toBe('#/new/cardio')
    expect(parseNewHash('#/new/cardio')).toBe('cardio')
    expect(parseNewHash(newItemHref('diet'))).toBe('diet')
    expect(parseNewHash(newItemHref('x-new_1'))).toBe('x-new_1')
  })

  it('reads nothing from any other address', () => {
    for (const hash of [
      '',
      '#/',
      '#/new',
      '#/new/',
      '#/new/a.b',
      '#/new/__proto__',
      '#/new-tracker',
      '#/new/exercise/x',
      '#/item/exercise/pu',
    ])
      expect(parseNewHash(hash)).toBeNull()
  })
})

describe('the new tracker page’s address (#/new-tracker, K124)', () => {
  it('knows its own address and no other', () => {
    expect(isNewTrackerHash(NEW_TRACKER_HREF)).toBe(true)
    expect(NEW_TRACKER_HREF).toBe('#/new-tracker')
    for (const hash of ['', '#/', '#/new-tracker/x', '#/new/tracker', '#/new-trackers'])
      expect(isNewTrackerHash(hash)).toBe(false)
  })
})

describe('the Programmes page’s address (#/programmes, spec §9.1)', () => {
  it('knows its own address and no other', () => {
    expect(PROGRAMMES_HREF).toBe('#/programmes')
    expect(isProgrammesHash('#/programmes')).toBe(true)
    for (const hash of ['', '#/', '#/programmes/x', '#/programme', '#/programme/x'])
      expect(isProgrammesHash(hash)).toBe(false)
  })
})

describe('a programme’s overview address (#/programme/<tracker>, spec §9.2)', () => {
  it('names the tracker, and reads back what it wrote', () => {
    expect(programmeHref('xk3j9a2b1c')).toBe('#/programme/xk3j9a2b1c')
    expect(parseProgrammeHash(programmeHref('xk3j9a2b1c'))).toBe('xk3j9a2b1c')
  })

  it('reads nothing from an address that names no tracker id', () => {
    for (const hash of ['', '#/programme/', '#/programme/a/b', '#/programmes', '#/programme/A B'])
      expect(parseProgrammeHash(hash)).toBeNull()
  })
})

describe('the Settings tabs’ addresses (#/settings/<tab>, K119)', () => {
  it('has a tab per section, in the page’s order', () => {
    expect(SETTINGS_TABS).toEqual(['appearance', 'daily-goal', 'data', 'connections'])
  })

  it('names each tab, and reads it back', () => {
    expect(settingsHref()).toBe('#/settings')
    expect(settingsHref('connections')).toBe('#/settings/connections')
    for (const tab of SETTINGS_TABS) expect(parseSettingsHash(settingsHref(tab))).toBe(tab)
  })

  it('opens the first tab at the page’s own address', () => {
    expect(parseSettingsHash('#/settings')).toBe('appearance')
  })

  it('reads nothing from any other address, or a tab Settings doesn’t have', () => {
    for (const hash of [
      '',
      '#/',
      '#/settings/',
      '#/settings/goals',
      '#/settings/connections/more',
      '#/settings/__proto__',
      '#/settingsx',
      '#/profile',
    ])
      expect(parseSettingsHash(hash)).toBeNull()
  })
})

describe('leaving a page for the week (K104)', () => {
  it('goes back through history when the week opened it, else replaces this entry', () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => {})
    history.replaceState(null, '', '/#/new/exercise')
    leaveForWeek()
    expect(location.hash).toBe('#/')
    expect(back).not.toHaveBeenCalled()
    history.replaceState(null, '', '/#/new/exercise')
    markFromWeek()
    leaveForWeek()
    expect(back).toHaveBeenCalledOnce()
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
