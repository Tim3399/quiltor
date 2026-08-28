import { defineConfig, devices } from "@playwright/test";
import { resolvePlaywrightWorkers } from "./tests/playwright/workers";

export default defineConfig({
  testDir: "./tests/design",
  fullyParallel: true,
  // Accessibility/layout audits are split into deterministic, bounded story chunks. Keeping
  // concurrency bounded protects the local Vite server and Chromium while each chunk gets an
  // independent CI result instead of sharing one catalog-wide timeout.
  // The gallery is read-only and every story runs in an isolated browser context, so four local
  // workers cut the dominant audit block substantially. CI shards stay conservative at two.
  workers: resolvePlaywrightWorkers(4),
  timeout: 45_000,
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
