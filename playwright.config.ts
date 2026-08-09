import { defineConfig, devices } from '@playwright/test';

export const baselineViewports = {
  wide: { width: 1440, height: 900 },
  regular: { width: 900, height: 760 },
  compact: { width: 390, height: 844 },
} as const;

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 20_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'wide', use: { ...devices['Desktop Chrome'], viewport: baselineViewports.wide } },
    { name: 'regular', use: { ...devices['Desktop Chrome'], viewport: baselineViewports.regular } },
    { name: 'compact', use: { ...devices['Desktop Chrome'], viewport: baselineViewports.compact } },
  ],
});
