import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { MemorySheet } from '../src/lib/bridge/mock.ts'
import { handleRequest, setupCore, TX_SHEET, type Deps } from '../bridge/core.ts'
import { addEntry } from './helpers.ts'

const URL = 'https://script.google.com/macros/s/TEST/exec'
const TOKEN = 'fake-token-for-tests'
const SETUP = 'youspent1.' + Buffer.from(JSON.stringify({ u: URL, t: TOKEN })).toString('base64url')

test.use({ colorScheme: 'dark' })

async function fakeBridge(context: BrowserContext) {
  const sheet = new MemorySheet()
  setupCore({ setup: sheet, sheet, getToken: () => TOKEN, setToken: () => {}, randomBytes32: () => new Uint8Array(32) })
  const deps: Deps = { sheet, getToken: () => TOKEN, now: () => Date.now(), uuid: () => crypto.randomUUID(), lock: { run: (fn) => fn() } }
  const state = { offline: false, requests: 0 }
  await context.route(URL, async (route) => {
    if (state.offline) return route.abort('internetdisconnected')
    state.requests++
    const env = handleRequest(route.request().postData() ?? '', deps)
    await route.fulfill({
      status: 200,
      contentType: 'text/plain;charset=utf-8',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(env),
    })
  })
  const txRows = () => sheet.readAll(TX_SHEET).slice(1)
  return { sheet, state, txRows }
}

async function goOffline(context: BrowserContext, f: { state: { offline: boolean } }) {
  f.state.offline = true
  await context.setOffline(true)
}
async function goOnline(context: BrowserContext, f: { state: { offline: boolean } }) {
  f.state.offline = false
  await context.setOffline(false)
}

async function configure(page: Page, shot?: string) {
  await page.getByRole('button', { name: 'Settings' }).click()
  const dlg = page.getByTestId('settings')
  await dlg.getByLabel('Setup string').fill(SETUP)
  await dlg.getByRole('button', { name: 'Apply' }).click()
  await expect(dlg.getByTestId('conn-state')).toHaveText('Configured.')
  await dlg.getByRole('button', { name: 'Test connection' }).click()
  await expect(dlg.getByTestId('test-result')).toContainText('OK')
  if (shot) await page.screenshot({ path: shot })
  await dlg.getByRole('button', { name: 'Close settings' }).click()
  await expect(page.getByTestId('sync-pill')).toContainText('Synced')
}

const pill = (page: Page) => page.getByTestId('sync-pill')

test('three offline entries sync once, survive reload', async ({ page, context }) => {
  const csp: string[] = []
  page.on('console', (m) => m.text().includes('Content Security Policy') && csp.push(m.text()))
  const f = await fakeBridge(context)
  await page.goto('/')
  await configure(page, 'test-results/settings.png')

  await goOffline(context, f)
  await expect(pill(page)).toContainText('Offline')
  await addEntry(page, '100', 'test-results/spent-card.png')
  await addEntry(page, '200')
  await addEntry(page, '300')
  await expect(pill(page)).toContainText('3')
  await expect(page.getByTestId('tx-row')).toHaveCount(3)
  expect(f.txRows()).toHaveLength(0)
  await page.screenshot({ path: 'test-results/main-dark.png' })

  await goOnline(context, f)
  await expect(pill(page)).toHaveText(/Synced/)
  expect(f.txRows()).toHaveLength(3)

  await page.reload()
  await expect(page.getByTestId('tx-row')).toHaveCount(3)
  await expect(pill(page)).toContainText('Synced')
  expect(f.txRows()).toHaveLength(3)
  expect(csp).toEqual([])
})

test('offline edit and delete reach the sheet', async ({ page, context }) => {
  const f = await fakeBridge(context)
  await page.goto('/')
  await configure(page)
  await addEntry(page, '100')
  await addEntry(page, '200')
  await addEntry(page, '300')
  await expect.poll(() => f.txRows().length).toBe(3)
  await expect(pill(page)).toContainText('Synced')

  await goOffline(context, f)
  await page.getByTestId('tx-row').filter({ hasText: '100' }).click()
  await page.getByTestId('tx-details').getByLabel(/Amount/).fill('777')
  await page.getByTestId('tx-details').getByRole('button', { name: 'Save' }).click()
  await page.getByTestId('tx-row').filter({ hasText: '200' }).click()
  await page.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Yes, delete' }).click()
  await expect(page.getByTestId('tx-row')).toHaveCount(2)
  await expect(pill(page)).toContainText('2')

  await goOnline(context, f)
  await expect(pill(page)).toContainText('Synced')
  const rows = f.txRows()
  expect(rows).toHaveLength(3)
  const amounts = rows.map((r) => ({ amount: r[4], deleted: r[8] === true || r[8] === 'TRUE' }))
  expect(amounts).toContainEqual({ amount: -777, deleted: false })
  expect(amounts).toContainEqual({ amount: -200, deleted: true })
  expect(amounts).toContainEqual({ amount: -300, deleted: false })
})

test('cold start offline with empty storage still records', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect(page.getByTestId('month-card')).toBeVisible()
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByText('Never synced').or(pill(page))).toBeVisible()
  await addEntry(page, '50')
  await expect(page.getByTestId('tx-row')).toHaveCount(1)
  await expect(pill(page)).toContainText('1')
})

test('entry sheet screenshot', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Add entry' }).click()
  const keys = page.getByRole('group', { name: 'Keypad' })
  for (const d of '1250') await keys.getByRole('button', { name: d, exact: true }).click()
  await expect(page.getByLabel('Amount 1 250 hryvnias')).toBeVisible()
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'test-results/entry-sheet.png' })
})
