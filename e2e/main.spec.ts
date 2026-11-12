import { expect, test } from '@playwright/test'

test('main screen shows month card and empty state', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('month-card')).toBeVisible()
  await expect(page.getByText('INCOME', { exact: true })).toBeVisible()
  await expect(page.getByText('EXPENSES', { exact: true })).toBeVisible()
  await expect(page.getByText('BALANCE', { exact: true })).toBeVisible()
  await expect(page.getByTestId('empty')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add entry' })).toBeVisible()
})

test('month navigation changes the label', async ({ page }) => {
  await page.goto('/')
  const name = page.getByTestId('month-name')
  const year = page.getByTestId('month-year')
  const before = [await name.textContent(), await year.textContent()].join(' ')
  await page.getByRole('button', { name: 'Previous month' }).click()
  await expect(async () => {
    expect([await name.textContent(), await year.textContent()].join(' ')).not.toBe(before)
  }).toPass()
  await page.getByRole('button', { name: 'Next month' }).click()
  await expect(async () => {
    expect([await name.textContent(), await year.textContent()].join(' ')).toBe(before)
  }).toPass()
})

test('add, open details, edit and delete an entry', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Add entry' }).click()
  await page.getByLabel('Amount').fill('420')
  await page.getByRole('button', { name: 'Save' }).click()
  const row = page.getByTestId('tx-row')
  await expect(row).toHaveCount(1)
  await expect(page.getByTestId('expense')).toHaveText('420')
  await expect(page.getByTestId('balance')).toHaveText('-420')
  await row.click()
  await page.getByTestId('tx-details').getByLabel(/Amount/).fill('500')
  await page.getByTestId('tx-details').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('expense')).toHaveText('500')
  await row.click()
  await page.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Yes, delete' }).click()
  await expect(page.getByTestId('empty')).toBeVisible()
})
