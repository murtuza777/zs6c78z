import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against FastAPI serving the production build (same shape as the Docker
// image), so they exercise the real API, the real snapshot and SPA routing together.
// Prerequisites: `npm run build` and the backend environment (`uv sync` in ../backend).
const PORT = Number(process.env.E2E_PORT ?? 4173);
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'dist');

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // One uvicorn process serves every worker; keep concurrency modest so timings stay realistic.
  workers: process.env.CI ? 2 : 3,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Uses the locally installed Google Chrome; no browser download required.
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
      grepInvert: /@mobile/,
    },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: 'chrome' }, grep: /@mobile/ },
  ],
  webServer: {
    command: `uv run --project ../backend uvicorn app.main:app --app-dir ../backend --host 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/v1/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      WINDDESK_FRONTEND_DIST: dist,
      WINDDESK_LOG_LEVEL: 'WARNING',
    },
  },
});
