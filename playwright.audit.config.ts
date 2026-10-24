import { cpus } from "node:os";
import { defineConfig, devices } from "@playwright/test";
import { AUDIT_THEMES, AUDIT_VIEWPORTS, type ViewportName } from "./tests/audit/support/types";

// Layout audit (T-1). Kept apart from playwright.config.ts and playwright.design.config.ts so
// neither of those lists an audit test. The "rules" project is part B's and must keep matching
// rules.spec.ts only; the capture projects run one per viewport x theme, every scenario of
// capture.spec.ts is its own test, and the global teardown merges their partial manifests.

const viewportNames = Object.keys(AUDIT_VIEWPORTS) as ViewportName[];

// All data comes from route mocks, so the server only serves dist/ and parallel workers do not
// contend for worlds. Half the cores keeps screenshots and analysis from starving each other.
const workers = Number(process.env.QUILTOR_AUDIT_WORKERS) || Math.max(2, Math.floor(cpus().length / 2));

export default defineConfig({
  testDir: "./tests/audit",
  outputDir: "test-results/layout-audit/.playwright",
  fullyParallel: true,
  workers,
  // A scenario opens dozens of popups; the budget is per scenario, not per popup.
  timeout: 10 * 60_000,
  expect: { timeout: 10_000 },
  globalSetup: "./tests/audit/support/global-setup.ts",
  globalTeardown: "./tests/audit/support/global-teardown.ts",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8010",
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    launchOptions: { args: ["--lang=de-DE"] },
    actionTimeout: 10_000,
  },
  projects: [
    {
      name: "rules",
      testMatch: /rules\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    ...viewportNames.flatMap((viewport) =>
      AUDIT_THEMES.map((theme) => {
        const spec = AUDIT_VIEWPORTS[viewport];
        return {
          name: `capture-${viewport}-${theme}`,
          testMatch: /capture\.spec\.ts$/,
          metadata: { viewport, theme },
          use: {
            ...devices["Desktop Chrome"],
            viewport: { width: spec.width, height: spec.height },
            isMobile: viewport === "mobile",
            hasTouch: spec.touch,
            colorScheme: theme,
          },
        };
      }),
    ),
  ],
});
