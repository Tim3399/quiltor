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
  // Auf dem Windows-Runner hat das Anlegen und Oeffnen einer Welt zweimal laenger als
  // dreissig Sekunden gebraucht; dort greifen Dateisperren, wo Linux nur schreibt -- dieselbe
  // Ecke, aus der im Backend ein nicht raeumbares Temp-Verzeichnis kam. Der groessere Wert ist
  // ein Puffer, keine Erklaerung: ein wirklich haengender Test faellt weiterhin, nur spaeter.
  // Lokal bleibt es bei dreissig Sekunden, damit ein langsam gewordener Test hier auffaellt.
  timeout: process.env.CI ? 60_000 : 30_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8000",
    // Wie in playwright.design.config.ts, und aus demselben Grund: ein Datumsfeld zeichnet
    // sein Format nach der Sprache des Rechners. Der Zeitstreifen zeigte auf dem Windows-Runner
    // "mm/dd/yyyy", auf meinem Rechner "dd.mm.yyyy" -- 136 Pixel Unterschied im selben
    // Baseline-Bild derselben Plattform. Eine Referenz, die von der Regionaleinstellung des
    // Rechners abhaengt, vergleicht nicht die Anwendung.
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    launchOptions: {
      // Und noch eine Ebene tiefer: den Platzhalter eines Datumsfelds zeichnet Chromium nicht
      // nach `locale`, sondern nach der Sprache seiner eigenen Oberflaeche. Mit `locale`
      // allein stand im Zeitstreifen auf dem Runner weiterhin "mm/dd/yyyy" und hier
      // "dd.mm.yyyy" -- immer dieselben 136 Pixel Unterschied im selben Bild.
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
