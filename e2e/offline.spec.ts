import { expect, test, type Page } from '@playwright/test'

function trackCsp(page: Page): string[] {
  const violations: string[] = []
  page.on('console', (msg) => {
    if (msg.text().includes('Content Security Policy')) violations.push(msg.text())
  })
  page.on('pageerror', (e) => {
    if (e.message.includes('Content Security Policy')) violations.push(e.message)
  })
  return violations
}

async function swReady(page: Page) {
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((res) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => res(), { once: true })
        // clientsClaim may already have happened
        setTimeout(res, 3000)
      })
    }
    return reg.active?.state
  })
}

test('app renders offline after service worker install', async ({ page, context }) => {
  const csp = trackCsp(page)
  await page.goto('/')
  await expect(page.getByText('YOU SPENT', { exact: true })).toBeVisible()
  await swReady(page)
  // Reload once online so the SW controls the page and everything is cached.
  await page.reload()
  await expect(page.getByText('YOU SPENT', { exact: true })).toBeVisible()

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByText('YOU SPENT', { exact: true })).toBeVisible()
  expect(csp).toEqual([])
})

test('fresh context with empty cache loads without CSP violations', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const csp = trackCsp(page)
  await page.goto('/')
  await expect(page.getByText('YOU SPENT', { exact: true })).toBeVisible()
  // Fonts are self-hosted and used by the title.
  await page.evaluate(() => document.fonts.ready)
  const ok = await page.evaluate(() => document.fonts.check('700 24px Cinzel'))
  expect(ok).toBe(true)
  expect(csp).toEqual([])
  await context.close()
})
