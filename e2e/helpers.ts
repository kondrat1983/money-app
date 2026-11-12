import { expect, type Page } from '@playwright/test'

export async function addEntry(page: Page, digits: string, shot?: string) {
  await page.getByRole('button', { name: 'Add entry' }).click()
  const keys = page.getByRole('group', { name: 'Keypad' })
  for (const d of digits) await keys.getByRole('button', { name: d, exact: true }).click()
  await page.getByRole('group', { name: 'Category' }).getByRole('button').first().click()
  // The YOU SPENT card: dismiss by tapping it.
  const card = page.locator('.sig')
  await expect(card).toBeVisible()
  if (shot) await page.screenshot({ path: shot })
  await card.click()
  await expect(card).toHaveCount(0)
}

