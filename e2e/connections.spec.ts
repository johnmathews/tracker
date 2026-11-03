// Settings › Connections and the consent screen (ConnectionsSection and ConnectPage cards, W6): a
// token created, shown once and removed in a real browser, and the screen Claude opens walked
// through to its callback. The API is mocked here, on top of support.ts's.
import { expect, test, type Page, type Route } from '@playwright/test'
import {
  THEMES,
  callUpBar,
  expectNoAxeViolations,
  expectNoSidewaysScroll,
  openApp,
  settle,
  type Theme,
} from './support'

const NOON = Math.floor(new Date('2026-10-21T12:00:00').getTime() / 1000)
const PLAIN = 'trk_Hn3vY8sE4dKqLw0ZpRt6Uj1Xb5MfNaGc2VyOiTe7Ws'

type Token = { name: string; prefix: string; scope: string; createdAt: number; lastUsedAt: null }

/** Alice's Settings page, with one app connected an hour ago and the tokens the test makes. */
async function openConnections(page: Page, theme: Theme = 'light'): Promise<Token[]> {
  const tokens: Token[] = []
  await openApp(page, { theme })
  await page.route('**/api/**', async (route: Route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname.replace(/^\/api/, '')
    if (path === '/tokens' && req.method() === 'GET') return route.fulfill({ json: { tokens } })
    if (path === '/tokens' && req.method() === 'POST') {
      const body = req.postDataJSON() as { name: string; scope: string }
      const info = { ...body, prefix: 'Hn3vY8sE', createdAt: NOON, lastUsedAt: null }
      tokens.unshift(info)
      return route.fulfill({ status: 201, json: { token: PLAIN, info } })
    }
    if (path.startsWith('/tokens/') && req.method() === 'DELETE') {
      tokens.splice(0, tokens.length, ...tokens.filter((t) => !path.endsWith(t.prefix)))
      return route.fulfill({ status: 204 })
    }
    if (path === '/connections') {
      return route.fulfill({
        json: {
          connections: [
            {
              id: 'g1',
              clientName: 'Claude',
              clientHost: 'claude.ai',
              scope: 'write',
              createdAt: NOON - 3600,
              lastUsedAt: NOON - 600,
              expiresAt: NOON + 90 * 24 * 3600,
              isNew: true,
            },
          ],
        },
      })
    }
    return route.fallback()
  })
  await callUpBar(page)
  await page.getByRole('button', { name: /Settings/ }).click()
  await page.getByRole('heading', { level: 1, name: 'Settings' }).waitFor()
  await page.getByTestId('apps-list').waitFor()
  await settle(page)
  return tokens
}

/** The consent screen for request `req1` from claude.ai, signed out. A good password goes back to
 * a callback on this site, so the browser never leaves for the real claude.ai. */
async function openConsent(page: Page, theme: Theme = 'light'): Promise<string[]> {
  const sent: string[] = []
  await page.route('**/api/**', async (route: Route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname.replace(/^\/api/, '')
    if (path === '/auth/options') return route.fulfill({ json: { mail: false } })
    if (path === '/oauth/requests/req1') {
      return route.fulfill({
        json: {
          clientName: 'Claude',
          clientHost: 'claude.ai',
          redirectHost: 'claude.ai',
          scope: null,
          expiresAt: NOON + 600,
        },
      })
    }
    if (path === '/oauth/requests/req1/approve') {
      sent.push(req.postData() ?? '')
      const body = req.postDataJSON() as { password: string }
      if (body.password !== 'correct horse battery') {
        return route.fulfill({ status: 401, json: { error: 'invalid' } })
      }
      // Absolute, as the API answers: the app leaves only for https or http to this computer.
      const redirectTo = new URL('/callback?code=abc&state=st', route.request().url()).href
      return route.fulfill({ json: { redirectTo } })
    }
    return route.fulfill({ status: 401, json: {} })
  })
  await page.addInitScript((theme) => {
    localStorage.setItem('tracker-settings-v1', JSON.stringify({ theme }))
  }, theme)
  await page.goto('/#/connect/req1')
  await page.getByRole('heading', { level: 1, name: 'Connect Claude' }).waitFor()
  await settle(page)
  return sent
}

