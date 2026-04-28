import { defineConfig, devices } from '@playwright/test';

// Playwright scaffold — roadmap §11.1 targets 50+ E2E specs.
// Install browsers once: `npx playwright install --with-deps chromium`
// Run:                   `npx playwright test`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
      testMatch: /(mobile|button-sweep)\.spec\.ts/,
    },
    // mobile-safari uses WebKit, which needs system libs (libevent, gstreamer,
    // libavif, etc.) that this sandbox can't apt-install without sudo.
    // Opt in once those are installed by setting PLAYWRIGHT_ENABLE_WEBKIT=1.
    ...(process.env.PLAYWRIGHT_ENABLE_WEBKIT
      ? [{
          name: 'mobile-safari',
          use: { ...devices['iPhone 13'] },
          testMatch: /mobile\.spec\.ts/,
        }]
      : []),
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
