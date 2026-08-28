import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  fulfillDocumentSave,
  fulfillManuscript,
  fulfillStoryWorld,
} from "./support/application-api";
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

async function expectCalendarEditorActionsAligned(settings: Locator, minimumSize: number) {
  const geometry = await settings.locator(".timeline-calendar-structure").evaluate((calendar) => {
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        centerY: rect.y + rect.height / 2,
      };
    };
    const addRows = [...calendar.querySelectorAll<HTMLElement>(".timeline-calendar-add-row")].map(
      (row) => {
        const count = row.querySelector("input");
        const action = row.querySelector(".calendar-definition-add");
        if (!count || !action) throw new Error("Kalender-Add-Zeile ist unvollständig");
        return { count: box(count), action: box(action) };
      },
    );
    const itemRows = [...calendar.querySelectorAll<HTMLElement>(".timeline-calendar-item")].map(
      (row) => {
        const fields = [...row.querySelectorAll("input")].map(box);
        const action = row.querySelector(".calendar-definition-remove");
        if (!fields.length || !action)
          throw new Error("Kalender-Definitionszeile ist unvollständig");
        return { fields, action: box(action) };
      },
    );
    return { addRows, itemRows };
  });

  expect(geometry.addRows).toHaveLength(2);
  expect(geometry.itemRows.length).toBeGreaterThan(1);
  for (const { count, action } of geometry.addRows) {
    expect(action.height).toBeGreaterThanOrEqual(minimumSize - 0.5);
    expect(Math.abs(action.height - count.height)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(action.centerY - count.centerY)).toBeLessThanOrEqual(0.5);
  }
  for (const { fields, action } of geometry.itemRows) {
    expect(action.width).toBeGreaterThanOrEqual(minimumSize - 0.5);
    expect(Math.abs(action.width - action.height)).toBeLessThanOrEqual(0.5);
    for (const field of fields) {
      expect(Math.abs(action.centerY - field.centerY)).toBeLessThanOrEqual(0.5);
    }
  }
}

