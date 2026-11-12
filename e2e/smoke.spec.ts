import { expect, test } from '@playwright/test'

test('page loads and shows YOU SPENT', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('YOU SPENT', { exact: true })).toBeVisible()
})
