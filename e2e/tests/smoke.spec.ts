import { expect, test } from '@playwright/test';

test.describe('smoke', () => {
  test('home renders its heading and links to every screen', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'STEMDECK' })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Screens' });
    for (const name of ['Solo', 'Puzzle', 'Host a room', 'Join a room', 'Settings', 'Audio lab']) {
      await expect(nav.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
    }
  });

  test('home has no horizontal scroll at 360×640', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'STEMDECK' })).toBeVisible();
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(clientWidth).toBe(360);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test('a placeholder route loads through the lazy router', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /^Audio lab/ }).click();
    await expect(page).toHaveURL(/\/lab$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Audio lab' })).toBeVisible();
  });
});
