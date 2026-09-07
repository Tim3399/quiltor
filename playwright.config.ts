import { defineConfig, devices } from "@playwright/test";
import { resolvePlaywrightWorkers } from "./tests/playwright/workers";

export const baselineViewports = {
  wide: { width: 1440, height: 900 },
  regular: { width: 900, height: 760 },
  compact: { width: 390, height: 844 },
} as const;

export default defineConfig({
  testDir: "./tests/e2e",
  // Two isolated browser contexts keep local/release runs moving without overwhelming the
  // shared application server. CI shards override this to one worker per runner.
  workers: resolvePlaywrightWorkers(2),
  // On the Windows runner, creating and opening a world took longer than thirty seconds
  // twice; file locks bite there where Linux merely writes -- the same corner the backend's
  // undeletable temp directory came from. The larger value is a buffer, not an explanation:
  // a test that really hangs still fails, only later. Locally it stays at thirty seconds, so
  // that a test which has grown slow is noticed here.
  timeout: process.env.CI ? 60_000 : 30_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8000",
    // As in playwright.design.config.ts, and for the same reason: a date field draws its
    // format from the machine's language. The timeline strip showed "mm/dd/yyyy" on the
    // Windows runner and "dd.mm.yyyy" on this desk -- 136 pixels of difference in the same
    // baseline image of the same platform. A reference that depends on a machine's regional
    // settings is not comparing the application.
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    launchOptions: {
      // And one layer deeper: Chromium draws a date field's placeholder from the language
      // of its own interface, not from `locale`. With `locale` alone the runner still
      // showed "mm/dd/yyyy" in the timeline strip and this desk "dd.mm.yyyy" -- always the
      // same 136 pixels of difference in the same image.
      args: ["--lang=de-DE"],
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "wide", use: { ...devices["Desktop Chrome"], viewport: baselineViewports.wide } },
    { name: "regular", use: { ...devices["Desktop Chrome"], viewport: baselineViewports.regular } },
    { name: "compact", use: { ...devices["Desktop Chrome"], viewport: baselineViewports.compact } },
  ],
});
