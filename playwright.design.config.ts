import { defineConfig, devices } from "@playwright/test";
import { resolveDesignPort } from "./tools/dev/design-port.mjs";
import { resolvePlaywrightWorkers } from "./tests/playwright/workers";

const designPort = resolveDesignPort();
const designUrl = `http://127.0.0.1:${designPort}`;

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
    baseURL: designUrl,
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
    url: designUrl,
    // Never reuse: a server already on the port may be another worktree's gallery, which serves
    // that worktree's sources. Playwright then stops with "is already used" instead of running
    // the suite against foreign code. Pick a free port with QUILTOR_DESIGN_PORT.
    reuseExistingServer: false,
    env: { QUILTOR_DESIGN_PORT: String(designPort) },
    timeout: 30_000,
  },
});