test("lange Kalenderkonfiguration bleibt responsiv und scrollt ausschließlich vertikal", async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === "compact") {
    await page.setViewportSize({ width: 457, height: 694 });
  }
  await mockWorldWithLongCustomCalendar(page);
  await page.goto("/?world=native-control-audit");
  await page.getByRole("button", { name: "Timeline", exact: true }).click();

  const addCalendar = page.getByRole("button", { name: "Kalender hinzufügen", exact: true });
  const settingsTrigger = page.getByRole("button", {
    name: "Zeitsystem konfigurieren",
    exact: true,
  });
  const minimumControlSize = testInfo.project.name === "compact" ? 44 : 36;
  const toolbarControlGeometry = await Promise.all(
    [
      page.getByRole("combobox", { name: "Zeitsystem", exact: true }),
      addCalendar,
      settingsTrigger,
    ].map((control) =>
      control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }),
    ),
  );
  for (const control of toolbarControlGeometry) {
    expect(control.height).toBeGreaterThanOrEqual(minimumControlSize - 0.5);
  }
  expect(Math.max(...toolbarControlGeometry.map(({ height }) => height))).toBeLessThanOrEqual(
    Math.min(...toolbarControlGeometry.map(({ height }) => height)) + 0.5,
  );
  if (testInfo.project.name === "compact") {
    for (const action of [addCalendar, settingsTrigger]) {
      await expect(action.locator(".ui-button__label")).toHaveCSS("display", "none");
      const centers = await action.evaluate((button) => {
        const icon = button.querySelector(".ui-button__icon");
        if (!icon) return null;
        const buttonBox = button.getBoundingClientRect();
        const iconBox = icon.getBoundingClientRect();
        return {
          button: buttonBox.x + buttonBox.width / 2,
          icon: iconBox.x + iconBox.width / 2,
        };
      });
      expect(centers).not.toBeNull();
      expect(Math.abs((centers?.button ?? 0) - (centers?.icon ?? 0))).toBeLessThanOrEqual(0.5);
    }
  }

  await addCalendar.click();
  const settings = page.getByRole("dialog", {
    name: "Zeitsystem konfigurieren",
    exact: true,
  });
  const panel = settings.locator(".timeline-time-settings-panel");
  await expect(settings).toBeVisible();
  await expect(panel).toBeVisible();
  await expectCalendarEditorActionsAligned(settings, minimumControlSize);
  await expect
    .poll(() => panel.evaluate((element) => element.scrollHeight > element.clientHeight + 1))
    .toBe(true);

  const verticalScrollOwners = await Promise.all(
    (
      [
        ["Dialog", settings],
        ["Inhalt", panel],
      ] as const
    ).map(async ([label, surface]) => {
      const geometry = await surface.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          client: element.clientHeight,
          scroll: element.scrollHeight,
          overflow: style.overflowY,
        };
      });
      return { label, ...geometry };
    }),
  );
  expect(verticalScrollOwners).toEqual([
    expect.objectContaining({ label: "Dialog", overflow: "clip" }),
    expect.objectContaining({ label: "Inhalt", overflow: "auto" }),
  ]);
  expect(
    verticalScrollOwners[0].scroll,
    "Dialog besitzt einen zweiten vertikalen Scrollweg",
  ).toBeLessThanOrEqual(verticalScrollOwners[0].client + 1);
  expect(
    verticalScrollOwners[1].scroll,
    "Inhalt ist nicht der alleinige vertikale Scroll-Owner",
  ).toBeGreaterThan(verticalScrollOwners[1].client + 1);

  for (const [label, surface] of [
    ["Dialog", settings],
    ["Inhalt", panel],
  ] as const) {
    const width = await surface.evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }));
    expect(width.scroll, `${label} besitzt horizontalen Overflow`).toBeLessThanOrEqual(
      width.client + 1,
    );
  }

  const dialogBox = await settings.boundingBox();
  const viewport = page.viewportSize();
  expect(dialogBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (dialogBox && viewport) {
    expect(dialogBox.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(viewport.width + 1);
  }

  await expectVisibleNativeControlsToUseQuiltorTheme(panel);
  await expectVisibleScrollbarsToUseQuiltorTheme(panel);

  if (testInfo.project.name === "compact") {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(settings).toBeVisible();
    const smallestViewportGeometry = await settings.evaluate((dialog) => {
      const content = dialog.querySelector<HTMLElement>(".timeline-time-settings-panel");
      if (!content) throw new Error("Kalenderinhalt fehlt");
      const dialogBox = dialog.getBoundingClientRect();
      return {
        dialogClientHeight: dialog.clientHeight,
        dialogScrollHeight: dialog.scrollHeight,
        dialogClientWidth: dialog.clientWidth,
        dialogScrollWidth: dialog.scrollWidth,
        dialogOverflowY: getComputedStyle(dialog).overflowY,
        contentClientHeight: content.clientHeight,
        contentScrollHeight: content.scrollHeight,
        contentClientWidth: content.clientWidth,
        contentScrollWidth: content.scrollWidth,
        contentOverflowY: getComputedStyle(content).overflowY,
        left: dialogBox.left,
        right: dialogBox.right,
      };
    });
    expect(smallestViewportGeometry).toMatchObject({
      dialogOverflowY: "clip",
      contentOverflowY: "auto",
    });
    expect(smallestViewportGeometry.dialogScrollHeight).toBeLessThanOrEqual(
      smallestViewportGeometry.dialogClientHeight + 1,
    );
    expect(smallestViewportGeometry.contentScrollHeight).toBeGreaterThan(
      smallestViewportGeometry.contentClientHeight + 1,
    );
    expect(smallestViewportGeometry.dialogScrollWidth).toBeLessThanOrEqual(
      smallestViewportGeometry.dialogClientWidth + 1,
    );
    expect(smallestViewportGeometry.contentScrollWidth).toBeLessThanOrEqual(
      smallestViewportGeometry.contentClientWidth + 1,
    );
    expect(smallestViewportGeometry.left).toBeGreaterThanOrEqual(0);
    expect(smallestViewportGeometry.right).toBeLessThanOrEqual(391);
  }
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
  const relationshipTab = inspector.getByRole("tab", { name: "Beziehungen" });
  const relationshipTabGeometry = await relationshipTab.evaluate((tab) => ({
    clientWidth: tab.clientWidth,
    scrollWidth: tab.scrollWidth,
  }));
  expect
    .soft(relationshipTabGeometry.scrollWidth)
    .toBeLessThanOrEqual(relationshipTabGeometry.clientWidth + 1);

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
  await inspector.getByRole("tab", { name: "Steckbrief" }).click();
  const profileHeadingGeometry = await inspector
    .locator(".figure-profile-fields-heading")
    .evaluate((heading) => {
      const copy = heading.firstElementChild;
      const trigger = heading.querySelector(".figure-profile-field-add");
      if (!(copy instanceof HTMLElement) || !(trigger instanceof HTMLElement)) {
        throw new Error("Steckbrief-Überschrift oder Feldaktion fehlt");
      }
      const box = heading.getBoundingClientRect();
      const copyBox = copy.getBoundingClientRect();
      const triggerBox = trigger.getBoundingClientRect();
      return {
        noHorizontalOverflow: heading.scrollWidth <= heading.clientWidth + 1,
        copyContained: copyBox.left >= box.left - 0.5 && copyBox.right <= box.right + 0.5,
        triggerContained: triggerBox.left >= box.left - 0.5 && triggerBox.right <= box.right + 0.5,
        separated: triggerBox.left - copyBox.right >= 4 || triggerBox.top - copyBox.bottom >= 4,
      };
    });
  expect.soft(profileHeadingGeometry).toEqual({
    noHorizontalOverflow: true,
    copyContained: true,
    triggerContained: true,
    separated: true,
  });

  await inspector.getByRole("button", { name: "Feld hinzufügen" }).click();
  const recommendedFieldsHeader = page
    .locator(".ui-dropdown-menu__header")
    .filter({ hasText: "Empfohlene Felder" });
  await expect(recommendedFieldsHeader).toBeVisible();
  const recommendedFieldsGeometry = await recommendedFieldsHeader.evaluate((header) => {
    const surface = header.closest(".ui-dropdown-menu__surface");
    if (!(surface instanceof HTMLElement)) {
      throw new Error("Empfohlene Felder liegen nicht in der Dropdown-Oberfläche");
    }
    const style = getComputedStyle(header);
    const box = header.getBoundingClientRect();
    const surfaceBox = surface.getBoundingClientRect();
    return {
      paddingInlineStart: Number.parseFloat(style.paddingInlineStart),
      paddingInlineEnd: Number.parseFloat(style.paddingInlineEnd),
      paddingBlockStart: Number.parseFloat(style.paddingBlockStart),
      paddingBlockEnd: Number.parseFloat(style.paddingBlockEnd),
      contained: box.left >= surfaceBox.left - 0.5 && box.right <= surfaceBox.right + 0.5,
      noHorizontalOverflow:
        header.scrollWidth <= header.clientWidth + 1 &&
        surface.scrollWidth <= surface.clientWidth + 1,
    };
  });
  expect.soft(recommendedFieldsGeometry.paddingInlineStart).toBeGreaterThan(0);
  expect.soft(recommendedFieldsGeometry.paddingInlineEnd).toBeGreaterThan(0);
  expect.soft(recommendedFieldsGeometry.paddingBlockStart).toBeGreaterThan(0);
  expect.soft(recommendedFieldsGeometry.paddingBlockEnd).toBeGreaterThan(0);
  expect.soft(recommendedFieldsGeometry.contained).toBe(true);
  expect.soft(recommendedFieldsGeometry.noHorizontalOverflow).toBe(true);

  await page.keyboard.press("Escape");
  await relationshipTab.click();
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