test.describe('Settings › Connections', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('creates a token, shows it once with Copy, and removes it', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openConnections(page)
    const section = page.getByTestId('connections-section')
    await expect(section.getByTestId('connection-banner')).toContainText(
      'Claude was connected just now, with read and change.',
    )
    await expect(section.getByTestId('mcp-address')).toHaveText(/\/api\/mcp$/)
    // The address and the token are in the monospace face, and nothing else is.
    const mono = await section
      .getByTestId('mcp-address')
      .evaluate((el) => getComputedStyle(el).fontFamily)
    expect(mono).toContain('monospace')

    await section.getByRole('button', { name: 'Create token' }).click()
    await section.getByLabel('Name').fill('Desktop')
    await section.getByRole('button', { name: 'Read and change' }).click()
    await section.getByTestId('token-form').getByRole('button', { name: 'Create token' }).click()
    const shown = section.getByTestId('token-shown')
    await expect(shown.getByTestId('token-plain')).toHaveText(PLAIN)
    await expect(shown).toBeFocused()
    await shown.getByRole('button', { name: 'Copy' }).click()
    await expect(shown.getByRole('button', { name: 'Copied' })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(PLAIN)
    await expect(section.getByTestId('tokens-list')).toContainText(
      'trk_Hn3vY8sE… · Read and change · created today · never used',
    )
    await shown.getByRole('button', { name: 'Done' }).click()
    await expect(section.getByTestId('token-shown')).toHaveCount(0)
    await expect(page.getByText(PLAIN)).toHaveCount(0)

    await section.getByRole('button', { name: 'Remove Desktop' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Remove Desktop?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Remove' }).click()
    await expect(dialog).toBeHidden()
    await expect(section).toContainText('No tokens yet.')
    // Focus lands on the list's heading, not the page.
    await expect(section.getByRole('heading', { level: 3, name: 'Tokens' })).toBeFocused()
  })

  for (const theme of THEMES) {
    test(`passes axe with the banner and a token shown once, ${theme}`, async ({ page }) => {
      await openConnections(page, theme)
      const section = page.getByTestId('connections-section')
      await section.getByRole('button', { name: 'Create token' }).click()
      await section.getByLabel('Name').fill('Desktop')
      await section.getByTestId('token-form').getByRole('button', { name: 'Create token' }).click()
      await section.getByTestId('token-shown').waitFor()
      await settle(page)
      await expectNoAxeViolations(page)
    })
  }

  test('folds to a phone without sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await openConnections(page)
    await expectNoSidewaysScroll(page)
  })
})

test.describe('the consent screen', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('a wrong password shows on both fields, then Connect goes back to the app', async ({
    page,
  }) => {
    const sent = await openConsent(page)
    await expect(page.getByTestId('exercise-grid')).toHaveCount(0)
    await expect(page.getByRole('radio', { name: 'Read only' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await page.getByLabel('Email').fill('sam@example.com')
    await page.getByLabel('Password').fill('wrong one')
    await page.getByRole('button', { name: 'Connect' }).click()
    await expect(page.getByRole('alert')).toHaveText(
      'Wrong email or password. Check them and try again.',
    )
    await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByLabel('Password')).toBeFocused()

    await page.getByRole('radio', { name: 'Read and change' }).click()
    await page.getByLabel('Password').fill('correct horse battery')
    await page.getByRole('button', { name: 'Connect' }).click()
    await page.waitForURL(/\/callback\?code=abc&state=st$/)
    expect(JSON.parse(sent.at(-1)!)).toEqual({
      email: 'sam@example.com',
      password: 'correct horse battery',
      write: true,
    })
  })

  for (const theme of THEMES) {
    test(`passes axe, signed out and with a wrong password, ${theme}`, async ({ page }) => {
      await openConsent(page, theme)
      await expectNoAxeViolations(page)
      await page.getByLabel('Email').fill('sam@example.com')
      await page.getByLabel('Password').fill('wrong one')
      await page.getByRole('button', { name: 'Connect' }).click()
      await page.getByRole('alert').waitFor()
      await settle(page)
      await expectNoAxeViolations(page)
    })
  }

  test('fits a phone without sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await openConsent(page)
    await expectNoSidewaysScroll(page)
  })
})
