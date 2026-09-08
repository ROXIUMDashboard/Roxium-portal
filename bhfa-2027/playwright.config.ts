import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3210);
export const E2E_TOKEN = 'e2e_token_e2e_token_e2e_token_e2e_token_e2e';

/**
 * The end-to-end suite runs the real application against the in-process
 * driver, so the whole collaboration workflow can be verified with no
 * database credentials.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    // Always a fresh process: the in-memory driver reseeds on boot, so each
    // run starts from the pristine 2027 draft.
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      PROGRAM_DATA_DRIVER: 'memory',
      SEED_COLLAB_TOKEN: E2E_TOKEN,
      COLLAB_TOKEN_PEPPER: 'e2e-pepper',
    },
  },
});
