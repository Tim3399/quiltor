import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/design",
  fullyParallel: true,
  // Each accessibility test intentionally walks the complete story catalog. Keeping the
  // concurrency bounded prevents the local Vite server and Chromium from exhausting Windows
  // sockets while still running viewport projects in parallel.
  workers: 2,
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:4174",
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "design-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1100, height: 800 } },
    },
    {
      name: "design-intermediate",
      use: { ...devices["Desktop Chrome"], viewport: { width: 820, height: 800 } },
    },
    {
      name: "design-compact-boundary",
      use: { ...devices["Desktop Chrome"], viewport: { width: 719, height: 800 } },
    },
    {
      name: "design-touch",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "node ./node_modules/vite/bin/vite.js --config vite.design.config.ts",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
