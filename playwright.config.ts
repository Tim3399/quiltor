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
  timeout: 30_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8000",
    // Wie in playwright.design.config.ts, und aus demselben Grund: ein Datumsfeld zeichnet
    // sein Format nach der Sprache des Rechners. Der Zeitstreifen zeigte auf dem Windows-Runner
    // "mm/dd/yyyy", auf meinem Rechner "dd.mm.yyyy" -- 136 Pixel Unterschied im selben
    // Baseline-Bild derselben Plattform. Eine Referenz, die von der Regionaleinstellung des
    // Rechners abhaengt, vergleicht nicht die Anwendung.
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "wide", use: { ...devices["Desktop Chrome"], viewport: baselineViewports.wide } },
    { name: "regular", use: { ...devices["Desktop Chrome"], viewport: baselineViewports.regular } },
    { name: "compact", use: { ...devices["Desktop Chrome"], viewport: baselineViewports.compact } },
  ],
});
