import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);
const port = 5173;

/**
 * Locally (cloud sessions) the browser is pre-installed and `playwright install` must not run.
 * If this Playwright version cannot find its browser, point PLAYWRIGHT_CHROMIUM_PATH at the
 * Chromium executable (see docs/TESTING.md).
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : 1,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'off',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], launchOptions },
    },
    {
      name: 'mobile-360',
      use: {
        browserName: 'chromium',
        viewport: { width: 360, height: 640 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        launchOptions,
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @stemdeck/web dev',
      url: `http://localhost:${port}`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // Rooms spike (0D): the local room server (`wrangler dev`, no account, no network).
      command: 'pnpm --filter @stemdeck/rooms dev',
      url: 'http://localhost:8787/health',
      reuseExistingServer: !isCI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
