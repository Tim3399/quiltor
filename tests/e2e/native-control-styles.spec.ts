import { expect, type Page, test } from "@playwright/test";
import {
  expectVisibleNativeControlsToUseQuiltorTheme,
  expectVisibleScrollbarsToUseQuiltorTheme,
} from "./support/native-control-audit";

async function mockWorldWithLongCustomCalendar(page: Page) {
  const world = {
    id: "native-control-audit",
    title: "Kalender-Audit",
    backupUrl: "",
    updated: "2026-08-21T12:00:00Z",
  };
  await page.addInitScript(() => {
    localStorage.setItem("quiltor-interface-language", "de");
    localStorage.setItem("quiltor-theme", "light");
  });
  await page.route("**/api/version", (route) => route.fulfill({ json: { version: "test" } }));
  await page.route("**/api/whoami", (route) => route.fulfill({ json: { ok: false } }));
  await page.route("**/api/worlds", (route) =>
    route.fulfill({ json: { ok: true, worlds: [world] } }),
  );
  await page.route("**/api/worlds/open", (route) => route.fulfill({ json: { ok: true, world } }));
  await page.route("**/api/manuscript*", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: {
            chapters: [{ id: "c1", title: "Test", body: "", note: "" }],
            words: [],
            zeichenAktiv: [],
          },
          headers: { ETag: '"0"' },
        })
      : route.fulfill({ json: { ok: true, revision: 1 }, headers: { ETag: '"1"' } }),
  );
  await page.route("**/api/state*", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: {
            nodes: [],
            edges: [],
            timeline: [{ id: "m1", title: "Ankunft", time: 0, position: 0 }],
            presence: [],
            timeSystem: {
              id: "primary",
              name: "Langer eigener Kalender",
              kind: "custom",
              unit: "day",
              eraName: "Neue Zeit",
              eraAbbreviation: "NZ",
              epochTime: 0,
              epochYear: 1,
              epochMonth: 1,
              epochDay: 1,
              epochWeekday: 0,
              displayFormat: "",
              weekdays: Array.from({ length: 9 }, (_, index) => ({
                name: `Wochentag ${index + 1}`,
                shortName: `W${index + 1}`,
              })),
              months: Array.from({ length: 22 }, (_, index) => ({
                name: `Monat ${index + 1}`,
                shortName: `M${index + 1}`,
                dayCount: 30,
              })),
            },
          },
          headers: { ETag: '"0"' },
        })
      : route.fulfill({ json: { ok: true, revision: 1 }, headers: { ETag: '"1"' } }),
  );
}

test("geöffnete lange Kalenderkonfiguration gestaltet Scrollbars und native Controls", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Computed Styles müssen nur in Chromium geprüft werden.",
  );
  await mockWorldWithLongCustomCalendar(page);
  await page.goto("/?world=native-control-audit");
  await page.getByRole("button", { name: "Timeline", exact: true }).click();

  const settings = page.locator("details.timeline-time-settings");
  await settings.locator("summary").click();
  const panel = settings.locator(".timeline-time-settings-panel");
  await expect(panel).toBeVisible();
  await expect
    .poll(() => panel.evaluate((element) => element.scrollHeight > element.clientHeight + 1))
    .toBe(true);

  await expectVisibleNativeControlsToUseQuiltorTheme(panel);
  await expectVisibleScrollbarsToUseQuiltorTheme(panel);
});
