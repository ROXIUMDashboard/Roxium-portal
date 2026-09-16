// Playwright — browser-level tests for the ROXIUM portal.
//
// Two suites:
//   tests/e2e/*.spec.js          run anywhere, no secrets. They build the static
//                                bundle and serve it through scripts/serve-local.mjs,
//                                which reproduces the Cloudflare _redirects contract.
//   tests/e2e/staging/*.spec.js  require a real seeded staging environment and SKIP
//                                themselves when STAGING_BASE_URL is absent, so CI
//                                stays green until staging exists.
const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.E2E_PORT || 8788);
const BASE = process.env.E2E_BASE_URL || `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /responsive\.spec\.js/ },
  ],
  // Build a STAGING-stamped bundle and serve it locally. Staging is the right
  // stamp for a local harness: it must never be a production build.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `ROXIUM_ENV=staging bash scripts/prepare-pages.sh && node scripts/serve-local.mjs --dir site --port ${PORT}`,
        url: `http://127.0.0.1:${PORT}/version.json`,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
