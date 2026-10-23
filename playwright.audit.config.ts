import { defineConfig, devices } from "@playwright/test";
import { AUDIT_THEMES, AUDIT_VIEWPORTS, type ViewportName } from "./tests/audit/support/types";

// Layout audit (T-1). Kept apart from playwright.config.ts and playwright.design.config.ts so
// neither of those lists an audit test. Scaffold version: part A owns this file and extends
// it; the "rules" project is part B's and must keep matching rules.spec.ts only.

const viewportNames = Object.keys(AUDIT_VIEWPORTS) as ViewportName[];

export default defineConfig({
  testDir: "./tests/audit",
  outputDir: "test-results/layout-audit/.playwright",
  fullyParallel: true,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8010",
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    launchOptions: { args: ["--lang=de-DE"] },
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
