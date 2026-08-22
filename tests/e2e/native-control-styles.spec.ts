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

async function mockWorldWithStoryWorldUiAudit(page: Page) {
  const world = {
    id: "story-world-ui-audit",
    title: "Story-World-Audit",
    backupUrl: "",
    updated: "2026-08-22T12:00:00Z",
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
          nodes: [
            {
              id: "figure-ada",
              name: "Ada mit einem absichtlich langen Namen",
              type: "person",
              x: 120,
              y: 120,
            },
            {
              id: "place-harbour",
              name: "Hafen der sehr langen Nordküste",
              type: "ort",
              x: 420,
              y: 160,
            },
            {
              id: "figure-borin",
              name: "Borin",
              type: "person",
              x: 260,
              y: 360,
            },
          ],
          edges: [
            {
              id: "edge-ada-borin",
              from: "figure-ada",
              to: "figure-borin",
              label: "Verbündet",
              style: "solid",
            },
          ],
          timeline: Array.from({ length: 14 }, (_, index) => ({
            id: `moment-${index + 1}`,
            title: `Zeitpunkt ${index + 1} mit langem Titel`,
            time: index,
            position: index,
          })),
          presence: [
            {
              id: "presence-ada-harbour",
              elementId: "figure-ada",
              placeId: "place-harbour",
            },
          ],
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

test("Figuren verwenden für alle sichtbaren Dropdowns Quiltor-Controls", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Computed Styles und Popup-Struktur müssen nur in Chromium geprüft werden.",
  );
  await mockWorldWithStoryWorldUiAudit(page);
  await page.goto("/?world=story-world-ui-audit");
  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  await page
    .locator(".figure-workspace .react-flow__node")
    .filter({ hasText: "Ada mit einem absichtlich langen Namen" })
    .click();

  const inspector = page.locator(".figure-inspector.has-selection");
  await expect(inspector).toBeVisible();
  await expect(inspector.locator("select:visible")).toHaveCount(0);
  const dropdowns = inspector.getByRole("combobox");
  await expect(dropdowns).toHaveCount(3);
  for (const dropdown of await dropdowns.all()) {
    await expect(dropdown).toHaveJSProperty("tagName", "BUTTON");
  }

  const placeDropdown = inspector.getByRole("combobox", { name: "Ort (Ausgangslage)" });
  await placeDropdown.click();
  await expect(page.getByRole("listbox", { name: "Ort (Ausgangslage)" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Hafen der sehr langen Nordküste" })).toBeVisible();

  await page.keyboard.press("Escape");
  await inspector.getByRole("tab", { name: "Beziehungen" }).click();
  await expect(inspector.locator("select:visible")).toHaveCount(0);
  const lineStyle = inspector.getByRole("combobox", { name: "Linienstil" });
  await expect(lineStyle).toHaveJSProperty("tagName", "BUTTON");
  await lineStyle.click();
  await expect(page.getByRole("listbox", { name: "Linienstil" })).toBeVisible();
  await page.keyboard.press("Escape");

  const figureTimeline = page.locator(".figure-workspace .timeline-track");
  await expect(figureTimeline).toBeVisible();
  await expect
    .poll(() => figureTimeline.evaluate((element) => element.scrollWidth > element.clientWidth + 1))
    .toBe(true);
  await expectVisibleScrollbarsToUseQuiltorTheme(figureTimeline);
});

test("Timeline gestaltet den tatsächlich sichtbaren horizontalen Scroller", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Computed Scrollbar-Styles müssen nur in Chromium geprüft werden.",
  );
  await mockWorldWithStoryWorldUiAudit(page);
  await page.goto("/?world=story-world-ui-audit");
  await page.getByRole("button", { name: "Timeline", exact: true }).click();

  const timeline = page.locator(".story-timeline");
  await expect(timeline).toBeVisible();
  await expect
    .poll(() => timeline.evaluate((element) => element.scrollWidth > element.clientWidth + 1))
    .toBe(true);
  await expectVisibleScrollbarsToUseQuiltorTheme(timeline);
});

test("Orte-Historie hält Überschriften und lange Inhalte innerhalb ihrer Karten", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Layout-Geometrie muss nur einmal im breiten Chromium-Projekt geprüft werden.",
  );
  await mockWorldWithStoryWorldUiAudit(page);
  await page.goto("/?world=story-world-ui-audit");
  await page.getByRole("button", { name: "Orte", exact: true }).click();
  await page
    .locator(".places-workspace .react-flow__node")
    .filter({ hasText: "Hafen der sehr langen Nordküste" })
    .click();

  const sections = page.locator(".places-manager-section");
  await expect(sections).toHaveCount(2);
  const layout = await sections.evaluateAll((elements) =>
    elements.map((element) => {
      const section = element as HTMLElement;
      const summary = section.querySelector("summary") as HTMLElement | null;
      const heading = summary?.querySelector(".places-section-heading") as HTMLElement | null;
      const sectionBox = section.getBoundingClientRect();
      const headingBox = heading?.getBoundingClientRect();
      const headingStyle = heading ? getComputedStyle(heading) : null;
      return {
        hasSummary: !!summary && !!heading,
        padded: Number.parseFloat(headingStyle?.paddingInlineStart || "0") > 0,
        contained:
          !!headingBox &&
          headingBox.left >= sectionBox.left - 0.5 &&
          headingBox.right <= sectionBox.right + 0.5,
        noHorizontalOverflow: section.scrollWidth <= section.clientWidth + 1,
      };
    }),
  );
  expect(layout).toEqual([
    { hasSummary: true, padded: true, contained: true, noHorizontalOverflow: true },
    { hasSummary: true, padded: true, contained: true, noHorizontalOverflow: true },
  ]);
  await expect(sections.nth(0).getByRole("heading", { name: "Wer war hier" })).toBeVisible();
  await expect(sections.nth(1).getByRole("heading", { name: "Chronik" })).toBeVisible();
});
