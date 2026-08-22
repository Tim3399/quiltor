import { expect, type Page, test } from "@playwright/test";
import {
  expectVisibleNativeControlsToUseQuiltorTheme,
  expectVisibleScrollbarsToUseQuiltorTheme,
} from "./support/native-control-audit";
import {
  fulfillDocumentSave,
  fulfillManuscript,
  fulfillStoryWorld,
} from "./support/application-api";

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
      ? fulfillManuscript(route, {
          chapters: [{ id: "c1", title: "Test", body: "", note: "" }],
          words: [],
          zeichenAktiv: [],
        })
      : fulfillDocumentSave(route, 1),
  );
  await page.route("**/api/state*", (route) =>
    route.request().method() === "GET"
      ? fulfillStoryWorld(route, {
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
        })
      : fulfillDocumentSave(route, 1),
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

test("Zeitsystem-Auswahl besitzt auch geöffnet ein Quiltor-Popup", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Popup-Stile und Tastatursteuerung müssen nur einmal in Chromium geprüft werden.",
  );
  await mockWorldWithLongCustomCalendar(page);
  await page.goto("/?world=native-control-audit");
  await page.getByRole("button", { name: "Timeline", exact: true }).click();

  const control = page.getByRole("combobox", { name: "Zeitsystem" });
  await expect(control).toHaveJSProperty("tagName", "BUTTON");
  await control.click();

  const listbox = page.getByRole("listbox", { name: "Zeitsystem" });
  await expect(listbox).toBeVisible();
  const popupStyle = await listbox.evaluate((element) => {
    const panel = element.closest(".material-popover");
    if (!panel) return null;
    const style = getComputedStyle(panel);
    const probe = document.createElement("div");
    document.body.append(probe);
    const transparent = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      hasOpaqueBackground: style.backgroundColor !== transparent,
      border: style.borderTopStyle,
      radius: Number.parseFloat(style.borderTopLeftRadius),
      shadow: style.boxShadow,
    };
  });
  expect(popupStyle).not.toBeNull();
  expect(popupStyle?.hasOpaqueBackground).toBe(true);
  expect(popupStyle?.border).not.toBe("none");
  expect(popupStyle?.radius).toBeGreaterThan(0);
  expect(popupStyle?.shadow).not.toBe("none");

  await page.getByRole("option", { name: "Relativ" }).click();
  await expect(control).toHaveText(/Relativ/);
  await control.press("ArrowDown");
  await expect(page.getByRole("option", { name: "Relativ" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: "Gregorianisch" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(listbox).toBeHidden();
  await expect(control).toBeFocused();
});
