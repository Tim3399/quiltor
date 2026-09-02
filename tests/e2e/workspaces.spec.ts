import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import type { Manuscript } from "../../packages/client/src/modules/manuscript";
import {
  decodeSavedManuscript,
  encodeStoryWorldDocument,
  fulfillDocumentSave,
  fulfillManuscript,
  fulfillRevisionConflict,
  fulfillStoryWorld,
} from "./support/application-api";
import { clickVisibleGraphEdge } from "./support/graph-interaction";
import { createTestWorld, expect, test } from "./support/world-fixture";

async function openBlankWorld(page: Page, title = "Testwelt", backupUrl = "") {
  const world = await createTestWorld(page, title, backupUrl);
  await page.goto(`/?world=${world.id}`);
  await waitForManuscriptReady(page);
}

function waitForManuscriptReady(page: Page, name: string | RegExp = "Manuskript") {
  return page.getByRole("toolbar", { name }).waitFor();
}

function waitForSuccessfulManuscriptWrite(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.url().includes("/api/manuscript") &&
      response.request().method() !== "GET" &&
      response.ok(),
  );
}

function waitForSuccessfulStoryWorldWrite(page: Page, payloadMarker: string) {
  return page.waitForResponse(
    (response) =>
      response.url().includes("/api/state") &&
      response.request().method() === "PUT" &&
      Boolean(response.request().postData()?.includes(payloadMarker)) &&
      response.ok(),
  );
}

async function expectKeyboardMenuContract(page: Page, triggerName: string, menuName = triggerName) {
  const trigger = page.getByRole("button", { name: triggerName, exact: true });
  await trigger.focus();
  await page.keyboard.press("ArrowDown");

  const menu = page.getByRole("menu", { name: menuName, exact: true });
  await expect(menu).toBeVisible();
  const menuId = await menu.getAttribute("id");
  expect(menuId).toBeTruthy();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(trigger).toHaveAttribute("aria-controls", menuId ?? "");
  await expect(
    menu.locator('[role="menuitem"]:not([disabled]):not([aria-disabled="true"])').first(),
  ).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

async function expectOverlayInsideViewport(overlay: Locator, page: Page, label: string) {
  await expect
    .poll(
      async () => {
        const settledBox = await overlay.boundingBox();
        const settledViewport = page.viewportSize();
        return Boolean(
          settledBox &&
            settledViewport &&
            settledBox.x >= 0 &&
            settledBox.y >= 0 &&
            settledBox.x + settledBox.width <= settledViewport.width + 1 &&
            settledBox.y + settledBox.height <= settledViewport.height + 1,
        );
      },
      { message: `${label} liegt nach der Öffnungsanimation vollständig im Viewport` },
    )
    .toBe(true);
  const box = await overlay.boundingBox();
  const viewport = page.viewportSize();
  expect(box, `${label} hat keine messbare Geometrie`).not.toBeNull();
  expect(viewport, `${label} hat keinen Viewport`).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.x, `${label} ragt links heraus`).toBeGreaterThanOrEqual(0);
  expect(box.y, `${label} ragt oben heraus`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${label} ragt rechts heraus`).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height, `${label} ragt unten heraus`).toBeLessThanOrEqual(viewport.height + 1);
}

test("Mobile Kernarbeitsbereiche halten ihre Layout- und Touch-Verträge", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Der Test setzt die kompakte Breite selbst und muss nur einmal laufen.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/state*", (route) =>
    route.request().method() === "GET"
      ? fulfillStoryWorld(route, {
          nodes: [
            { id: "n1", x: 120, y: 140, type: "person", name: "Ada" },
            { id: "n2", x: 420, y: 240, type: "person", name: "Bela" },
            { id: "p1", x: 280, y: 340, type: "ort", name: "Hafen" },
          ],
          edges: [],
        })
      : fulfillDocumentSave(route, 1),
  );
  await openBlankWorld(page, "Mobile Layoutwelt");
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();
  const manuscriptToolbar = page.getByRole("toolbar", { name: "Manuskript" });
  const toolbarGroups = manuscriptToolbar.getByRole("group");

  const expectNoDocumentOverflow = async (label: string) => {
    const geometry = await page.locator("html").evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }));
    expect(geometry.scroll, `${label} verbreitert das Dokument`).toBeLessThanOrEqual(
      geometry.client + 1,
    );
  };

  const expectVisibleActionsTouchSized = async (label: string) => {
    const undersized = await page
      .locator('button:visible, [role="button"]:visible, [role="radio"]:visible')
      .evaluateAll((controls) =>
        controls.flatMap((control) => {
          if (control.getAttribute("aria-hidden") === "true") return [];
          const box = control.getBoundingClientRect();
          if (box.width + 0.5 >= 44 && box.height + 0.5 >= 44) return [];
          return [
            `${control.getAttribute("aria-label") ?? control.textContent?.trim() ?? control.getAttribute("role") ?? control.tagName} [${control.className || "no-class"}]: ${Math.round(box.width)}x${Math.round(box.height)}`,
          ];
        }),
      );
    expect(undersized, `${label} enthält Touchziele unter 44px`).toEqual([]);
  };

  const actionRows = await toolbarGroups.evaluateAll((groups) =>
    groups
      .filter((group) => group.getBoundingClientRect().width > 0)
      .map((group) => Math.round(group.getBoundingClientRect().top)),
  );
  expect(new Set(actionRows).size).toBe(1);
  const compactGroupInsets = await toolbarGroups.evaluateAll((groups) =>
    groups
      .filter((group) => group.getBoundingClientRect().width > 0)
      .map((group) => {
        const style = getComputedStyle(group);
        return {
          left: Number.parseFloat(style.paddingInlineStart),
          right: Number.parseFloat(style.paddingInlineEnd),
        };
      }),
  );
  expect(compactGroupInsets.filter(({ left, right }) => Math.abs(left - right) > 0.5)).toEqual([]);
  const undersizedToolbarButtons = await manuscriptToolbar
    .getByRole("button")
    .evaluateAll((buttons) =>
      buttons.flatMap((button) => {
        const box = button.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return [];
        return box.width + 0.5 < 44 || box.height + 0.5 < 44
          ? [
              `${button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "Aktion"}: ${Math.round(box.width)}x${Math.round(box.height)}`,
            ]
          : [];
      }),
    );
  expect(undersizedToolbarButtons).toEqual([]);
  await expect(page.getByRole("button", { name: "Exportieren" })).toBeVisible();
  const offCenterToolbarIcons = await manuscriptToolbar.getByRole("button").evaluateAll((buttons) =>
    buttons.flatMap((button) => {
      const label = button.querySelector(".ui-button__label");
      const icon = button.querySelector(".ui-button__icon");
      if (!(label instanceof HTMLElement) || !(icon instanceof HTMLElement)) return [];
      if (getComputedStyle(label).display !== "none") return [];
      const buttonBox = button.getBoundingClientRect();
      const iconBox = icon.getBoundingClientRect();
      const offset = iconBox.x + iconBox.width / 2 - (buttonBox.x + buttonBox.width / 2);
      return Math.abs(offset) > 0.5
        ? [`${button.getAttribute("aria-label") ?? "Aktion"}: ${offset.toFixed(1)}px`]
        : [];
    }),
  );
  expect(offCenterToolbarIcons).toEqual([]);
  await expectVisibleActionsTouchSized("Manuskript");
  await expectNoDocumentOverflow("Manuskript");

  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  const nodes = page.locator(".story-node");
  await expect(nodes).toHaveCount(3);
  const undersizedNodes = await nodes.evaluateAll((items) =>
    items.flatMap((item) => {
      const box = item.getBoundingClientRect();
      return box.width + 0.5 < 44 || box.height + 0.5 < 44
        ? [
            `${item.textContent?.trim() || "Figur"}: ${Math.round(box.width)}x${Math.round(box.height)}`,
          ]
        : [];
    }),
  );
  expect(undersizedNodes).toEqual([]);
  await expectVisibleActionsTouchSized("Figurenboard");
  await expectNoDocumentOverflow("Figurenboard");

  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.getByRole("main")).toBeVisible();
  await expectVisibleActionsTouchSized("Timeline");
  await expectNoDocumentOverflow("Timeline");

  await page.getByRole("button", { name: "Orte", exact: true }).click();
  await expect(page.getByRole("main")).toBeVisible();
  const newPlaceBox = await page.getByRole("button", { name: "Neuer Ort" }).boundingBox();
  expect(newPlaceBox?.width).toBeGreaterThanOrEqual(44);
  expect(newPlaceBox?.height).toBeGreaterThanOrEqual(44);
  const placeNodes = page.locator(".places-workspace .story-node");
  await expect(placeNodes).toHaveCount(1);
  const placeNodeBox = await placeNodes.first().boundingBox();
  expect(placeNodeBox?.width).toBeGreaterThanOrEqual(44);
  expect(placeNodeBox?.height).toBeGreaterThanOrEqual(44);
  await expectVisibleActionsTouchSized("Orte");
  await expectNoDocumentOverflow("Orte");
});

test("Menüs und Untermenüs halten den gemeinsamen Tastatur-, Fokus- und Viewport-Vertrag", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Der Test durchläuft Desktop und Mobile selbst und muss deshalb nur einmal laufen.",
  );
  test.setTimeout(90_000);

  await openBlankWorld(page, "Menü-Vertragswelt");

  for (const viewport of [
    { name: "Desktop", width: 1280, height: 800 },
    { name: "Mobile", width: 390, height: 844 },
  ]) {
    await test.step(viewport.name, async () => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.reload();
      await waitForManuscriptReady(page);

      await expectKeyboardMenuContract(page, "Exportieren", "Exportoptionen");

      await page.getByRole("button", { name: "Figuren", exact: true }).click();
      await expectKeyboardMenuContract(page, "Element", "Element erstellen");
      await expectKeyboardMenuContract(page, "Ansicht");
      await expectKeyboardMenuContract(page, "Verwalten");

      await page.getByRole("button", { name: "Timeline", exact: true }).click();
      const timeTrigger = page.getByRole("button", {
        name: "Zeitsystem konfigurieren",
        exact: true,
      });
      await timeTrigger.click();
      const timeSettings = page.getByRole("dialog", {
        name: "Zeitsystem konfigurieren",
        exact: true,
      });
      await expect(timeSettings).toBeVisible();
      await expectOverlayInsideViewport(timeSettings, page, `${viewport.name} / Zeitsystem`);
      await expect(timeSettings.locator(".timeline-time-settings-panel")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(timeSettings).toHaveCount(0);
      await expect(timeTrigger).toBeFocused();

      const assistantTrigger = page.getByRole("button", {
        name: "Lokalen Assistenten öffnen",
        exact: true,
      });
      await assistantTrigger.click();
      const chapterTrigger = page.getByRole("button", {
        name: "Kontext: gesamte Welt",
        exact: true,
      });
      await chapterTrigger.click();
      const chapterPicker = page.getByRole("dialog", {
        name: "Kapitel einzeln auswählen",
        exact: true,
      });
      await expect(chapterPicker).toBeVisible();
      await expectOverlayInsideViewport(
        chapterPicker,
        page,
        `${viewport.name} / Assistentenkontext`,
      );
      await expect(chapterPicker.getByRole("checkbox").first()).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(chapterPicker).toHaveCount(0);
      await expect(chapterTrigger).toBeFocused();
      await page.getByRole("button", { name: "Assistent schließen", exact: true }).click();
    });
  }
});

test("Tiefe Schreibhilfe-Zustände halten den mobilen Layout- und Bedienvertrag", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Der Test setzt den mobilen Viewport selbst und muss deshalb nur einmal laufen.",
  );
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const worldTitle = `Schreibhilfe-Vertragswelt ${crypto.randomUUID()}`;
  await openBlankWorld(page, worldTitle);

  await page
    .getByRole("toolbar", { name: "Manuskript" })
    .getByRole("button", { name: "Schreibhilfe", exact: true })
    .click();
  const writingAid = page.getByRole("dialog", { name: "Schreibhilfe", exact: true });
  const writingAidSurface = page.locator('[role="dialog"][aria-label="Schreibhilfe"]');
  await writingAid.getByRole("tab", { name: "Einfügen", exact: true }).click();

  await writingAid.locator("summary").filter({ hasText: "Sonderzeichen auswählen" }).click();
  const symbols = writingAid.getByRole("list", {
    name: "Sonderzeichen auswählen",
    exact: true,
  });
  await expect(symbols.getByRole("button")).toHaveCount(22);
  const symbolGeometry = await symbols.evaluate((list) => ({
    clientWidth: list.clientWidth,
    scrollWidth: list.scrollWidth,
    buttons: [...list.querySelectorAll<HTMLButtonElement>("button")].map((button) => {
      const buttonBounds = button.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(button);
      const textBounds = range.getBoundingClientRect();
      return {
        label: button.textContent?.trim(),
        width: buttonBounds.width,
        height: buttonBounds.height,
        centerOffsetX:
          textBounds.left + textBounds.width / 2 - (buttonBounds.left + buttonBounds.width / 2),
        centerOffsetY:
          textBounds.top + textBounds.height / 2 - (buttonBounds.top + buttonBounds.height / 2),
      };
    }),
  }));
  expect(
    symbolGeometry.scrollWidth,
    "Sonderzeichenraster läuft horizontal über",
  ).toBeLessThanOrEqual(symbolGeometry.clientWidth + 1);
  for (const symbol of symbolGeometry.buttons) {
    expect(symbol.width, `${symbol.label} ist als Touchziel zu schmal`).toBeGreaterThanOrEqual(44);
    expect(symbol.height, `${symbol.label} ist als Touchziel zu niedrig`).toBeGreaterThanOrEqual(
      44,
    );
    expect(
      Math.abs(symbol.centerOffsetX),
      `${symbol.label} ist horizontal nicht zentriert`,
    ).toBeLessThanOrEqual(0.75);
    expect(
      Math.abs(symbol.centerOffsetY),
      `${symbol.label} ist vertikal nicht zentriert`,
    ).toBeLessThanOrEqual(0.75);
  }

  await writingAid.getByRole("button", { name: "Verwalten", exact: true }).click();
  const terms = page.getByRole("dialog", { name: "Eigene Begriffe", exact: true });
  await expect(terms).toBeVisible();
  await expect(writingAidSurface).toHaveAttribute("aria-hidden", "true");
  await expect(writingAidSurface).toHaveAttribute("inert", "");
  await expectOverlayInsideViewport(terms, page, "Mobile / Eigene Begriffe");
  const termsGeometry = await terms.evaluate((sheet) => {
    const body = sheet.querySelector<HTMLElement>(".ui-sheet__body.terms-sheet");
    const form = sheet.querySelector<HTMLElement>(".add-term");
    const input = form?.querySelector<HTMLInputElement>("input");
    const add = form?.querySelector<HTMLButtonElement>("button[type='submit']");
    if (!body || !form || !input || !add)
      throw new Error("Standardisiertes Begriffsformular fehlt");
    const sheetBounds = sheet.getBoundingClientRect();
    const bodyBounds = body.getBoundingClientRect();
    const bodyStyle = getComputedStyle(body);
    const inputBounds = input.getBoundingClientRect();
    const addBounds = add.getBoundingClientRect();
    return {
      sheetClientWidth: sheet.clientWidth,
      sheetScrollWidth: sheet.scrollWidth,
      bodyPaddingLeft: Number.parseFloat(bodyStyle.paddingLeft),
      bodyPaddingRight: Number.parseFloat(bodyStyle.paddingRight),
      inputInsetLeft: inputBounds.left - sheetBounds.left,
      addInsetRight: sheetBounds.right - addBounds.right,
      inputInsideBody: inputBounds.left >= bodyBounds.left && inputBounds.right <= bodyBounds.right,
      addInsideBody: addBounds.left >= bodyBounds.left && addBounds.right <= bodyBounds.right,
      controlCenterOffset:
        inputBounds.top + inputBounds.height / 2 - (addBounds.top + addBounds.height / 2),
    };
  });
  expect(
    termsGeometry.sheetScrollWidth,
    "Begriffs-Sheet läuft horizontal über",
  ).toBeLessThanOrEqual(termsGeometry.sheetClientWidth + 1);
  expect(termsGeometry.bodyPaddingLeft).toBeGreaterThanOrEqual(12);
  expect(termsGeometry.bodyPaddingRight).toBeGreaterThanOrEqual(12);
  expect(termsGeometry.inputInsetLeft).toBeGreaterThanOrEqual(termsGeometry.bodyPaddingLeft - 0.5);
  expect(termsGeometry.addInsetRight).toBeGreaterThanOrEqual(termsGeometry.bodyPaddingRight - 0.5);
  expect(termsGeometry.inputInsideBody).toBe(true);
  expect(termsGeometry.addInsideBody).toBe(true);
  expect(Math.abs(termsGeometry.controlCenterOffset)).toBeLessThanOrEqual(0.75);

  await terms.getByLabel("Neuer Begriff").fill("Nachtarchiv");
  const termSave = waitForSuccessfulManuscriptWrite(page);
  await terms.getByRole("button", { name: "Begriff hinzufügen" }).click();
  await termSave;
  await expect(terms.getByRole("button", { name: "Nachtarchiv", exact: true })).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: `${worldTitle} – Welt öffnen`, exact: true }).click();
  await waitForManuscriptReady(page);
  await page
    .getByRole("toolbar", { name: "Manuskript" })
    .getByRole("button", { name: "Schreibhilfe", exact: true })
    .click();
  const reloadedAid = page.getByRole("dialog", { name: "Schreibhilfe", exact: true });
  await reloadedAid.getByRole("tab", { name: "Einfügen", exact: true }).click();
  const persistedTerm = reloadedAid.getByRole("button", { name: "Nachtarchiv", exact: true });
  await expect(persistedTerm).toBeVisible();
  const insertSave = waitForSuccessfulManuscriptWrite(page);
  await persistedTerm.click();
  await insertSave;
  await expect(page.getByLabel("Kapiteltext")).toContainText("Nachtarchiv");

  await reloadedAid.getByRole("button", { name: "Verwalten", exact: true }).click();
  const reloadedTerms = page.getByRole("dialog", { name: "Eigene Begriffe", exact: true });
  const removeSave = waitForSuccessfulManuscriptWrite(page);
  await reloadedTerms.getByRole("button", { name: "Nachtarchiv entfernen" }).click();
  await removeSave;
  await reloadedTerms.getByRole("button", { name: "Schließen", exact: true }).click();
  await expect(reloadedAid).not.toHaveAttribute("aria-hidden");
  await expect(reloadedAid).not.toHaveAttribute("inert");
  await expect(reloadedAid.getByRole("button", { name: "Nachtarchiv", exact: true })).toHaveCount(
    0,
  );

  await page.goto("/");
  await page.getByRole("button", { name: `${worldTitle} – Welt öffnen`, exact: true }).click();
  await waitForManuscriptReady(page);
  await page
    .getByRole("toolbar", { name: "Manuskript" })
    .getByRole("button", { name: "Schreibhilfe", exact: true })
    .click();
  const afterRemovalReload = page.getByRole("dialog", { name: "Schreibhilfe", exact: true });
  await afterRemovalReload.getByRole("tab", { name: "Einfügen", exact: true }).click();
  await expect(
    afterRemovalReload.getByRole("button", { name: "Nachtarchiv", exact: true }),
  ).toHaveCount(0);
});

test("Orte behalten am 820px-Übergang die volle Kartenhöhe", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Der Test setzt die kritische Zwischenbreite selbst und muss nur einmal laufen.",
  );
  await page.setViewportSize({ width: 815, height: 760 });
  await page.route("**/api/state*", (route) =>
    route.request().method() === "GET"
      ? fulfillStoryWorld(route, {
          nodes: [
            { id: "p1", x: 120, y: 100, mapX: 120, mapY: 100, type: "ort", name: "Nordtor" },
            {
              id: "p2",
              x: 280,
              y: 220,
              mapX: 280,
              mapY: 220,
              type: "ort",
              name: "Frostkloster",
            },
            { id: "p3", x: 440, y: 340, mapX: 440, mapY: 340, type: "ort", name: "Hafen" },
          ],
          edges: [],
        })
      : fulfillDocumentSave(route, 1),
  );
  await openBlankWorld(page, "Orte Breakpointwelt");
  await page.getByRole("button", { name: "Orte", exact: true }).click();
  await expect(page.locator(".places-workspace .story-node")).toHaveCount(3);
  await expect(page.locator(".places-inspector")).toHaveCount(0);

  const layout = await page.locator(".places-workspace .figure-layout").evaluate((element) => {
    const flow = element.querySelector<HTMLElement>(".places-flow-area");
    const layoutBox = element.getBoundingClientRect();
    const flowBox = flow?.getBoundingClientRect();
    return {
      childCount: element.children.length,
      layoutHeight: layoutBox.height,
      flowHeight: flowBox?.height ?? 0,
    };
  });
  expect(layout.childCount).toBe(1);
  expect(layout.flowHeight).toBeGreaterThan(400);
  expect(Math.abs(layout.flowHeight - layout.layoutHeight)).toBeLessThanOrEqual(1);

  await page.getByRole("group", { name: "Ort: Nordtor", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Orte-Inspector" })).toBeVisible();
  await expect(page.locator(".places-inspector")).toHaveCount(0);
});

test("Orte teilen im Overview-LOD Marker und Prioritätspillen mit Figuren", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Der LOD-Vertrag ist breitenunabhängig und muss nur einmal laufen.",
  );
  await page.route("**/api/state*", (route) =>
    route.request().method() === "GET"
      ? fulfillStoryWorld(route, {
          nodes: [
            { id: "p1", x: 0, y: 0, mapX: 0, mapY: 0, type: "ort", name: "Hafen" },
            {
              id: "p2",
              x: 20_000,
              y: 4_000,
              mapX: 20_000,
              mapY: 4_000,
              type: "ort",
              name: "Leuchtturm",
              important: true,
            },
          ],
          edges: [],
        })
      : fulfillDocumentSave(route, 1),
  );
  await openBlankWorld(page, "Orte LOD-Welt");
  await page.getByRole("button", { name: "Orte", exact: true }).click();

  await expect(page.locator(".places-flow-area")).toHaveClass(/zoom-overview/);
  await expect(page.getByRole("group", { name: "Ort: Hafen", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Ort: Leuchtturm", exact: true })).toBeVisible();

  const markers = await page.locator(".places-workspace .story-node").evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      const monogram = node.querySelector<HTMLElement>(".node-monogram");
      const name = node.querySelector<HTMLElement>("strong");
      return {
        important: node.classList.contains("is-important"),
        width: style.width,
        height: style.height,
        visualWidth: Math.round(box.width),
        visualHeight: Math.round(box.height),
        radius: style.borderRadius,
        boxShadow: style.boxShadow,
        monogramDisplay: monogram ? getComputedStyle(monogram).display : "missing",
        nameDisplay: name ? getComputedStyle(name).display : "missing",
      };
    }),
  );

  expect(markers).toHaveLength(2);
  const regularMarker = markers.find((marker) => !marker.important);
  const priorityMarker = markers.find((marker) => marker.important);
  expect(regularMarker).toMatchObject({
    width: "32px",
    height: "32px",
    visualWidth: 32,
    visualHeight: 32,
    radius: "50%",
    monogramDisplay: "grid",
    nameDisplay: "none",
  });
  expect(priorityMarker).toMatchObject({
    width: "116px",
    height: "34px",
    visualWidth: 116,
    visualHeight: 34,
    radius: "5px",
    monogramDisplay: "none",
    nameDisplay: "flex",
  });
  expect(priorityMarker?.boxShadow).not.toBe("none");
});

// Die drei Playwright-Projekte fahren 1440, 900 und 390px. Dazwischen liegen die Breiten, an
// denen die Kontextleiste tatsächlich kippt -- der abgeschnittene Knopf saß bei 406px, der
// Zeilenumbruch bei 998px. Statt für jede davon ein viertes Projekt anzulegen (das die ganze
// Suite ein weiteres Mal fährt und vierzehn zusätzliche Vergleichsbilder verlangt), prüft ein
// Test die Leiste über die ganze Spanne. Er braucht kein Bild, nur Geometrie.
test("Die Kontextleiste bleibt von 320 bis 1440px innerhalb des Fensters", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Der Test stellt die Fensterbreite selbst; er darf nur einmal laufen.",
  );
  await openBlankWorld(page);
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();
  const manuscriptToolbar = page.getByRole("toolbar", { name: "Manuskript" });
  const toolbarActions = manuscriptToolbar.locator(".manuscript-toolbar-actions");
  const toolbarGroups = manuscriptToolbar.getByRole("group");

  for (const width of [
    320, 360, 390, 406, 414, 500, 719, 720, 820, 821, 878, 900, 998, 1099, 1100, 1329, 1440,
  ]) {
    await page.setViewportSize({ width, height: 900 });
    // Auf kompakten Breiten scrollen die Actions innerhalb der öffentlichen WorkspaceToolbar.
    // Die Leiste und das Dokument selbst dürfen dadurch weiterhin nie breiter als das Fenster sein.
    const containment = await page.evaluate(() => {
      const root = document.documentElement;
      const toolbar = document.querySelector<HTMLElement>(
        '[role="toolbar"][aria-label="Manuskript"]',
      );
      const actions = toolbar?.querySelector<HTMLElement>(".manuscript-toolbar-actions");
      const toolbarBox = toolbar?.getBoundingClientRect();
      const actionsBox = actions?.getBoundingClientRect();
      const summary = toolbar?.querySelector<HTMLElement>(".manuscript-toolbar__summary");
      const summaryTitle = summary?.querySelector<HTMLElement>(".workspace-toolbar__title");
      const summaryStats = summary?.querySelector<HTMLElement>(".manuscript-toolbar__stats");
      const summaryTitleBox = summaryTitle?.getBoundingClientRect();
      const summaryStatsBox = summaryStats?.getBoundingClientRect();
      const visibleTitleChildren = summaryTitle
        ? [...summaryTitle.children]
            .map((child) => child.getBoundingClientRect())
            .filter((box) => box.width > 0 && box.height > 0)
        : [];
      const titleContentHeight = visibleTitleChildren.length
        ? Math.max(...visibleTitleChildren.map((box) => box.bottom)) -
          Math.min(...visibleTitleChildren.map((box) => box.top))
        : 0;
      const overflowingElements = [...document.body.querySelectorAll<HTMLElement>("*")]
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && (box.left < -0.5 || box.right > root.clientWidth + 0.5);
        })
        .slice(0, 8)
        .map((element) => `${element.tagName.toLowerCase()}.${element.className}`);
      return {
        documentClientWidth: root.clientWidth,
        documentScrollWidth: root.scrollWidth,
        overflowingElements,
        toolbarLeft: toolbarBox?.left,
        toolbarRight: toolbarBox?.right,
        actionsLeft: actionsBox?.left,
        actionsRight: actionsBox?.right,
        actionsClientWidth: actions?.clientWidth,
        actionsScrollWidth: actions?.scrollWidth,
        actionsOverflowX: actions ? getComputedStyle(actions).overflowX : "missing",
        summaryDirection: summary ? getComputedStyle(summary).flexDirection : "missing",
        summaryTitleFlexGrow: summaryTitle ? getComputedStyle(summaryTitle).flexGrow : "missing",
        summaryTitleFlexBasis: summaryTitle ? getComputedStyle(summaryTitle).flexBasis : "missing",
        summaryTitleEmptyBlockSpace: summaryTitleBox
          ? summaryTitleBox.height - titleContentHeight
          : Number.POSITIVE_INFINITY,
        summaryVerticalGap:
          summaryTitleBox && summaryStatsBox && summaryStatsBox.top >= summaryTitleBox.bottom
            ? summaryStatsBox.top - summaryTitleBox.bottom
            : 0,
      };
    });
    expect(
      containment.documentScrollWidth,
      `Dokument-Overflow bei ${width}px (Toolbar ${containment.toolbarLeft}-${containment.toolbarRight}, Actions ${containment.actionsLeft}-${containment.actionsRight}, ${containment.actionsClientWidth}/${containment.actionsScrollWidth}, overflow ${containment.actionsOverflowX}): ${containment.overflowingElements.join(", ")}`,
    ).toBeLessThanOrEqual(containment.documentClientWidth + 1);
    expect(containment.toolbarLeft).toBeGreaterThanOrEqual(-0.5);
    expect(containment.toolbarRight).toBeLessThanOrEqual(width + 0.5);
    expect(containment.actionsLeft).toBeGreaterThanOrEqual((containment.toolbarLeft ?? 0) - 0.5);
    expect(containment.actionsRight).toBeLessThanOrEqual((containment.toolbarRight ?? width) + 0.5);
    expect(containment.summaryTitleFlexGrow).toBe("0");
    expect(containment.summaryTitleFlexBasis).toBe("auto");
    expect(
      containment.summaryTitleEmptyBlockSpace,
      `Titel reserviert bei ${width}px unsichtbare Blockhöhe`,
    ).toBeLessThanOrEqual(1);
    if (containment.summaryDirection === "column") {
      expect(
        containment.summaryVerticalGap,
        `Titel und Statistik driften bei ${width}px vertikal auseinander`,
      ).toBeLessThanOrEqual(4);
    }

    if (width === 900) {
      const asymmetricSeparators = await page
        .getByRole("toolbar", { name: "Manuskript" })
        .getByRole("group")
        .evaluateAll((groups) => {
          const visible = groups.filter((group) => group.getBoundingClientRect().width > 0);
          return visible.slice(1).flatMap((group, index) => {
            const previousButtons = [...visible[index].querySelectorAll("button")].filter(
              (button) => button.getBoundingClientRect().width > 0,
            );
            const currentButtons = [...group.querySelectorAll("button")].filter(
              (button) => button.getBoundingClientRect().width > 0,
            );
            const previous = previousButtons.at(-1);
            const current = currentButtons[0];
            if (!previous || !current) return [];
            const groupBox = group.getBoundingClientRect();
            const border = Number.parseFloat(getComputedStyle(group).borderInlineStartWidth);
            if (border < 0.5) return [];
            const separator = groupBox.left + border / 2;
            const before = separator - previous.getBoundingClientRect().right;
            const after = current.getBoundingClientRect().left - separator;
            return Math.abs(before - after) > 1
              ? [`${before.toFixed(1)}px vor / ${after.toFixed(1)}px nach Separator`]
              : [];
          });
        });
      expect(asymmetricSeparators).toEqual([]);
    }
  }

  await page.setViewportSize({ width: 733, height: 900 });
  const mediumOverflow = await toolbarActions.evaluate((actions) => ({
    clientWidth: actions.clientWidth,
    scrollWidth: actions.scrollWidth,
  }));
  expect(mediumOverflow.scrollWidth).toBeLessThanOrEqual(mediumOverflow.clientWidth + 1);

  await page.setViewportSize({ width: 320, height: 900 });
  const compactFit = await toolbarActions.evaluate((actions) => ({
    clientWidth: actions.clientWidth,
    overflowX: getComputedStyle(actions).overflowX,
    scrollWidth: actions.scrollWidth,
  }));
  expect(compactFit.scrollWidth).toBeLessThanOrEqual(compactFit.clientWidth + 1);
  expect(compactFit.overflowX).toBe("auto");

  const exportAction = manuscriptToolbar.getByRole("button", { name: "Exportieren" });
  await exportAction.focus();
  const [actionsBox, exportBox] = await Promise.all([
    toolbarActions.boundingBox(),
    exportAction.boundingBox(),
  ]);
  if (!actionsBox || !exportBox) throw new Error("Fokussierte Toolbar-Aktion hat keine Geometrie");
  expect(exportBox.x).toBeGreaterThanOrEqual(actionsBox.x - 0.5);
  expect(exportBox.x + exportBox.width).toBeLessThanOrEqual(actionsBox.x + actionsBox.width + 0.5);

  // Die volle Manuskriptleiste klappt Beschriftungen etwas früher ein als kleine Toolbars, damit
  // Zwischenbreiten nie erst horizontal gescrollt werden müssen.
  const chapters = manuscriptToolbar.getByRole("button", { name: "Kapitel", exact: true });
  const aid = manuscriptToolbar.getByRole("button", { name: "Schreibhilfe", exact: true });
  const chaptersLabel = chapters.getByText("Kapitel", { exact: true });
  const aidLabel = aid.getByText("Schreibhilfe", { exact: true });
  await page.setViewportSize({ width: 901, height: 900 });
  await expect(chaptersLabel).toBeVisible();
  await expect(aidLabel).toBeVisible();

  await page.setViewportSize({ width: 900, height: 900 });
  await expect(chaptersLabel).toBeHidden();
  await expect(aidLabel).toBeHidden();

  await page.setViewportSize({ width: 719, height: 900 });
  for (const action of [chapters, aid]) {
    const box = await action.boundingBox();
    if (!box) throw new Error("Responsive Toolbar-Aktion hat keine Geometrie");
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await expect(chapters).toBeVisible();
  await expect(chapters).toHaveAttribute("aria-label", "Kapitel");
  await expect(aid).toHaveAttribute("aria-label", "Schreibhilfe");
});

test("Schmale Leisten behalten dieselbe visuelle Reihenfolge wie die breite Ansicht", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Der Test stellt die problematische Zwischenbreite selbst ein.",
  );
  await openBlankWorld(page);
  await page.setViewportSize({ width: 717, height: 912 });

  const [workspaceNav, globalTools] = await Promise.all([
    page.getByRole("navigation", { name: "Arbeitsbereich" }).boundingBox(),
    page.getByRole("toolbar", { name: "Globale Werkzeuge" }).boundingBox(),
  ]);
  expect(workspaceNav).not.toBeNull();
  expect(globalTools).not.toBeNull();
  expect(globalTools!.x).toBeGreaterThanOrEqual(workspaceNav!.x + workspaceNav!.width);

  const iconCenterOffsets = (
    await Promise.all(
      [
        page.getByRole("navigation", { name: "Arbeitsbereich" }),
        page.getByRole("toolbar", { name: "Globale Werkzeuge" }),
      ].map((owner) =>
        owner.getByRole("button").evaluateAll((buttons) =>
          buttons.map((button) => {
            const icon = button.querySelector<HTMLElement>(
              ":scope > .ui-button__icon, :scope > .icon-button__icon",
            );
            if (!icon) throw new Error(`${button.getAttribute("aria-label")} hat kein Icon`);
            const buttonBox = button.getBoundingClientRect();
            const iconBox = icon.getBoundingClientRect();
            return {
              label: button.getAttribute("aria-label") ?? "Unbenannte Aktion",
              x: iconBox.left + iconBox.width / 2 - (buttonBox.left + buttonBox.width / 2),
              y: iconBox.top + iconBox.height / 2 - (buttonBox.top + buttonBox.height / 2),
            };
          }),
        ),
      ),
    )
  ).flat();
  for (const offset of iconCenterOffsets) {
    expect(Math.abs(offset.x), `${offset.label} ist horizontal nicht mittig`).toBeLessThanOrEqual(
      0.5,
    );
    expect(Math.abs(offset.y), `${offset.label} ist vertikal nicht mittig`).toBeLessThanOrEqual(
      0.5,
    );
  }

  const manuscriptToolbar = page.getByRole("toolbar", { name: "Manuskript" });
  const title = await manuscriptToolbar.locator(".workspace-toolbar__title").boundingBox();
  const actionRows = await manuscriptToolbar
    .getByRole("group")
    .evaluateAll((groups) =>
      groups
        .filter((group) => group.getBoundingClientRect().width > 0)
        .map((group) => Math.round(group.getBoundingClientRect().top)),
    );
  expect(title).not.toBeNull();
  expect(new Set(actionRows).size).toBe(1);
  expect(actionRows[0]).toBeGreaterThanOrEqual(Math.floor(title!.y + title!.height));
});

test("Zwischen 720 und 1100px rückt die Kapitelspalte den Text ein, statt ihn zu verdecken", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Der Test stellt die Fensterbreite selbst; er darf nur einmal laufen.",
  );
  await openBlankWorld(page);
  const editor = page.getByLabel("Kapiteltext");
  await expect(editor).toBeVisible();
  const binder = page.getByRole("complementary", { name: "Kapitel" });
  const editorPage = page.locator(".editor-page");
  const editorScroller = page.locator(".cm-scroller").filter({ has: editor });

  for (const width of [720, 800, 900, 1000, 1099]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(binder).toBeVisible();
    const [binderBox, pageBox] = [await binder.boundingBox(), await editorPage.boundingBox()];
    // Der Kern der Entscheidung: die Spalte endet dort, wo die Schreibfläche anfängt.
    // Vorher lag sie darüber und schnitt den linken Rand jeder Zeile ab.
    expect(
      binderBox!.x + binderBox!.width,
      `Spalte überlappt den Text bei ${width}px`,
    ).toBeLessThanOrEqual(pageBox!.x + 0.5);
    // Und die Schreibfläche darf dabei nicht seitwärts scrollen müssen.
    const scrollsX = await editorScroller.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(scrollsX, `Editor scrollt waagerecht bei ${width}px`).toBe(false);
  }
});

test("Der Speicherstand weicht schmal ins Menü aus, der Fehler aber nie", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Der Test stellt die Fensterbreite selbst; er darf nur einmal laufen.",
  );
  await openBlankWorld(page);
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();

  await page.setViewportSize({ width: 400, height: 844 });
  await expect(page.getByRole("status")).toBeVisible();

  // Ab hier fehlt der App-Leiste der Platz; der ruhige Stand zieht ins ⋯-Menü um.
  await page.setViewportSize({ width: 399, height: 844 });
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.getByRole("button", { name: "Mehr" }).click();
  await expect(page.getByRole("dialog", { name: "Aktionen" }).getByRole("status")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("Weltenauswahl bleibt auch mit vielen Welten vollständig scrollbar", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Der Test stellt beide relevanten Fensterhöhen selbst ein und muss nur einmal laufen.",
  );
  const worlds = Array.from({ length: 30 }, (_, index) => ({
    id: `world-${index + 1}`,
    title: `Welt ${index + 1}`,
    updated: "2026-08-09T12:00:00Z",
  }));
  await page.route("**/api/worlds", (route) => route.fulfill({ json: { worlds } }));
  await page.setViewportSize({ width: 1329, height: 912 });
  await page.goto("/");
  const worldGate = page.locator(".world-gate");
  const worldList = page.locator(".world-list");
  const lastWorld = page.getByRole("button", {
    name: "Welt 30 – Welt öffnen",
    exact: true,
  });
  const readScrollState = () =>
    page.evaluate(() => {
      const read = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`Scrollfläche fehlt: ${selector}`);
        const style = getComputedStyle(element);
        const thumbStyle = getComputedStyle(element, "::-webkit-scrollbar-thumb");
        const colorProbe = document.createElement("span");
        colorProbe.style.color = "var(--gold-border)";
        element.append(colorProbe);
        const goldBorder = getComputedStyle(colorProbe).color;
        colorProbe.remove();
        const thumbBackground = thumbStyle.backgroundColor;
        return {
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          scrollTop: element.scrollTop,
          overflowY: style.overflowY,
          overflowing: element.scrollHeight > element.clientHeight + 1,
          scrollbar: element.dataset.scrollbar,
          scrollbarWidth: style.scrollbarWidth,
          thumbBackground,
          goldBorder,
          thumbMatchesGoldBorder: thumbBackground === goldBorder,
        };
      };
      const gate = read(".world-gate");
      const list = read(".world-list");
      return {
        gate,
        list,
        overflowingCount: [gate, list].filter((area) => area.overflowing).length,
      };
    });

  await expect(lastWorld).toBeAttached();
  await expect.poll(readScrollState).toMatchObject({
    gate: { overflowY: "hidden", overflowing: false },
    list: {
      overflowY: "auto",
      overflowing: true,
      scrollbar: "thin",
      scrollbarWidth: "thin",
      thumbMatchesGoldBorder: true,
    },
    overflowingCount: 1,
  });
  await lastWorld.scrollIntoViewIfNeeded();
  await expect(lastWorld).toBeVisible();
  expect(await worldList.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await page.setViewportSize({ width: 1329, height: 560 });
  await worldGate.evaluate((element) => {
    element.scrollTop = 0;
  });
  await worldList.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect.poll(readScrollState).toMatchObject({
    gate: {
      overflowY: "auto",
      overflowing: true,
      scrollbar: "thin",
      scrollbarWidth: "thin",
      thumbMatchesGoldBorder: true,
    },
    list: { overflowY: "visible", overflowing: false },
    overflowingCount: 1,
  });
  await lastWorld.scrollIntoViewIfNeeded();
  await expect(lastWorld).toBeVisible();
  expect(await worldGate.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await worldList.evaluate((element) => element.scrollTop)).toBe(0);
});

test("Text, Suche und Figurenboard laden ohne Laufzeitfehler", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBlankWorld(page);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();
  if ((page.viewportSize()?.width || 0) <= 820) {
    await expect(page.getByRole("complementary", { name: "Kapitel" })).toHaveCount(0);
    await page.getByRole("button", { name: "Kapitel", exact: true }).click();
    const navigation =
      (page.viewportSize()?.width || 0) < 720
        ? page.getByRole("dialog", { name: "Kapitel" })
        : page.getByRole("complementary", { name: "Kapitel" });
    await expect(navigation).toBeVisible();
    await page.getByRole("button", { name: "Kapitelnavigation schließen" }).click();
    await expect(navigation).toHaveCount(0);
  }
  await page.screenshot({ path: testInfo.outputPath("text.png"), fullPage: true });

  await page.keyboard.press("Control+KeyF");
  await page.getByRole("combobox", { name: "Suchbegriff" }).fill("Test");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Figuren" }).click();
  await expect(page.getByLabel("Figuren und Beziehungen")).toBeVisible();
  await expect(page.locator(".story-node")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("figures.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("CodeMirror hält Textauswahl für kontextuelle Schreibwerkzeuge stabil", async ({ page }) => {
  await openBlankWorld(page);
  const editor = page.getByLabel("Kapiteltext");
  await editor.fill("Der Morgen lag still über dem Hafen.");
  await page.keyboard.press("Control+z");
  await expect(editor.locator(".cm-placeholder")).toBeVisible();
  await editor.fill("Der Morgen lag still über dem Hafen.");
  await editor.selectText();
  // Markieren allein öffnet nichts mehr -- die Nachschlage-Aktionen sind eine eigene
  // Anfrage, so wie unter macOS. Sichtbar ist die Markierung trotzdem.
  const selectionMenu = page.getByRole("menu", { name: "Aktionen für die Textauswahl" });
  await expect(selectionMenu).toBeHidden();
  await expect(page.locator(".held-selection")).toContainText(
    "Der Morgen lag still über dem Hafen.",
  );
  await page.locator(".held-selection").click({ button: "right" });
  await expect(selectionMenu).toBeVisible();
  await selectionMenu.getByRole("menuitem", { name: "Nachschlagen" }).click();
  // Die Schreibhilfe hat keine eigene Markierungskarte mehr (.writing-selection-state ist fort).
  // Die Markierung *ist* die Frage, also steht sie im Suchfeld der Schreibhilfe.
  await expect(page.getByRole("textbox", { name: "Suchbegriff" })).toHaveValue(
    "Der Morgen lag still über dem Hafen.",
  );
  await expect(editor).toHaveText("Der Morgen lag still über dem Hafen.");
  await expect(
    page.getByText(/Sprachdaten sind nicht installiert|Keine Ergebnisse gefunden/),
  ).toBeVisible();
});

test("Fett und Kursiv liegen als Bereiche am Kapitel und überleben das Neuladen", async ({
  page,
}, testInfo) => {
  test.setTimeout(40_000);
  test.skip(testInfo.project.name !== "wide", "Die Auszeichnung hängt nicht an der Fensterbreite.");
  await openBlankWorld(page);
  const editor = page.getByLabel("Kapiteltext");
  const textSave = waitForSuccessfulManuscriptWrite(page);
  await editor.fill("Der Morgen lag still über dem Hafen.");
  await textSave;
  const selectionMenu = page.getByRole("menu", { name: "Aktionen für die Textauswahl" });

  await editor.selectText();
  await page.locator(".held-selection").click({ button: "right" });
  const boldSave = waitForSuccessfulManuscriptWrite(page);
  await selectionMenu.getByRole("menuitem", { name: "Fett" }).click();
  await boldSave;
  await expect(page.locator(".prose-editor .text-bold")).toContainText(
    "Der Morgen lag still über dem Hafen.",
  );

  await editor.selectText();
  await page.locator(".held-selection").click({ button: "right" });
  const italicSave = waitForSuccessfulManuscriptWrite(page);
  await selectionMenu.getByRole("menuitem", { name: "Kursiv" }).click();
  await expect(page.locator(".prose-editor .text-italic")).toContainText(
    "Der Morgen lag still über dem Hafen.",
  );

  // Die Auszeichnung ist kein Zeichen im Text, sondern ein Bereich neben ihm (Chapter.marks).
  // Der Beweis dafür ist, dass der Text unverändert bleibt und die Bereiche das Speichern überstehen.
  await expect(editor).toHaveText("Der Morgen lag still über dem Hafen.");
  await italicSave;
  await expect(page.getByRole("status").filter({ hasText: "Gespeichert" })).toBeVisible();
  await page.reload();
  await waitForManuscriptReady(page);
  await expect(page.getByLabel("Kapiteltext")).toHaveText("Der Morgen lag still über dem Hafen.");
  await expect(page.locator(".prose-editor .text-bold")).toContainText(
    "Der Morgen lag still über dem Hafen.",
  );
  await expect(page.locator(".prose-editor .text-italic")).toContainText(
    "Der Morgen lag still über dem Hafen.",
  );
});

test("Kapitel- und Schreibhilfe-Spalte lassen sich aus der Werkzeugleiste umschalten", async ({
  page,
}) => {
  await openBlankWorld(page);
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();
  const manuscriptToolbar = page.getByRole("toolbar", { name: "Manuskript" });
  const chapters = manuscriptToolbar.getByRole("button", { name: "Kapitel", exact: true });
  const aid = manuscriptToolbar.getByRole("button", { name: "Schreibhilfe", exact: true });
  const chapterPanel = page.getByRole("complementary", { name: "Kapitel" });
  const writingAidPanel = page.getByRole("complementary", { name: "Schreibhilfe" });
  await expect(chapters).toBeVisible();
  await expect(aid).toBeVisible();
  const width = page.viewportSize()?.width || 0;

  if (width >= 1100) {
    // Breit ist Platz für beides: die Spalten stehen nebeneinander und schließen sich nicht aus.
    await expect(chapters).toHaveAttribute("aria-pressed", "true");
    await expect(aid).toHaveAttribute("aria-pressed", "true");
    await expect(chapterPanel).toHaveCount(1);
    await expect(writingAidPanel).toHaveCount(1);
    await chapters.click();
    await expect(chapterPanel).toHaveCount(0);
    await expect(writingAidPanel).toHaveCount(1);
    await chapters.click();
    await expect(chapterPanel).toHaveCount(1);
  } else if (width < 720) {
    // Unter 720px sind beide Spalten Sheets. Ein Sheet ist modal, also muss das eine zu sein,
    // bevor das andere aufgeht -- deshalb hier über den Schließen-Knopf statt über die Leiste.
    await expect(chapterPanel).toHaveCount(0);
    await chapters.click();
    const binderSheet = page.getByRole("dialog", { name: "Kapitel" });
    await expect(binderSheet).toBeVisible();
    await expect(binderSheet.getByLabel("Kapitelnotiz")).toBeVisible();
    await page.getByRole("button", { name: "Kapitelnavigation schließen" }).click();
    await expect(binderSheet).toHaveCount(0);
    await aid.click();
    const aidSheet = page.getByRole("dialog", { name: "Schreibhilfe" });
    await expect(aidSheet).toBeVisible();
    await expect(aidSheet.getByRole("tab", { name: "Nachschlagen" })).toBeVisible();
  } else {
    // 720-1100: beide Spalten liegen als Schublade über dem Text, also kann nur eine offen sein.
    await expect(chapters).toHaveAttribute("aria-pressed", "true");
    await expect(aid).toHaveAttribute("aria-pressed", "false");
    await aid.click();
    await expect(aid).toHaveAttribute("aria-pressed", "true");
    await expect(chapters).toHaveAttribute("aria-pressed", "false");
    await expect(chapterPanel).toHaveCount(0);
    await expect(writingAidPanel).toHaveCount(1);
    await chapters.click();
    await expect(chapters).toHaveAttribute("aria-pressed", "true");
    await expect(aid).toHaveAttribute("aria-pressed", "false");
    await expect(writingAidPanel).toHaveCount(0);
  }
});

test("Schreibhilfe zeigt alle Tabtitel in der 294px-Spalte vollständig", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Der Test stellt die gemeldete 1329px-Ansicht selbst her und muss nur einmal laufen.",
  );
  await page.setViewportSize({ width: 1329, height: 912 });
  await openBlankWorld(page);
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();

  const writingAid = page.getByRole("complementary", { name: "Schreibhilfe" });
  await expect(writingAid).toBeVisible();
  const panelWidth = await writingAid.evaluate((panel) => panel.getBoundingClientRect().width);
  expect(panelWidth).toBeCloseTo(294, 0);

  const tabLists = [
    {
      list: writingAid.getByRole("tablist", { name: "Bereich der Schreibhilfe" }),
      labels: ["Nachschlagen", "Prüfen", "Einfügen"],
    },
    {
      list: writingAid.getByRole("tablist", { name: "Nachschlagewerk" }),
      labels: ["Wörterbuch", "Synonyme", "Übersetzen"],
    },
  ];

  for (const { list, labels } of tabLists) {
    await expect(list).toBeVisible();
    const geometry = await list.evaluate((tabList) => {
      const scroller = tabList.parentElement;
      if (!(scroller instanceof HTMLElement)) throw new Error("Tab-Scrollbereich fehlt");
      const scrollerBounds = scroller.getBoundingClientRect();
      return {
        scrollerClientWidth: scroller.clientWidth,
        scrollerWithinPanel: scrollerBounds.width <= 294.5,
        tabs: [...tabList.querySelectorAll<HTMLElement>("[role='tab']")].map((tab) => {
          const bounds = tab.getBoundingClientRect();
          return {
            label: tab.textContent?.trim(),
            clientWidth: tab.clientWidth,
            scrollWidth: tab.scrollWidth,
            insideScroller:
              bounds.left >= scrollerBounds.left - 0.5 &&
              bounds.right <= scrollerBounds.right + 0.5,
          };
        }),
      };
    });

    expect(geometry.scrollerClientWidth).toBeGreaterThan(0);
    expect(geometry.scrollerWithinPanel).toBe(true);
    expect(geometry.tabs.map(({ label }) => label)).toEqual(labels);
    for (const tab of geometry.tabs) {
      expect(tab.scrollWidth, `${tab.label} ist horizontal abgeschnitten`).toBeLessThanOrEqual(
        tab.clientWidth + 1,
      );
      expect(tab.insideScroller, `${tab.label} ist in der gemeldeten Ansicht nicht sichtbar`).toBe(
        true,
      );
    }
  }

  const documentWidth = await page.locator("html").evaluate((root) => ({
    client: root.clientWidth,
    scroll: root.scrollWidth,
  }));
  expect(documentWidth.scroll).toBeLessThanOrEqual(documentWidth.client + 1);
});

test("Kapiteleigenschaften hängen am Kapitel, nicht mehr in einem Inspektor-Tab", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Der Weg zu den Kapiteleigenschaften ist in einer Breite geprüft; die Spaltenlogik hat einen eigenen Test.",
  );
  await openBlankWorld(page);
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();

  // Der Titel steht über dem Text, nicht mehr rechts in einer Eigenschaftenspalte.
  const title = page.getByRole("textbox", { name: "Kapiteltitel" });
  await expect(title).toBeVisible();
  await expect(
    page.getByRole("article").getByRole("textbox", { name: "Kapiteltitel" }),
  ).toHaveCount(1);

  // Die Zählungen stehen als semantische Begriffe in der Manuskript-Werkzeugleiste.
  const manuscriptToolbar = page.getByRole("toolbar", { name: "Manuskript" });
  const stats = manuscriptToolbar.locator("dl");
  for (const term of ["Wörter", "Zeichen", "Normseiten"]) {
    await expect(stats.getByText(term, { exact: true })).toBeVisible();
  }

  // Die Notiz liegt links unter der Kapitelliste.
  const chapterPanel = page.getByRole("complementary", { name: "Kapitel" });
  await expect(chapterPanel.getByLabel("Kapitelnotiz")).toBeVisible();

  // Der zweigeteilte Inspektor ist fort: rechts gibt es nur noch die Schreibhilfe.
  await expect(page.getByRole("tab", { name: "Kapitel", exact: true })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Schreibhilfe" })).toContainText(
    "Schreibhilfe",
  );

  // Kapitelaktionen bleiben ruhig in der aktiven Zeile und öffnen ein semantisches Aktionsmenü.
  const activeChapter = chapterPanel.locator(".binder-chapter-row.active");
  const actionTrigger = activeChapter.getByRole("button", { name: /Kapitelaktionen:/ });
  await expect(actionTrigger).toBeVisible();
  const actionGeometry = await activeChapter.evaluate((row) => {
    const trigger = row.querySelector<HTMLButtonElement>(".binder-chapter-action-trigger");
    if (!trigger) throw new Error("Kontextueller Kapitelaktionstrigger fehlt");
    const rowBounds = row.getBoundingClientRect();
    const triggerBounds = trigger.getBoundingClientRect();
    const expectedTarget = Number.parseFloat(
      getComputedStyle(trigger).getPropertyValue("--control-compact"),
    );
    const hit = document.elementFromPoint(
      triggerBounds.left + triggerBounds.width / 2,
      triggerBounds.top + triggerBounds.height / 2,
    );
    return {
      rowClientWidth: row.clientWidth,
      rowScrollWidth: row.scrollWidth,
      expectedTarget,
      width: triggerBounds.width,
      height: triggerBounds.height,
      inside:
        triggerBounds.left >= rowBounds.left - 0.5 && triggerBounds.right <= rowBounds.right + 0.5,
      hit: hit === trigger || (hit instanceof Node && trigger.contains(hit)),
    };
  });
  expect(actionGeometry.rowScrollWidth).toBeLessThanOrEqual(actionGeometry.rowClientWidth + 1);
  expect(actionGeometry.expectedTarget).toBe(
    (page.viewportSize()?.width ?? 0) <= 719 || testInfo.project.use.hasTouch ? 44 : 30,
  );
  expect(actionGeometry.width).toBeCloseTo(actionGeometry.expectedTarget, 0);
  expect(actionGeometry.height).toBeCloseTo(actionGeometry.expectedTarget, 0);
  expect(actionGeometry.inside).toBe(true);
  expect(actionGeometry.hit).toBe(true);

  await actionTrigger.click();
  const chapterMenu = page.getByRole("menu", { name: /Kapitelaktionen:/ });
  for (const item of ["Nach oben", "Nach unten", "Kapitel als Markdown", "Kapitel löschen"]) {
    await expect(chapterMenu.getByRole("menuitem", { name: item, exact: true })).toBeVisible();
  }
  await chapterMenu.press("Escape");
  await expect(actionTrigger).toBeFocused();
});

test("Verschachtelte Kapitelordner überleben Drag-and-drop und Neuladen", async ({
  page,
}, testInfo) => {
  // Der Vertrag bestätigt acht reale, aufeinander aufbauende Manuskript-Writes inklusive Reloads.
  // Das zusätzliche Budget ist kein Warten: jeder Schritt bleibt an die konkrete API-Response gebunden.
  test.setTimeout(60_000);
  test.skip(
    testInfo.project.name !== "wide",
    "Die Ordnersemantik ist viewport-unabhängig und wird in der breiten Binder-Ansicht geprüft.",
  );
  await openBlankWorld(page);
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();
  const titleSave = waitForSuccessfulManuscriptWrite(page);
  await page.getByRole("textbox", { name: "Kapiteltitel" }).fill("Kapitel im Bogen");
  await titleSave;

  const binder = page.getByRole("complementary", { name: "Kapitel" });
  const addFolder = binder.getByRole("button", { name: "Ordner hinzufügen" });
  await addFolder.click();
  await binder.getByRole("textbox", { name: "Ordnername" }).fill("Teil A");
  const folderASave = waitForSuccessfulManuscriptWrite(page);
  await binder.getByRole("textbox", { name: "Ordnername" }).press("Enter");
  await folderASave;
  await expect(binder.getByText("Teil A", { exact: true })).toBeVisible();

  await addFolder.click();
  await binder.getByRole("textbox", { name: "Ordnername" }).fill("Bogen B");
  const folderBSave = waitForSuccessfulManuscriptWrite(page);
  await binder.getByRole("textbox", { name: "Ordnername" }).press("Enter");
  await folderBSave;

  const folderA = binder.getByRole("button", { name: /^Teil A, \d+ Kapitel:/ }).locator("xpath=..");
  const folderB = binder
    .getByRole("button", { name: /^Bogen B, \d+ Kapitel:/ })
    .locator("xpath=..");
  const folderRowLayout = await folderA.evaluate((row) => {
    const rowBox = row.getBoundingClientRect();
    const toggle = row.querySelector<HTMLElement>(".binder-folder-toggle");
    const name = row.querySelector<HTMLElement>(".binder-folder-name");
    const actions = [...row.querySelectorAll<HTMLElement>(".binder-folder-action")].filter(
      (action) => action.getBoundingClientRect().width > 0,
    );
    const toggleBox = toggle?.getBoundingClientRect();
    const nameBox = name?.getBoundingClientRect();
    return {
      rowHeight: rowBox.height,
      toggleHeight: toggleBox?.height ?? 0,
      toggleWidth: toggleBox?.width ?? 0,
      nameWidth: nameBox?.width ?? 0,
      overflows: row.scrollWidth > row.clientWidth + 1,
      actionRowOffsets: actions.map((action) =>
        Math.abs(
          action.getBoundingClientRect().top +
            action.getBoundingClientRect().height / 2 -
            (rowBox.top + rowBox.height / 2),
        ),
      ),
    };
  });
  expect(folderRowLayout.overflows).toBe(false);
  expect(folderRowLayout.rowHeight).toBeGreaterThanOrEqual(44);
  expect(folderRowLayout.toggleHeight).toBeGreaterThanOrEqual(44);
  expect(folderRowLayout.toggleWidth).toBeGreaterThan(80);
  expect(folderRowLayout.nameWidth).toBeGreaterThan(30);
  expect(folderRowLayout.actionRowOffsets.every((offset) => offset <= 1)).toBe(true);
  const folderBHandle = folderB.locator('.binder-drag-handle[draggable="true"]');
  await folderB.hover();
  await expect
    .poll(() => folderBHandle.evaluate((handle) => getComputedStyle(handle).opacity))
    .toBe("1");
  const handleLayout = await folderBHandle.evaluate((handle) => {
    const bounds = handle.getBoundingClientRect();
    return {
      width: bounds.width,
      height: bounds.height,
      opacity: getComputedStyle(handle).opacity,
    };
  });
  expect(handleLayout.width).toBeGreaterThanOrEqual(24);
  expect(handleLayout.height).toBeGreaterThanOrEqual(40);
  expect(handleLayout.opacity).toBe("1");

  const rowTopBeforeDrag = (await folderB.boundingBox())?.y ?? 0;
  await folderBHandle.evaluate((handle) => {
    const transfer = new DataTransfer();
    handle.dispatchEvent(
      new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  });
  const insertionHeight = await folderA
    .locator("xpath=preceding-sibling::*[contains(@class, 'binder-drop-before')][1]")
    .evaluate((target) => target.getBoundingClientRect().height);
  const rootDrop = binder.locator(".binder-root-drop");
  await expect(rootDrop).toHaveAttribute("aria-hidden", "false");
  const rootGeometry = await rootDrop.evaluate((target) => {
    const bounds = target.getBoundingClientRect();
    const shellBounds = target.parentElement?.getBoundingClientRect();
    return {
      height: bounds.height,
      insideShell:
        Boolean(shellBounds) &&
        bounds.top >= shellBounds!.top &&
        bounds.bottom <= shellBounds!.bottom + 1,
    };
  });
  const rowTopDuringDrag = (await folderB.boundingBox())?.y ?? 0;
  expect(insertionHeight).toBeGreaterThanOrEqual(15);
  expect(rootGeometry.height).toBeGreaterThanOrEqual(44);
  expect(rootGeometry.insideShell).toBe(true);
  expect(Math.abs(rowTopDuringDrag - rowTopBeforeDrag)).toBeLessThanOrEqual(1);
  await folderBHandle.dispatchEvent("dragend");

  const nestedFolderSave = waitForSuccessfulManuscriptWrite(page);
  await folderBHandle.dragTo(folderA);
  await nestedFolderSave;
  const chapterInArc = /^\d+ Kapitel im Bogen \d+ (?:Wort|Wörter)(?: .+)?$/;
  const nestedChapterSave = waitForSuccessfulManuscriptWrite(page);
  await binder.getByRole("button", { name: chapterInArc }).dragTo(folderB);
  await nestedChapterSave;

  const folderAEntry = folderA.locator("xpath=..");
  const folderBEntry = binder
    .getByRole("button", { name: /^Bogen B, \d+ Kapitel:/ })
    .locator("xpath=../..");
  await expect(folderAEntry.getByRole("button", { name: /Teil A, 1 Kapitel/ })).toBeVisible();
  await expect(folderBEntry.getByRole("button", { name: /Bogen B, 1 Kapitel/ })).toBeVisible();
  await expect(folderBEntry.getByRole("button", { name: chapterInArc })).toBeVisible();
  const hierarchyLayout = await folderAEntry.evaluate((rootEntry) => {
    const rootRow = rootEntry.querySelector<HTMLElement>(":scope > .binder-folder-row");
    const children = rootEntry.querySelector<HTMLElement>(":scope > .binder-folder-children");
    const nestedEntry = children?.querySelector<HTMLElement>(":scope > .binder-folder-entry");
    const nestedRow = nestedEntry?.querySelector<HTMLElement>(":scope > .binder-folder-row");
    const nestedChildren = nestedEntry?.querySelector<HTMLElement>(
      ":scope > .binder-folder-children",
    );
    const chapterRow = nestedChildren?.querySelector<HTMLElement>(
      ":scope > .binder-tree-entry > .binder-chapter-row",
    );
    if (!rootRow || !children || !nestedEntry || !nestedRow || !chapterRow) {
      throw new Error("Expected the complete nested binder hierarchy");
    }
    const rootBounds = rootRow.getBoundingClientRect();
    const nestedBounds = nestedRow.getBoundingClientRect();
    const chapterBounds = chapterRow.getBoundingClientRect();
    const childrenBounds = children.getBoundingClientRect();
    const nestedEntryBounds = nestedEntry.getBoundingClientRect();
    const guideStyle = getComputedStyle(children, "::before");
    const connectorStyle = getComputedStyle(nestedEntry, "::before");
    return {
      rootLeft: rootBounds.left,
      rootRight: rootBounds.right,
      nestedLeft: nestedBounds.left,
      nestedRight: nestedBounds.right,
      chapterLeft: chapterBounds.left,
      chapterRight: chapterBounds.right,
      guideX: childrenBounds.left + Number.parseFloat(guideStyle.left),
      connectorX: nestedEntryBounds.left + Number.parseFloat(connectorStyle.left),
      guideWidth: Number.parseFloat(guideStyle.width),
      connectorWidth: Number.parseFloat(connectorStyle.width),
    };
  });
  expect(hierarchyLayout.nestedLeft - hierarchyLayout.rootLeft).toBeGreaterThanOrEqual(10);
  expect(hierarchyLayout.chapterLeft - hierarchyLayout.nestedLeft).toBeGreaterThanOrEqual(10);
  expect(Math.abs(hierarchyLayout.rootRight - hierarchyLayout.nestedRight)).toBeLessThanOrEqual(1);
  expect(Math.abs(hierarchyLayout.rootRight - hierarchyLayout.chapterRight)).toBeLessThanOrEqual(1);
  expect(Math.abs(hierarchyLayout.guideX - hierarchyLayout.connectorX)).toBeLessThanOrEqual(1);
  expect(hierarchyLayout.guideWidth).toBe(1);
  expect(hierarchyLayout.connectorWidth).toBeGreaterThanOrEqual(6);
  await expect(page.getByRole("status").filter({ hasText: "Gespeichert" })).toBeVisible({
    timeout: 10_000,
  });

  await page.reload();
  await waitForManuscriptReady(page);
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();
  const reloadedBinder = page.getByRole("complementary", { name: "Kapitel" });
  const reloadedA = reloadedBinder
    .getByRole("button", { name: /^Teil A, \d+ Kapitel:/ })
    .locator("xpath=../..");
  const reloadedB = reloadedA
    .getByRole("button", { name: /^Bogen B, \d+ Kapitel:/ })
    .locator("xpath=../..");
  await expect(reloadedB.getByRole("button", { name: chapterInArc })).toBeVisible();

  const dragToRoot = async (source: Locator) => {
    const sourceBounds = await source.boundingBox();
    if (!sourceBounds) throw new Error("Drag source is not visible");
    await page.mouse.move(
      sourceBounds.x + sourceBounds.width / 2,
      sourceBounds.y + sourceBounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(sourceBounds.x + sourceBounds.width / 2 + 10, sourceBounds.y + 8, {
      steps: 4,
    });
    const target = reloadedBinder.locator(".binder-root-drop");
    await expect(target).toHaveAttribute("aria-hidden", "false");
    const targetBounds = await target.boundingBox();
    if (!targetBounds) throw new Error("Root drop target is not visible during drag");
    await page.mouse.move(
      targetBounds.x + targetBounds.width / 2,
      targetBounds.y + targetBounds.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();
    await expect(target).toHaveAttribute("aria-hidden", "true");
  };

  const rootChapterSave = waitForSuccessfulManuscriptWrite(page);
  await dragToRoot(reloadedB.getByRole("button", { name: chapterInArc }));
  await rootChapterSave;
  const chapterAtRoot = reloadedBinder.getByRole("button", { name: chapterInArc });
  await expect(chapterAtRoot).toBeVisible();
  const isRootTreeItem = (item: Locator) =>
    item.evaluate(
      (element) =>
        element.closest(".binder-tree-entry")?.parentElement?.classList.contains("binder-tree") ??
        false,
    );
  expect(await isRootTreeItem(chapterAtRoot)).toBe(true);

  const reloadedBRow = reloadedBinder
    .getByRole("button", { name: /^Bogen B, \d+ Kapitel:/ })
    .locator("xpath=..");
  await reloadedBRow.hover();
  const rootFolderSave = waitForSuccessfulManuscriptWrite(page);
  await dragToRoot(reloadedBRow.locator('.binder-drag-handle[draggable="true"]'));
  await rootFolderSave;
  expect(await isRootTreeItem(reloadedBRow)).toBe(true);
  await expect(page.getByRole("status").filter({ hasText: "Gespeichert" })).toBeVisible({
    timeout: 10_000,
  });

  await page.reload();
  await waitForManuscriptReady(page);
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();
  const persistedBinder = page.getByRole("complementary", { name: "Kapitel" });
  const persistedChapter = persistedBinder.getByRole("button", { name: chapterInArc });
  const persistedFolderB = persistedBinder
    .getByRole("button", { name: /^Bogen B, \d+ Kapitel:/ })
    .locator("xpath=..");
  expect(await isRootTreeItem(persistedChapter)).toBe(true);
  expect(await isRootTreeItem(persistedFolderB)).toBe(true);
});

test("Kapitelordner bleiben auf kompakter Breite hierarchisch und bedienbar", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "compact",
    "Die kompakte Binder-Geometrie wird nur im 390px-Projekt geprüft.",
  );
  const compactManuscript = {
    chapters: [
      { id: "nested", title: "Kapitel in der tiefsten Ebene", body: "", note: "" },
      { id: "root", title: "Kapitel auf oberster Ebene", body: "", note: "" },
    ],
    structure: {
      folders: [
        { id: "level-0", title: "Erster sehr langer Abschnitt" },
        { id: "level-1", title: "Unterordner mit langem Titel" },
        { id: "level-2", title: "Feine Unterebene mit langem Titel" },
      ],
      items: [
        { id: "level-0-item", kind: "folder", folderId: "level-0", position: 0 },
        {
          id: "level-1-item",
          kind: "folder",
          folderId: "level-1",
          parentFolderId: "level-0",
          position: 0,
        },
        {
          id: "level-2-item",
          kind: "folder",
          folderId: "level-2",
          parentFolderId: "level-1",
          position: 0,
        },
        {
          id: "nested-item",
          kind: "chapter",
          chapterId: "nested",
          parentFolderId: "level-2",
          position: 0,
        },
        { id: "root-item", kind: "chapter", chapterId: "root", position: 1 },
      ],
    },
  } satisfies Manuscript;
  await page.route("**/api/manuscript*", (route) =>
    route.request().method() === "GET"
      ? fulfillManuscript(route, compactManuscript)
      : fulfillDocumentSave(route, 1),
  );
  await page.route("**/api/state*", (route) =>
    route.request().method() === "GET"
      ? fulfillStoryWorld(route, { nodes: [], edges: [] })
      : fulfillDocumentSave(route, 1),
  );
  await openBlankWorld(page);
  await page.getByRole("button", { name: "Kapitel", exact: true }).click();
  const binder = page.getByRole("dialog", { name: "Kapitel" });
  await expect(binder).toBeVisible();
  await binder.evaluate((dialog) =>
    Promise.all(
      dialog.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    ),
  );

  const chapterActionTrigger = binder.getByRole("button", { name: /Kapitelaktionen:/ });
  const chapterActionGeometry = await chapterActionTrigger.evaluate((trigger) => {
    const dialog = trigger.closest<HTMLElement>('[role="dialog"]');
    const row = trigger.closest<HTMLElement>(".binder-chapter-row");
    if (!dialog || !row) throw new Error("Kontextuelle Kapitelaktion fehlt");
    const dialogBounds = dialog.getBoundingClientRect();
    const rowBounds = row.getBoundingClientRect();
    const bounds = trigger.getBoundingClientRect();
    const hit = document.elementFromPoint(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2,
    );
    return {
      dialogClientWidth: dialog.clientWidth,
      dialogScrollWidth: dialog.scrollWidth,
      rowClientWidth: row.clientWidth,
      rowScrollWidth: row.scrollWidth,
      width: bounds.width,
      height: bounds.height,
      insideRow: bounds.left >= rowBounds.left - 0.5 && bounds.right <= rowBounds.right + 0.5,
      insideDialog:
        bounds.left >= dialogBounds.left - 0.5 && bounds.right <= dialogBounds.right + 0.5,
      hit: hit === trigger || (hit instanceof Node && trigger.contains(hit)),
      hitElement:
        hit instanceof HTMLElement
          ? `${hit.tagName.toLowerCase()}.${[...hit.classList].join(".")}`
          : String(hit),
    };
  });
  expect(chapterActionGeometry.dialogScrollWidth).toBeLessThanOrEqual(
    chapterActionGeometry.dialogClientWidth + 1,
  );
  expect(chapterActionGeometry.rowScrollWidth).toBeLessThanOrEqual(
    chapterActionGeometry.rowClientWidth + 1,
  );
  expect(chapterActionGeometry.width).toBeCloseTo(44, 0);
  expect(chapterActionGeometry.height).toBeCloseTo(44, 0);
  expect(chapterActionGeometry.insideRow).toBe(true);
  expect(chapterActionGeometry.insideDialog).toBe(true);
  expect(
    chapterActionGeometry.hit,
    `Kapitelaktion wird nach abgeschlossener Sheet-Animation von ${chapterActionGeometry.hitElement} überlagert`,
  ).toBe(true);

  await chapterActionTrigger.click();
  const compactChapterMenu = page.getByRole("menu", { name: /Kapitelaktionen:/ });
  for (const item of ["Nach oben", "Nach unten", "Kapitel als Markdown", "Kapitel löschen"]) {
    const menuItem = compactChapterMenu.getByRole("menuitem", { name: item, exact: true });
    await expect(menuItem).toBeVisible();
    const itemHeight = await menuItem.evaluate((element) => element.getBoundingClientRect().height);
    expect(itemHeight, `${item} ist kompakt kein 44px-Touchziel`).toBeGreaterThanOrEqual(44);
  }
  await compactChapterMenu.press("Escape");
  await expect(chapterActionTrigger).toBeFocused();

  const rootRow = binder
    .getByRole("button", { name: /^Erster sehr langer Abschnitt, \d+ Kapitel:/ })
    .locator("xpath=..");
  const levelOneRow = binder
    .getByRole("button", { name: /^Unterordner mit langem Titel, \d+ Kapitel:/ })
    .locator("xpath=..");
  const levelTwoRow = binder
    .getByRole("button", { name: /^Feine Unterebene mit langem Titel, \d+ Kapitel:/ })
    .locator("xpath=..");
  const geometry = await Promise.all(
    [rootRow, levelOneRow, levelTwoRow].map((row) =>
      row.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const handle = element.querySelector<HTMLElement>(".binder-drag-handle");
        const toggle = element.querySelector<HTMLElement>(".binder-folder-toggle");
        const name = element.querySelector<HTMLElement>(".binder-folder-name");
        const actions = [...element.querySelectorAll<HTMLElement>(".binder-folder-action")].filter(
          (action) => getComputedStyle(action).display !== "none",
        );
        return {
          left: bounds.left,
          right: bounds.right,
          overflows: element.scrollWidth > element.clientWidth + 1,
          handleDisplay: handle ? getComputedStyle(handle).display : "missing",
          handleWidth: handle?.getBoundingClientRect().width ?? 0,
          toggleHeight: toggle?.getBoundingClientRect().height ?? 0,
          nameWidth: name?.getBoundingClientRect().width ?? 0,
          nameEllipses: Boolean(name && name.scrollWidth > name.clientWidth),
          actionSizes: actions.map((action) => {
            const actionBounds = action.getBoundingClientRect();
            return { width: actionBounds.width, height: actionBounds.height };
          }),
        };
      }),
    ),
  );

  expect(geometry[1].left - geometry[0].left).toBeGreaterThanOrEqual(9);
  expect(geometry[2].left - geometry[1].left).toBeGreaterThanOrEqual(9);
  for (const row of geometry) {
    expect(Math.abs(row.right - geometry[0].right)).toBeLessThanOrEqual(1);
    expect(row.overflows).toBe(false);
    expect(row.handleDisplay).toBe("none");
    expect(row.handleWidth).toBe(0);
    // Chromium may expose a 44 CSS-pixel target a fraction below 44 after
    // device-scale rounding. Keep the suite's established 0.5px geometry tolerance.
    expect(row.toggleHeight + 0.5).toBeGreaterThanOrEqual(44);
    expect(row.actionSizes).toHaveLength(2);
    expect(row.actionSizes.every((size) => size.width + 0.5 >= 44 && size.height + 0.5 >= 44)).toBe(
      true,
    );
  }
  expect(geometry[0].nameWidth).toBeGreaterThanOrEqual(80);
  expect(geometry[1].nameWidth).toBeGreaterThanOrEqual(72);
  expect(geometry[2].nameWidth).toBeGreaterThanOrEqual(64);
  expect(geometry[2].nameEllipses).toBe(true);

  const nestedChapter = binder
    .locator(".binder-chapter-row")
    .filter({ hasText: "Kapitel in der tiefsten Ebene" });
  const chapterGeometry = await nestedChapter.evaluate((row) => {
    const handle = row.querySelector<HTMLElement>(".binder-drag-handle");
    return {
      overflows: row.scrollWidth > row.clientWidth + 1,
      handleWidth: handle?.getBoundingClientRect().width ?? 0,
    };
  });
  expect(chapterGeometry.overflows).toBe(false);
  expect(chapterGeometry.handleWidth).toBe(0);
});

test("Shortcuts unterscheiden Speichern und Sicherung", async ({ page }) => {
  // Der Test prüft die zwei Tastenkürzel, nicht das Hochladen. Er behauptete früher
  // zusätzlich, ein eingerichteter Endpunkt mache "Sichern & hochladen" aktiv -- das
  // gilt nicht mehr: der Endpunkt verlangt eine Anmeldung, und ohne sie liefe der
  // Upload in ein 401. Der Dialog bietet dann die Anmeldung an statt eines Knopfes,
  // der scheitern würde. Dass der Upload nach Anmeldung wirklich auslöst, steht als
  // Einheitentest in packages/client/src/modules/history/SnapshotDialog.test.tsx, wo der Anmeldezustand
  // ohne echten Keycloak herstellbar ist.
  await openBlankWorld(page, "Testwelt", "https://backup.example.com/shortcut-test");
  await page.keyboard.press("Control+Shift+S");
  const dialog = page.getByRole("dialog", { name: /Arbeitsstand sichern/ });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Was hat sich geändert?").fill("Zwischenstand aus dem Test");
  // Lokal sichern braucht keinen Endpunkt und keine Anmeldung -- das ist der Weg,
  // der immer offensteht, und deshalb der belastbare Beleg, dass der Dialog lebt.
  await expect(dialog.getByRole("button", { name: "Nur lokal sichern" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+S");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Lokaler Assistent übernimmt Weltpflege nur bestätigt und als einen Undo-Schritt", async ({
  page,
}) => {
  await page.route("**/api/assistant/status*", (route) =>
    route.fulfill({ json: { ok: true, available: true, mode: "local", reason: "", chunks: 7 } }),
  );
  await page.route("**/api/assistant/jobs", (route) =>
    route.fulfill({
      json: {
        ok: true,
        created: true,
        job: {
          id: "job-e2e",
          status: "completed",
          error: "",
          errorType: "",
          cancelRequested: false,
          createdAt: "2026-08-21T12:00:00Z",
          result: {
            ok: true,
            message: "Ich habe Ada, Bela und ihre Beziehung als Vorschläge vorbereitet.",
            sources: [
              {
                id: "chapter:c1:0",
                kind: "chapter",
                title: "Erstes Kapitel",
                text: "Ada begegnet Bela.",
                target: { workspace: "text", id: "c1" },
              },
            ],
            proposals: [
              {
                kind: "create_element",
                tempId: "new:ada",
                element: { type: "person", name: "Ada", label: "Archivarin" },
              },
              {
                kind: "create_element",
                tempId: "new:bela",
                element: { type: "person", name: "Bela", label: "Regent" },
              },
              {
                kind: "create_relationship",
                relationship: {
                  from: "new:ada",
                  to: "new:bela",
                  label: "Misstrauen",
                  directed: false,
                },
              },
            ],
          },
        },
      },
    }),
  );
  await openBlankWorld(page);
  await page.getByRole("button", { name: "Lokalen Assistenten öffnen" }).click();
  const drawer =
    (page.viewportSize()?.width || 0) < 720
      ? page.getByRole("dialog", { name: "Lokaler Assistent" })
      : page.getByRole("complementary", { name: "Lokaler Assistent" });
  await expect(drawer).toContainText("7 Quellen indexiert");
  const assistantPanel =
    (page.viewportSize()?.width || 0) < 720 ? drawer.locator(".assistant-drawer") : drawer;
  // Unter 720px fährt der Assistent als Bottom-Sheet ein. Eine einmalige Messung trifft sonst die
  // laufende Animation, deshalb wird bis zum Stillstand gepollt statt einmal abgefragt.
  await expect
    .poll(async () => {
      const drawerBox = await assistantPanel.boundingBox(),
        composerBox = await assistantPanel.locator("footer").boundingBox();
      return drawerBox && composerBox
        ? Math.abs(composerBox.y + composerBox.height - (drawerBox.y + drawerBox.height)) < 1
        : false;
    })
    .toBe(true);
  await drawer
    .getByRole("textbox", { name: "Nachricht an den lokalen Assistenten" })
    .fill("Lege Ada und Bela mit ihrer Beziehung an.");
  await drawer.getByRole("button", { name: "Nachricht senden" }).click();
  await expect(drawer).toContainText("Erstes Kapitel");
  await drawer.getByRole("button", { name: "Alle übernehmen" }).click();
  await expect(page.locator(".story-node")).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".story-node")).toHaveCount(0);
});

test("Befehlspalette führt alle sichtbaren Aktionen atomar aus", async ({ page }) => {
  await openBlankWorld(page);
  const open = async () => {
    await page.keyboard.press("Control+KeyK");
    await expect(page.getByRole("heading", { name: "Suchen & Befehle" })).toBeVisible();
  };
  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  await open();
  await page
    .getByRole("dialog")
    .getByRole("option", { name: /Zum Manuskript wechseln/ })
    .click();
  await expect(page.getByRole("button", { name: "Text", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await open();
  await page
    .getByRole("dialog")
    .getByRole("option", { name: /Zum Figurenboard wechseln/ })
    .click();
  await expect(page.getByRole("button", { name: "Figuren", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await open();
  await page
    .getByRole("dialog")
    .getByRole("option", { name: /Fokusmodus umschalten/ })
    .click();
  await expect(page.getByRole("button", { name: /Fokusmodus verlassen/ })).toBeVisible();
  await page.keyboard.press("Escape");
  for (const command of ["Verlauf öffnen", "Sicherung öffnen", "Sicherungen öffnen"]) {
    await open();
    await page
      .getByRole("dialog")
      .getByRole("option", { name: new RegExp(command) })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /schließen/i })
      .click();
  }
});

test("Inhaltssuche und Befehle teilen eine Palette", async ({ page }) => {
  await openBlankWorld(page);
  await page.keyboard.press("Control+KeyF");
  await expect(page.getByRole("heading", { name: "Suchen & Befehle" })).toBeVisible();
  await expect(page.getByText("Zum Manuskript wechseln")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+KeyK");
  await expect(page.getByRole("heading", { name: "Suchen & Befehle" })).toBeVisible();
  await expect(page.getByText("Zum Manuskript wechseln")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  if ((page.viewportSize()?.width || 0) > 640) {
    await page.getByRole("button", { name: "Element", exact: true }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.getByText(/Elemente ·/).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.getByRole("region", { name: "Timeline" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Noch keine Timeline" })).toBeVisible();
  await page.getByRole("button", { name: "Zeitpunkt hinzufügen" }).click();
  await expect(page.getByRole("heading", { name: "Neuer Zeitpunkt" })).toBeVisible();
  if ((page.viewportSize()?.width || 0) > 640)
    await expect(page.getByRole("navigation", { name: "Timeline" })).toBeVisible();
  else await expect(page.getByText("1 von 1")).toBeVisible();
  await expect(page.getByText("Nur Änderungen")).toBeVisible();
});

test("Notizreferenzen und flexible Profilfelder bleiben nach Umbenennung stabil", async ({
  page,
}, testInfo) => {
  test.setTimeout(40_000);
  test.skip(
    testInfo.project.name !== "wide",
    "Referenzpersistenz und Zielnavigation hängen nicht an der Fensterbreite.",
  );

  const world = await createTestWorld(page, `Notizreferenz ${crypto.randomUUID()}`);
  const worldId = encodeURIComponent(world.id);
  const initial = await page.request.get(`/api/state?world=${worldId}`);
  const revision = initial.headers().etag || '"0"';
  const saved = await page.request.put(`/api/state?world=${worldId}`, {
    headers: { "If-Match": revision },
    data: encodeStoryWorldDocument(
      {
        nodes: [
          {
            id: "note-owner",
            x: 120,
            y: 120,
            type: "person",
            name: "Erzählerin",
            profile: {
              notizen: "",
              fields: [
                { id: "profile-age", key: "Alter", value: "42" },
                { id: "profile-favourite-place", key: "Lieblingsort", value: "Nordhafen" },
              ],
            },
          },
          { id: "harbour", x: 480, y: 260, type: "ort", name: "Hafen" },
        ],
        edges: [],
      },
      Number(revision.replaceAll('"', "")),
    ),
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto(`/?world=${worldId}`);
  await waitForManuscriptReady(page);
  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  await page.locator(".story-node").filter({ hasText: "Erzählerin" }).click();

  const figureInspector = page.getByRole("complementary", { name: "Figuren-Inspector" });
  await figureInspector.getByRole("tab", { name: "Steckbrief" }).click();
  const ownerNote = figureInspector.locator('[data-note-owner="entity:note-owner"]');
  const noteEditor = ownerNote.getByRole("textbox", { name: "Notizen" });
  await noteEditor.fill("Treffen mit ");
  await noteEditor.pressSequentially("@Haf");

  const references = page.getByRole("listbox", { name: "Referenz auswählen" });
  await expect(references).toBeVisible();
  const referenceSave = waitForSuccessfulStoryWorldWrite(page, '"surface":"Hafen"');
  await references.getByRole("option", { name: /Hafen/ }).click();
  await referenceSave;
  await expect(references).toHaveCount(0);
  await expect(ownerNote).toContainText("Treffen mit Hafen");
  await expect(ownerNote.getByRole("button", { name: "Hafen", exact: true })).toBeVisible();

  await expect(figureInspector.getByRole("textbox", { name: "Alter Inhalt" })).toHaveValue("42");
  await expect(
    figureInspector.getByRole("textbox", { name: "Feldname: Lieblingsort" }),
  ).toHaveValue("Lieblingsort");
  await expect(figureInspector.getByRole("textbox", { name: "Lieblingsort Inhalt" })).toHaveValue(
    "Nordhafen",
  );

  await page.getByRole("button", { name: "Orte", exact: true }).click();
  await page.locator(".places-workspace .story-node").filter({ hasText: "Hafen" }).click();
  const placeInspector = page.getByRole("complementary", { name: "Orte-Inspector" });
  const placeName = placeInspector.getByRole("textbox", { name: "Name" });
  const renameDialog = page.getByRole("alertdialog", { name: "Manuskript aktualisieren?" });
  const renameSave = waitForSuccessfulStoryWorldWrite(page, "Nordhafen");
  await placeName.click();
  await placeName.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await placeName.pressSequentially("Nordhafen");
  await expect(placeName).toHaveValue("Nordhafen");
  await expect(renameDialog).toHaveCount(0);
  await placeName.press("Tab");
  await expect(renameDialog).toBeVisible();
  await expect(renameDialog).toHaveCount(1);
  await expect(renameDialog).toContainText(
    "„Hafen“ wurde in „Nordhafen“ umbenannt. Sollen alle verknüpften Vorkommen im Manuskript ersetzt werden?",
  );
  await renameDialog.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await renameSave;

  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  await page.locator(".story-node").filter({ hasText: "Erzählerin" }).click();
  await figureInspector.getByRole("tab", { name: "Steckbrief" }).click();
  await expect(ownerNote).toContainText("Treffen mit Hafen");
  await expect(figureInspector.getByRole("textbox", { name: "Alter Inhalt" })).toHaveValue("42");
  await expect(
    figureInspector.getByRole("textbox", { name: "Feldname: Lieblingsort" }),
  ).toHaveValue("Lieblingsort");
  await expect(figureInspector.getByRole("textbox", { name: "Lieblingsort Inhalt" })).toHaveValue(
    "Nordhafen",
  );

  const persistedReference = ownerNote.getByRole("button", { name: "Nordhafen", exact: true });
  await expect(persistedReference).toBeVisible();
  await persistedReference.click();

  await expect(page.getByRole("button", { name: "Orte", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page
      .getByRole("complementary", { name: "Orte-Inspector" })
      .getByRole("textbox", { name: "Name" }),
  ).toHaveValue("Nordhafen");
});

test("eine echte Figuren-Beziehung nutzt den gemeinsamen Kanten-Editor und bleibt erhalten", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Kantenauswahl und Persistenz müssen nur in einem stabilen Desktop-Viewport laufen.",
  );

  const world = await createTestWorld(page, `Figuren-Kanteneditor ${crypto.randomUUID()}`);
  const relationshipId = "relationship-editor-e2e";
  const label = `vertraut ${crypto.randomUUID()}`;
  const initial = await page.request.get(`/api/state?world=${world.id}`);
  const revision = initial.headers().etag || '"0"';
  const saved = await page.request.put(`/api/state?world=${encodeURIComponent(world.id)}`, {
    headers: { "If-Match": revision },
    data: encodeStoryWorldDocument(
      {
        nodes: [
          { id: "figure-ada", x: 120, y: 120, type: "person", name: "Ada" },
          { id: "figure-bela", x: 520, y: 280, type: "person", name: "Bela" },
        ],
        edges: [
          {
            id: relationshipId,
            from: "figure-ada",
            to: "figure-bela",
            label: "kennt",
            active: true,
            gerichtet: false,
          },
        ],
      },
      Number(revision.replaceAll('"', "")),
    ),
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto(`/?world=${world.id}`);
  await waitForManuscriptReady(page);
  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  await expect(page.locator(".story-node")).toHaveCount(2);

  // Select only the persisted relationship. Journey and presence overlays use synthetic IDs and
  // must never open this editor.
  const relationship = page.locator(`.react-flow__edge[data-id="${relationshipId}"]`);
  await clickVisibleGraphEdge(page, relationship);

  const inspector = page.getByRole("region", { name: "Beziehung", exact: true });
  await expect(inspector).toContainText("Ada ↔ Bela");
  const inspectorBox = await inspector.boundingBox();
  const minimapBox = await page.locator(".react-flow__minimap").boundingBox();
  const surfacesOverlap = (
    first: NonNullable<typeof inspectorBox>,
    second: NonNullable<typeof inspectorBox>,
  ) =>
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y;
  expect(inspectorBox && minimapBox && surfacesOverlap(inspectorBox, minimapBox)).toBeFalsy();

  const labelSaved = waitForSuccessfulStoryWorldWrite(page, label);
  await inspector.getByRole("textbox", { name: "Beziehung benennen" }).fill(label);
  const labelResponse = await labelSaved;
  const labelledEdge = (
    labelResponse.request().postDataJSON() as {
      payload: { edges: Array<{ id: string; label?: string }> };
    }
  ).payload.edges.find((edge) => edge.id === relationshipId);
  expect(labelledEdge).toMatchObject({ id: relationshipId, label });
  await expect(page.getByRole("status")).toContainText("Gespeichert");

  const lineStyleSaved = waitForSuccessfulStoryWorldWrite(page, '"lineStyle":"dotted"');
  const lineStyleControl = inspector.getByRole("combobox", { name: "Linienart" });
  await lineStyleControl.focus();
  await lineStyleControl.press("ArrowDown");
  await expect(page.getByRole("listbox", { name: "Linienart" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Durchgezogen" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("option", { name: "Gepunktet" })).toBeFocused();
  await page.keyboard.press("Enter");
  await lineStyleSaved;

  const kinshipSaved = waitForSuccessfulStoryWorldWrite(page, '"relationshipKind":"kinship"');
  await inspector.getByRole("checkbox", { name: "Verwandtschaft" }).check();
  await kinshipSaved;

  const directedSaved = waitForSuccessfulStoryWorldWrite(page, '"gerichtet":true');
  await inspector.getByRole("checkbox", { name: "Gerichtet" }).check();
  const directedResponse = await directedSaved;
  const directedEdge = (
    directedResponse.request().postDataJSON() as {
      payload: {
        edges: Array<{
          id: string;
          from: string;
          to: string;
          label?: string;
          gerichtet?: boolean;
          lineStyle?: string;
          relationshipKind?: string;
        }>;
      };
    }
  ).payload.edges.find((edge) => edge.id === relationshipId);
  expect(directedEdge).toMatchObject({
    from: "figure-ada",
    to: "figure-bela",
    label,
    gerichtet: true,
    lineStyle: "dotted",
    relationshipKind: "kinship",
  });
  await expect(inspector).toContainText("Ada → Bela");

  const reversedSaved = waitForSuccessfulStoryWorldWrite(page, label);
  await inspector.getByRole("button", { name: "Richtung umkehren" }).click();
  const reversedResponse = await reversedSaved;
  const reversedEdge = (
    reversedResponse.request().postDataJSON() as {
      payload: {
        edges: Array<{ id: string; from: string; to: string; label?: string; gerichtet?: boolean }>;
      };
    }
  ).payload.edges.find((edge) => edge.id === relationshipId);
  expect(reversedEdge).toMatchObject({
    from: "figure-bela",
    to: "figure-ada",
    label,
    gerichtet: true,
  });
  await expect(inspector).toContainText("Bela → Ada");
  await expect(relationship.locator(".react-flow__edge-path")).toHaveAttribute(
    "marker-end",
    /url\(['"]?#/,
  );
  await expect(page.getByRole("status")).toContainText("Gespeichert");

  await page.reload();
  await waitForManuscriptReady(page);
  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  await expect(page.locator(".graph-edge-label")).toContainText(label);
  await expect(page.locator(".graph-edge-label [data-edge-label-badge=kinship]")).toBeVisible();
  await expect(page.locator(`.react-flow__edge[data-id="${relationshipId}"]`)).toHaveClass(
    /edge-line-dotted/,
  );
  await expect(
    page.locator(`.react-flow__edge[data-id="${relationshipId}"] .react-flow__edge-path`),
  ).toHaveAttribute("marker-end", /url\(['"]?#/);

  const persistedResponse = await page.request.get(`/api/state?world=${world.id}`);
  expect(persistedResponse.ok()).toBeTruthy();
  const persistedEdge = (
    (await persistedResponse.json()) as {
      payload: {
        edges: Array<{
          id: string;
          from: string;
          to: string;
          label?: string;
          gerichtet?: boolean;
          lineStyle?: string;
          relationshipKind?: string;
        }>;
      };
    }
  ).payload.edges.find((edge) => edge.id === relationshipId);
  expect(persistedEdge).toMatchObject(reversedEdge ?? {});
});

test("Figuren folgen dem Zeiger bereits während des Ziehens", async ({ page }) => {
  await page.route("**/api/manuscript*", (route) =>
    fulfillManuscript(route, {
      chapters: [{ id: "c1", title: "Test", body: "", note: "" }],
    }),
  );
  await page.route("**/api/state*", (route) =>
    route.request().method() === "GET"
      ? fulfillStoryWorld(route, {
          nodes: [{ id: "n1", x: 100, y: 100, type: "person", name: "Testfigur" }],
          edges: [],
        })
      : fulfillDocumentSave(route, 1),
  );
  await openBlankWorld(page);
  await page.getByRole("button", { name: "Figuren" }).click();
  const node = page.locator(".react-flow__node").first();
  const box = await node.boundingBox();
  expect(box).not.toBeNull();
  const before = await node.getAttribute("style");
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 90, box!.y + box!.height / 2 + 45, { steps: 6 });
  await expect.poll(() => node.getAttribute("style")).not.toBe(before);
  await page.mouse.up();
});

test("Beim Ziehen einer Figuren-Verbindung folgt eine sichtbare Vorschau dem Zeiger", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Der Pointer- und LOD-Regressionstest hängt nicht an der Fensterbreite.",
  );
  await page.route("**/api/manuscript*", (route) =>
    fulfillManuscript(route, {
      chapters: [{ id: "c1", title: "Test", body: "", note: "" }],
    }),
  );
  await page.route("**/api/state*", (route) =>
    route.request().method() === "GET"
      ? fulfillStoryWorld(route, {
          nodes: [
            { id: "n1", x: 100, y: 100, type: "person", name: "Ada" },
            // A large board forces overview LOD. That is where the viewport transform used
            // to scale React Flow's default 1px preview into an effectively invisible line.
            { id: "n2", x: 10_000, y: 2_000, type: "person", name: "Bela" },
          ],
          edges: [],
        })
      : fulfillDocumentSave(route, 1),
  );
  await openBlankWorld(page);
  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  await expect(page.locator(".flow-area")).toHaveClass(/zoom-overview/);

  const source = page.locator('.react-flow__node[data-id="n1"] .outgoing-handle');
  const sourceBox = await source.boundingBox();
  if (!sourceBox) throw new Error("Ausgangs-Handle hat keine messbare Geometrie");
  const sourcePoint = {
    x: sourceBox.x + sourceBox.width / 2,
    y: sourceBox.y + sourceBox.height / 2,
  };
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.classList.contains("outgoing-handle"),
      sourcePoint,
    ),
  ).toBe(true);
  await page.mouse.move(sourcePoint.x, sourcePoint.y);
  await page.mouse.down({ button: "left" });

  const firstPointer = { x: sourcePoint.x + 150, y: sourcePoint.y + 70 };
  await page.mouse.move(firstPointer.x, firstPointer.y, { steps: 5 });

  const preview = page.locator(".react-flow__connectionline .react-flow__connection-path");
  await expect(preview).toBeVisible();
  const previewGeometry = (pointer: { x: number; y: number }) =>
    preview.evaluate(
      (path, points) => {
        if (!(path instanceof SVGPathElement)) {
          throw new Error("Verbindungsvorschau ist kein SVG-Pfad");
        }
        const matrix = path.getScreenCTM();
        if (!matrix) throw new Error("Verbindungsvorschau hat keine Screen-Transformation");
        const totalLength = path.getTotalLength();
        const toScreen = (point: DOMPoint) => point.matrixTransform(matrix);
        const start = toScreen(path.getPointAtLength(0));
        const end = toScreen(path.getPointAtLength(totalLength));
        let screenLength = 0;
        let previous = start;
        for (let index = 1; index <= 24; index += 1) {
          const current = toScreen(path.getPointAtLength((totalLength * index) / 24));
          screenLength += Math.hypot(current.x - previous.x, current.y - previous.y);
          previous = current;
        }
        const style = getComputedStyle(path);
        const opacity = [path, path.parentElement, path.ownerSVGElement].reduce(
          (value, element) => {
            if (!element) return value;
            const current = Number.parseFloat(getComputedStyle(element).opacity || "1");
            return value * (Number.isFinite(current) ? current : 1);
          },
          1,
        );
        const strokeOpacity = Number.parseFloat(style.strokeOpacity || "1");
        const transparentStroke =
          style.stroke === "none" ||
          style.stroke === "transparent" ||
          /rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(style.stroke) ||
          /rgb\([^)]*\/\s*0(?:%|\b)/.test(style.stroke);
        const distance = (left: DOMPoint, right: { x: number; y: number }) =>
          Math.hypot(left.x - right.x, left.y - right.y);
        return {
          d: path.getAttribute("d"),
          totalLength,
          screenLength,
          start: { x: start.x, y: start.y },
          end: { x: end.x, y: end.y },
          startDistance: distance(start, points.source),
          pointerDistance: distance(end, points.pointer),
          stroke: style.stroke,
          strokeWidth: Number.parseFloat(style.strokeWidth),
          effectiveOpacity: opacity * (Number.isFinite(strokeOpacity) ? strokeOpacity : 1),
          transparentStroke,
          display: style.display,
          visibility: style.visibility,
          vectorEffect: style.vectorEffect,
        };
      },
      { pointer, source: sourcePoint },
    );

  const firstPreview = await previewGeometry(firstPointer);
  expect(firstPreview.d).toMatch(/^M/);
  expect(firstPreview.totalLength).toBeGreaterThan(80);
  expect(firstPreview.screenLength).toBeGreaterThan(80);
  expect(firstPreview.startDistance).toBeLessThanOrEqual(8);
  expect(firstPreview.pointerDistance).toBeLessThanOrEqual(8);
  expect(firstPreview.stroke).not.toBe("none");
  expect(firstPreview.transparentStroke).toBe(false);
  expect(firstPreview.strokeWidth).toBeGreaterThanOrEqual(2);
  expect(firstPreview.effectiveOpacity).toBeGreaterThan(0.5);
  expect(firstPreview.display).not.toBe("none");
  expect(firstPreview.visibility).toBe("visible");
  expect(firstPreview.vectorEffect).toBe("non-scaling-stroke");

  const secondPointer = { x: sourcePoint.x + 240, y: sourcePoint.y + 130 };
  await page.mouse.move(secondPointer.x, secondPointer.y, { steps: 5 });
  await expect.poll(() => preview.getAttribute("d")).not.toBe(firstPreview.d);
  const secondPreview = await previewGeometry(secondPointer);
  expect(secondPreview.screenLength).toBeGreaterThan(firstPreview.screenLength);
  expect(secondPreview.startDistance).toBeLessThanOrEqual(8);
  expect(secondPreview.pointerDistance).toBeLessThanOrEqual(8);
  expect(
    Math.hypot(secondPreview.end.x - firstPreview.end.x, secondPreview.end.y - firstPreview.end.y),
  ).toBeGreaterThan(80);

  await page.mouse.up();
  await expect(preview).toHaveCount(0);
});

test("Minimap unterscheidet Elementarten und das Raster lässt sich lösen", async ({ page }) => {
  await page.route("**/api/manuscript*", (route) =>
    fulfillManuscript(route, {
      chapters: [{ id: "c1", title: "Test", body: "", note: "" }],
    }),
  );
  await page.route("**/api/state*", (route) =>
    route.request().method() === "GET"
      ? fulfillStoryWorld(route, {
          nodes: [
            { id: "n1", x: 101, y: 101, type: "person", name: "Figur" },
            { id: "n2", x: 401, y: 101, type: "ort", name: "Ort" },
            { id: "n3", x: 701, y: 101, type: "konzept", name: "Konzept" },
          ],
          edges: [],
        })
      : fulfillDocumentSave(route, 1),
  );
  await openBlankWorld(page);
  await page.getByRole("button", { name: "Figuren", exact: true }).click();

  const minimapNodes = page.locator(".react-flow__minimap-node");
  await expect(minimapNodes).toHaveCount(3);
  // React Flow may briefly omit minimap rects while its measured node bounds settle.
  // Poll color and geometry atomically instead of sampling between those two render frames.
  let minimapNodePresentation: Array<{ fill: string; width: number; height: number }> = [];
  await expect
    .poll(async () => {
      minimapNodePresentation = await minimapNodes.evaluateAll((nodes) =>
        nodes.map((node) => ({
          fill: getComputedStyle(node).fill,
          width: Number(node.getAttribute("width")),
          height: Number(node.getAttribute("height")),
        })),
      );
      return {
        count: minimapNodePresentation.length,
        distinctColors: new Set(minimapNodePresentation.map((node) => node.fill)).size,
        measured: minimapNodePresentation.every((node) => node.width > 0 && node.height > 0),
      };
    })
    .toEqual({ count: 3, distinctColors: 3, measured: true });
  const minimapNodeGeometry = minimapNodePresentation.map(({ width, height }) => ({
    width,
    height,
  }));
  const nodeGeometry = await page.locator(".story-node").evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return {
        tier: node.classList.contains("zoom-compact") ? "compact" : "detail",
        width: Number.parseFloat(style.width),
        height: Number.parseFloat(style.height),
        compactWidth: Number.parseFloat(style.getPropertyValue("--node-compact-width")),
        compactHeight: Number.parseFloat(style.getPropertyValue("--node-compact-touch-height")),
        visualWidth: box.width,
        visualHeight: box.height,
      };
    }),
  );
  const compactViewport = (page.viewportSize()?.width || 0) < 720;
  for (const [index, node] of nodeGeometry.entries()) {
    expect(minimapNodeGeometry[index].width).toBeCloseTo(node.width, 0);
    expect(minimapNodeGeometry[index].height).toBeCloseTo(node.height, 0);
    if (compactViewport) {
      expect(node.tier).toBe("compact");
      expect(node.width).toBeCloseTo(node.compactWidth, 1);
      expect(node.height).toBeCloseTo(node.compactHeight, 1);
      expect(node.width).toBeGreaterThanOrEqual(200);
      expect(node.height).toBeGreaterThanOrEqual(68);
      expect(node.visualWidth).toBeGreaterThanOrEqual(96);
      expect(node.visualHeight).toBeGreaterThanOrEqual(44);
    } else {
      expect(node.tier).toBe("detail");
      expect(node.width).toBe(200);
      expect(node.height).toBe(96);
    }
  }
  await expect(page.locator(".react-flow__background path")).toHaveCount(1);
  await page.getByRole("button", { name: "Ansicht", exact: true }).click();
  await page.getByRole("menuitem", { name: "Anordnen", exact: true }).click();
  await expect
    .poll(() => page.locator(".react-flow__node").first().getAttribute("style"))
    .toContain("translate(96px, 96px)");
  await page.getByRole("button", { name: "Ansicht", exact: true }).click();
  await page.getByRole("menuitem", { name: "Raster ausblenden", exact: true }).click();
  await expect(page.locator(".react-flow__background")).toHaveCount(0);

  const flowArea = page.locator(".figure-workspace .flow-area");
  const minimap = page.locator(".react-flow__minimap");
  await expect(minimap).toBeVisible();
  const flowBox = await flowArea.boundingBox();
  const minimapBeforeToggle = await minimap.boundingBox();
  expect(flowBox).not.toBeNull();
  expect(minimapBeforeToggle).not.toBeNull();
  expect(
    Math.abs(
      (flowBox?.x ?? 0) +
        (flowBox?.width ?? 0) -
        ((minimapBeforeToggle?.x ?? 0) + (minimapBeforeToggle?.width ?? 0)) -
        14,
    ),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      (flowBox?.y ?? 0) +
        (flowBox?.height ?? 0) -
        ((minimapBeforeToggle?.y ?? 0) + (minimapBeforeToggle?.height ?? 0)) -
        14,
    ),
  ).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Übersichtskarte ausblenden" }).click();
  await expect(minimap).toHaveCount(0);
  await page.getByRole("button", { name: "Übersichtskarte einblenden" }).click();
  await expect(minimap).toBeVisible();
  const minimapAfterToggle = await minimap.boundingBox();
  expect(
    Math.abs((minimapAfterToggle?.x ?? 0) - (minimapBeforeToggle?.x ?? 0)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs((minimapAfterToggle?.y ?? 0) - (minimapBeforeToggle?.y ?? 0)),
  ).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Ansicht", exact: true }).click();
  await page.getByRole("menuitem", { name: "Zeit einblenden", exact: true }).click();
  const minimapWithTimeline = await minimap.boundingBox();
  const timeline = await page.getByLabel("Beziehungen über die Zeit").boundingBox();
  const controls = await page.getByLabel("Kartensteuerung").boundingBox();
  const overlaps = (first: NonNullable<typeof timeline>, second: NonNullable<typeof timeline>) =>
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y;
  expect(
    Math.abs((minimapWithTimeline?.x ?? 0) - (minimapBeforeToggle?.x ?? 0)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs((minimapWithTimeline?.y ?? 0) - (minimapBeforeToggle?.y ?? 0)),
  ).toBeLessThanOrEqual(1);
  expect(timeline && minimapWithTimeline && overlaps(timeline, minimapWithTimeline)).toBeFalsy();
  expect(timeline && controls && overlaps(timeline, controls)).toBeFalsy();
});

test("Verschieben erhält alle Elemente auch nach Autosave und Neuladen", async ({ page }) => {
  // Der Test umfasst Seed, verzögertes Autosave und einen vollständigen Reload in drei Viewports.
  // Das zusätzliche Budget ersetzt kein Warten: der Persistenzschritt bleibt an die PUT-Response gebunden.
  test.setTimeout(45_000);
  const world = await createTestWorld(page, `Drag Regression ${crypto.randomUUID()}`);
  // Both calls name the world, exactly as the focused platform/http adapters do for every request:
  // creating a world no longer makes it the process's "active" one, so a request
  // that names none has no world at all and is answered with a 400.
  const initial = await page.request.get(`/api/state?world=${world.id}`);
  const revision = initial.headers()["etag"] || '"0"';
  const nodes = Array.from({ length: 12 }, (_, index) => ({
    id: `n${index}`,
    x: 100 + (index % 4) * 240,
    y: 100 + Math.floor(index / 4) * 150,
    type: "person" as const,
    name: `Figur ${index}`,
  }));
  const edges = Array.from({ length: 11 }, (_, index) => ({
    id: `e${index}`,
    from: `n${index}`,
    to: `n${index + 1}`,
    label: `Beziehung ${index}`,
    gerichtet: index % 2 === 0,
  }));
  const saved = await page.request.put(`/api/state?world=${encodeURIComponent(world.id)}`, {
    headers: { "If-Match": revision },
    data: encodeStoryWorldDocument({ nodes, edges }, Number(revision.replaceAll('"', ""))),
  });
  expect(saved.ok()).toBeTruthy();
  await page.goto(`/?world=${world.id}`);
  await waitForManuscriptReady(page);
  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  await expect(page.locator(".story-node")).toHaveCount(12);
  const node = page.locator(".react-flow__node").first();
  const box = await node.boundingBox();
  expect(box).not.toBeNull();
  const autosave = page.waitForResponse(
    (writeResponse) =>
      writeResponse.url().includes("/api/state") &&
      writeResponse.request().method() === "PUT" &&
      writeResponse.ok(),
  );
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 100, box!.y + box!.height / 2 + 70, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".story-node")).toHaveCount(12);
  await expect(page.locator(".react-flow__edge")).toHaveCount(11);
  await autosave;
  await page.reload();
  await waitForManuscriptReady(page);
  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  await expect(page.locator(".story-node")).toHaveCount(12);
});

test("Elementtypen sind konsistent erreichbar und Löschen bestätigt ohne Halten", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Der Löschweg muss nur in einer Breite geprüft werden.",
  );
  await openBlankWorld(page);
  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  await expect(page.getByRole("button", { name: "Element", exact: true })).toBeVisible();
  for (const label of ["Figur", "Ort", "Konzept", "Tier", "Organisation", "Objekt"])
    await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Element", exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem")).toHaveCount(6);
  for (const label of ["Tier", "Organisation", "Objekt"])
    await expect(page.getByRole("menuitem", { name: label, exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "Figur", exact: true }).click();
  await expect(page.locator(".story-node")).toHaveCount(1);
  // useHistoryState fasst Änderungen innerhalb von 650 ms zu einem Schritt zusammen. Ohne diese
  // Pause landeten Anlegen und Löschen im selben Schritt und das Undo sprang hinter beide zurück.
  await page.waitForTimeout(900);
  await page.locator(".story-node").click();
  await page.getByRole("button", { name: "Figur löschen" }).click();
  // Das Element hängt am Undo-Stack, also genügt hier eine Rückfrage: sie nennt den Rückweg und
  // bestätigt mit einem Klick. Das Halten bleibt den Aktionen vorbehalten, die niemand zurückholt.
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/rückgängig machen/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Abbrechen" })).toBeFocused();
  await dialog.getByRole("button", { name: "Element löschen" }).click();
  await expect(page.locator(".story-node")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".story-node")).toHaveCount(1);
});

test("Zeitstreifen spielt Beziehungsstände und Todeszeitpunkte ab", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "Die Timeline wird im breiten Figurenboard geprüft.");
  await page.route("**/api/manuscript*", (route) =>
    fulfillManuscript(route, {
      chapters: [{ id: "c1", title: "Test", body: "", note: "" }],
    }),
  );
  await page.route("**/api/state*", (route) =>
    route.request().method() === "GET"
      ? fulfillStoryWorld(route, {
          nodes: [
            { id: "n1", x: 120, y: 140, type: "person", name: "Ada" },
            { id: "n2", x: 520, y: 140, type: "person", name: "Bela" },
          ],
          edges: [
            { id: "e1", from: "n1", to: "n2", label: "Verbündete" },
            { id: "e2", from: "n2", to: "n1", label: "Bewundert", gerichtet: true },
          ],
        })
      : fulfillDocumentSave(route, 1),
  );
  await openBlankWorld(page);
  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  await expect(page.locator(".neutral-handle")).toHaveCount(4);
  await expect(page.locator(".incoming-handle")).toHaveCount(2);
  await expect(page.locator(".outgoing-handle")).toHaveCount(2);
  await expect(page.locator(".react-flow__edge.edge-undirected")).toHaveCount(1);
  await expect(page.locator(".react-flow__edge.edge-directed")).toHaveCount(1);
  const stableGeometry = async () =>
    Promise.all(
      (await page.locator(".story-node").all()).map(async (node) => {
        const box = await node.boundingBox();
        return box && { x: box.x, y: box.y, width: box.width, height: box.height };
      }),
    );
  const geometryBeforeTimeline = await stableGeometry();
  await page.locator(".story-node").filter({ hasText: "Bela" }).click();
  await page.getByRole("tab", { name: "Beziehungen" }).click();
  const undirectedRelationship = page
    .getByRole("region", { name: "Beziehung", exact: true })
    .filter({ hasText: "Ada ↔ Bela" });
  await expect(
    undirectedRelationship.getByRole("checkbox", { name: "Gerichtet" }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Richtung umkehren: Bela nach Ada" }).click();
  await expect(
    page.getByRole("button", { name: "Richtung umkehren: Ada nach Bela" }),
  ).toBeVisible();
  const controlsBeforeTimeline = await page.locator(".react-flow__controls").boundingBox();
  const minimapBeforeTimeline = await page.locator(".react-flow__minimap").boundingBox();
  await page.getByRole("button", { name: "Ansicht", exact: true }).click();
  await page.getByRole("menuitem", { name: "Zeit einblenden", exact: true }).click();
  const stripBox = await page.getByLabel("Beziehungen über die Zeit").boundingBox();
  const controlsBox = await page.locator(".react-flow__controls").boundingBox();
  const minimapBox = await page.locator(".react-flow__minimap").boundingBox();
  const overlap = (a: NonNullable<typeof stripBox>, b: NonNullable<typeof stripBox>) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  expect(controlsBox).toEqual(controlsBeforeTimeline);
  expect(minimapBeforeTimeline).not.toBeNull();
  expect(minimapBox).not.toBeNull();
  expect(stripBox && controlsBox && overlap(stripBox, controlsBox)).toBeFalsy();
  expect(stripBox && minimapBox && overlap(stripBox, minimapBox)).toBeFalsy();

  await page.getByLabel("Neuer Zeitpunkt").fill("Vor der Schlacht");
  await page.getByLabel("Datum des neuen Zeitpunkts").fill("1420-03-12");
  await page.getByRole("button", { name: "Zeitpunkt hinzufügen" }).click();
  expect(await stableGeometry()).toEqual(geometryBeforeTimeline);
  await page.locator(".story-node").filter({ hasText: "Ada" }).click();
  await page.getByRole("tab", { name: "Karte" }).click();
  await page.getByRole("button", { name: "Stirbt hier" }).click();
  await expect(page.locator(".story-node").filter({ hasText: "Ada" })).toHaveClass(/is-deceased/);

  await page.getByLabel("Neuer Zeitpunkt").fill("Nach der Schlacht");
  await page.getByRole("button", { name: "Zeitpunkt hinzufügen" }).click();
  expect(await stableGeometry()).toEqual(geometryBeforeTimeline);
  await page.getByRole("button", { name: "Zeitreise abspielen" }).click();
  await expect(page.getByRole("button", { name: "Zeitreise pausieren" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Vor der Schlacht" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(await stableGeometry()).toEqual(geometryBeforeTimeline);
});

test("Fokusmodus bietet eine diskrete Schreibhilfe", async ({ page }, testInfo) => {
  await openBlankWorld(page);
  await page.getByRole("button", { name: "Fokus", exact: true }).click();
  const helper = page.getByRole("complementary", { name: "Schreibhilfe im Fokusmodus" });
  await expect(helper).toBeVisible();
  await helper.getByRole("button", { name: "Schreibhilfe öffnen" }).click();
  await expect(helper).toContainText("Figuren & Orte");
  await expect(helper).toContainText("Sonderzeichen");
  await page.screenshot({ path: testInfo.outputPath("focus-helper.png"), fullPage: true });
});

test("Text-Randschalter bleiben mittig und nah am Satzspiegel", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Die Satzspiegel-Geometrie wird in der breiten Desktopansicht geprüft.",
  );
  await openBlankWorld(page);
  await page.getByRole("button", { name: "Neues Kapitel" }).click();
  const title = page.locator(".chapter-title");
  const initialTitleBox = await title.boundingBox();
  expect(initialTitleBox).not.toBeNull();
  const edgeGap = await page
    .locator(".text-layout")
    .evaluate((layout) =>
      Number.parseFloat(getComputedStyle(layout).getPropertyValue("--space-8")),
    );
  const closeChapters = page.getByRole("button", { name: "Kapitelnavigation schließen" });
  const closeAid = page.getByRole("button", { name: "Schreibhilfe schließen" });
  const chapters = page.getByRole("button", { name: "Kapitelnavigation öffnen" });
  const writingAid = page.getByRole("button", { name: "Schreibhilfe öffnen" });

  const expectStableTitle = async () => {
    const box = await title.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeCloseTo(initialTitleBox!.x, 0);
  };
  const expectLeftEdgeGap = async () => {
    const [titleBox, chapterBox] = await Promise.all([title.boundingBox(), chapters.boundingBox()]);
    expect(titleBox).not.toBeNull();
    expect(chapterBox).not.toBeNull();
    expect(titleBox!.x - (chapterBox!.x + chapterBox!.width)).toBeCloseTo(edgeGap, 0);
  };
  const expectRightEdgeGap = async () => {
    const [titleBox, aidBox] = await Promise.all([title.boundingBox(), writingAid.boundingBox()]);
    expect(titleBox).not.toBeNull();
    expect(aidBox).not.toBeNull();
    expect(aidBox!.x - (titleBox!.x + titleBox!.width)).toBeCloseTo(edgeGap, 0);
  };

  // Each one-sided state has a non-zero editor balance. The edge toggle must follow that offset
  // in the same frame; otherwise the text visibly jumps while the panel closes.
  await closeChapters.click();
  await expect(chapters).toBeVisible();
  await expectStableTitle();
  await expectLeftEdgeGap();
  await chapters.click();
  await expect(closeChapters).toBeVisible();
  await expectStableTitle();

  await closeAid.click();
  await expect(writingAid).toBeVisible();
  await expectStableTitle();
  await expectRightEdgeGap();
  await writingAid.click();
  await expect(closeAid).toBeVisible();
  await expectStableTitle();

  await closeChapters.click();
  await closeAid.click();
  await expect(chapters).toBeVisible();
  await expect(writingAid).toBeVisible();

  const [titleBox, chapterBox, aidBox, layoutBox] = await Promise.all([
    title.boundingBox(),
    chapters.boundingBox(),
    writingAid.boundingBox(),
    page.locator(".text-layout").boundingBox(),
  ]);
  expect(titleBox).not.toBeNull();
  expect(chapterBox).not.toBeNull();
  expect(aidBox).not.toBeNull();
  expect(layoutBox).not.toBeNull();
  expect(titleBox!.x - (chapterBox!.x + chapterBox!.width)).toBeCloseTo(edgeGap, 0);
  expect(aidBox!.x - (titleBox!.x + titleBox!.width)).toBeCloseTo(edgeGap, 0);
  expect(chapterBox!.y + chapterBox!.height / 2).toBeCloseTo(
    layoutBox!.y + layoutBox!.height / 2,
    0,
  );
  expect(aidBox!.y + aidBox!.height / 2).toBeCloseTo(layoutBox!.y + layoutBox!.height / 2, 0);
  await expect(writingAid.locator("svg")).toHaveClass(/lucide-panel-right/);

  await page.getByRole("button", { name: "Fokus", exact: true }).click();
  const focusTitle = await page.locator(".chapter-title").boundingBox();
  const focusChapters = await page
    .getByRole("button", { name: "Kapitelauswahl öffnen" })
    .boundingBox();
  const focusAid = await page.getByRole("button", { name: "Schreibhilfe öffnen" }).boundingBox();
  expect(focusTitle!.x - (focusChapters!.x + focusChapters!.width)).toBeCloseTo(edgeGap, 0);
  expect(focusAid!.x - (focusTitle!.x + focusTitle!.width)).toBeCloseTo(edgeGap, 0);
});

test("Fokus-Randpanels verändern Schreibfläche und Zeilenumbruch nicht", async ({ page }) => {
  await page.route("**/api/manuscript*", (route) =>
    route.request().method() === "GET"
      ? fulfillManuscript(route, {
          chapters: [
            {
              id: "c1",
              title: "Prolog",
              body: "Ein langer Absatz hält seinen Zeilenumbruch beim Öffnen der Randpanels stabil.",
              note: "",
            },
            { id: "c2", title: "Aufbruch", body: "Der Weg beginnt.", note: "" },
          ],
        })
      : route.continue(),
  );
  await openBlankWorld(page);
  await page.getByRole("button", { name: "Fokus", exact: true }).click();

  const editor = page.locator(".editor-page");
  const initial = await editor.boundingBox();
  expect(initial).not.toBeNull();

  await page.getByRole("button", { name: "Kapitelauswahl öffnen" }).click();
  const withChapters = await editor.boundingBox();
  expect(withChapters).toEqual(initial);
  const chapters = await page.locator(".focus-chapter-list").boundingBox();
  if ((page.viewportSize()?.width || 0) >= 1100)
    expect(chapters!.x + chapters!.width).toBeLessThanOrEqual(initial!.x);
  else expect(chapters!.x).toBeGreaterThanOrEqual(0);

  await page.getByRole("button", { name: "Schreibhilfe öffnen" }).click();
  const withBoth = await editor.boundingBox();
  expect(withBoth).toEqual(initial);
  const helper = await page.locator(".focus-helper-panel").boundingBox();
  if ((page.viewportSize()?.width || 0) >= 1100)
    expect(helper!.x).toBeGreaterThanOrEqual(initial!.x + initial!.width);
  else expect(helper!.x + helper!.width).toBeLessThanOrEqual(page.viewportSize()!.width);

  await page.getByRole("button", { name: "Kapitelauswahl schließen" }).click();
  await page.getByRole("button", { name: "Schreibhilfe schließen" }).click();
  expect(await editor.boundingBox()).toEqual(initial);
});

test("Kapitelversionen erscheinen direkt neben der Schreibfläche", async ({ page }, testInfo) => {
  await page.route("**/api/history*", (route) =>
    route.fulfill({
      json: {
        ok: true,
        commits: [
          {
            hash: "abc123",
            shortHash: "abc123",
            date: "01.01.2026 12:00",
            subject: "Frühere Fassung",
          },
        ],
      },
    }),
  );
  // A single `*` does not cross the slash after `/history`; keep the nested endpoint explicit.
  await page.route("**/api/history/chapter-comparison*", (route) =>
    route.fulfill({
      json: {
        ok: true,
        selected: { available: true, exists: true, text: "Historischer neuer Kapiteltext" },
        previous: { available: true, exists: true, text: "Historischer alter Kapiteltext" },
      },
    }),
  );
  await openBlankWorld(page);
  await page.getByRole("button", { name: "Fassungen" }).click();
  const history = page.getByRole("complementary", { name: "Fassungen" });
  await expect(history).toBeVisible();
  await expect(history).toContainText("Historischer");
  await expect(history).toContainText("Kapiteltext");
  await expect(history.locator("ins")).toContainText("neuer");
  await expect(history.locator("del")).toContainText("alter");
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("chapter-history.png"), fullPage: true });
});

test("Buchausgabe rendert als echtes 6×9-Zoll-PDF", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "PDF-Geometrie muss nur einmal geprüft werden.");
  await openBlankWorld(page);
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();
  await expect(page.locator(".print-document")).toBeAttached();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".print-document")).toHaveCSS("display", "block");
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  expect(pdf.length).toBeGreaterThan(10_000);
  expect(pdf.toString("latin1")).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+432\s+648\s*\]/);
});

test("Autosave überlebt Reload und meldet konkurrierende Änderungen", async ({ page }) => {
  let revision = 0;
  let manuscript = {
    chapters: [{ id: "c1", title: "Test", body: "Anfang", note: "" }],
    words: [],
    zeichenAktiv: [],
  };
  await page.route("**/api/manuscript*", async (route) => {
    if (route.request().method() === "GET") return fulfillManuscript(route, manuscript, revision);
    const expected = Number((route.request().headers()["if-match"] || "").replaceAll('"', ""));
    if (expected !== revision) return fulfillRevisionConflict(route, expected, revision);
    manuscript = decodeSavedManuscript<typeof manuscript>(route);
    revision += 1;
    return fulfillDocumentSave(route, revision);
  });
  await page.route("**/api/state*", (route) =>
    route.request().method() === "GET"
      ? fulfillStoryWorld(route, { nodes: [], edges: [] })
      : fulfillDocumentSave(route, 1),
  );
  await openBlankWorld(page);
  const initialSave = waitForSuccessfulManuscriptWrite(page);
  await page.getByLabel("Kapiteltext").fill("Nach Reload vorhanden");
  await initialSave;
  // Unter 400px ist in der App-Leiste kein Platz mehr für den ruhigen Speicherstand; er steht
  // dort im ⋯-Menü. Gemeldet wird er also weiterhin, nur eine Ebene tiefer.
  if ((page.viewportSize()?.width || 0) < 400) {
    await page.getByRole("button", { name: "Mehr" }).click();
    await expect(
      page
        .getByRole("dialog", { name: "Aktionen" })
        .getByRole("status")
        .filter({ hasText: "Gespeichert" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  } else {
    await expect(page.getByRole("status").filter({ hasText: "Gespeichert" })).toBeVisible();
  }
  await page.reload();
  await waitForManuscriptReady(page);
  await expect(page.getByLabel("Kapiteltext")).toHaveText("Nach Reload vorhanden");
  revision += 1;
  await page.getByLabel("Kapiteltext").fill("Konkurrierender Stand");
  // Der Fehler dagegen bleibt in jeder Breite in der Leiste stehen -- ein fehlgeschlagenes
  // Speichern, das man erst hinter einem Menü fände, wäre schlimmer als ein abgeschnittener Knopf.
  await expect(page.getByRole("alert").filter({ hasText: "Nicht gespeichert" })).toBeVisible();
});

test("Kernansichten haben keine automatisiert erkennbaren WCAG-A/AA-Verstöße", async ({ page }) => {
  await openBlankWorld(page);
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();
  const textResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(textResults.violations).toEqual([]);
  await page.getByRole("button", { name: "Figuren" }).click();
  const figureResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(figureResults.violations).toEqual([]);
  await page.getByRole("button", { name: "Timeline" }).click();
  const timelineResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(timelineResults.violations).toEqual([]);
});

test("Dunkles Design bleibt erhalten und ist in den Kernansichten zugänglich", async ({
  page,
}, testInfo) => {
  await openBlankWorld(page);
  await page.getByRole("button", { name: "Mehr" }).click();
  await page.getByRole("menuitem", { name: "Dunkel" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await waitForManuscriptReady(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Mehr" }).click();
  await expect(page.getByRole("menuitem", { name: "Hell" })).toBeVisible();
  await page.keyboard.press("Escape");
  let results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("dark-text.png"), fullPage: true });
  await page.getByRole("button", { name: "Figuren" }).click();
  const graphControls = page.getByLabel("Kartensteuerung");
  for (const coreControl of [
    ".react-flow__controls-zoomin",
    ".react-flow__controls-zoomout",
    ".react-flow__controls-fitview",
    ".react-flow__controls-interactive",
  ]) {
    await expect(graphControls.locator(coreControl)).toHaveCount(1);
  }
  const minimapControl = graphControls.getByRole("button", {
    name: "Übersichtskarte ausblenden",
    exact: true,
  });
  await expect(minimapControl).toHaveCount(1);
  await expect(minimapControl).toHaveClass(/graph-minimap-toggle/);
  await expect(minimapControl).toHaveAttribute("aria-pressed", "true");

  const graphControlTheme = await graphControls
    .locator(".react-flow__controls-button")
    .evaluateAll((buttons) => {
      const resolveTheme = (background: string, color: string) => {
        const probe = document.createElement("span");
        probe.style.background = background;
        probe.style.color = color;
        document.body.append(probe);
        const expected = getComputedStyle(probe);
        const theme = {
          background: expected.backgroundColor,
          color: expected.color,
        };
        probe.remove();
        return theme;
      };

      return {
        defaultTheme: resolveTheme("var(--paper)", "var(--ink)"),
        activeMinimapTheme: resolveTheme("var(--selection-surface)", "var(--accent-primary)"),
        buttons: buttons.map((button) => ({
          label: button.getAttribute("aria-label") ?? "Unbenannte Kartensteuerung",
          activeMinimap: button.matches('.graph-minimap-toggle[aria-pressed="true"]'),
          background: getComputedStyle(button).backgroundColor,
          color: getComputedStyle(button).color,
        })),
      };
    });
  for (const control of graphControlTheme.buttons) {
    const expectedTheme = control.activeMinimap
      ? graphControlTheme.activeMinimapTheme
      : graphControlTheme.defaultTheme;
    expect(control.background, `${control.label} hat keine Darkmode-Fläche`).toBe(
      expectedTheme.background,
    );
    expect(control.color, `${control.label} hat keine Darkmode-Iconfarbe`).toBe(
      expectedTheme.color,
    );
  }
  results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("dark-figures.png"), fullPage: true });
});

test("Startseite lädt eine Welt und übernimmt ihren variablen Titel", async ({ page }) => {
  const title = `Öffentliche Testwelt ${crypto.randomUUID()}`;
  await createTestWorld(page, title);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welt öffnen" })).toBeVisible();
  await page.getByRole("button", { name: `${title} – Welt öffnen`, exact: true }).click();
  await waitForManuscriptReady(page);
  await expect(page.locator(".brand")).toContainText(title);
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();
});

test("Eine geöffnete Welt lässt sich über das globale Menü wieder verlassen", async ({ page }) => {
  await openBlankWorld(page, "Weltwechseltest");
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();

  await page.getByRole("button", { name: "Mehr" }).click();
  await page.getByRole("menuitem", { name: "Zur Weltauswahl" }).click();

  await expect(page.getByRole("heading", { name: "Welt öffnen" })).toBeVisible();
  await expect(page.getByLabel("Kapiteltext")).toHaveCount(0);
});

test("Welt lässt sich nur durch anhaltendes Halten lokal löschen", async ({ page }) => {
  const title = `Löschtest ${crypto.randomUUID()}`;
  await createTestWorld(page, title, "https://backup.example.com/remote-remains");
  await createTestWorld(page, `Aktive Testwelt ${crypto.randomUUID()}`);
  await page.goto("/");
  await page.getByRole("button", { name: `${title} – Welt löschen` }).click();
  await expect(page.getByRole("heading", { name: "Welt lokal löschen" })).toBeVisible();
  await expect(
    page.getByText("Bereits hochgeladene Backups bleiben auf dem Endpunkt erhalten."),
  ).toBeVisible();

  // Das Halten schützt hier, weil kein Undo greift: Datenbank, Sicherungen und Verlauf sind danach
  // fort. Der eigentliche Nachweis ist deshalb, dass ein zu frühes Loslassen nichts löscht.
  const confirm = page.getByRole("button", {
    name: "Welt löschen – gedrückt halten zum Bestätigen",
  });
  await confirm.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "mouse" });
  await page.waitForTimeout(400);
  await confirm.dispatchEvent("pointerup", { pointerId: 1, pointerType: "mouse" });
  await expect(page.getByRole("heading", { name: "Welt lokal löschen" })).toBeVisible();

  await confirm.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "mouse" });
  await page.waitForTimeout(1700);

  await expect(page.getByRole("heading", { name: "Welt lokal löschen" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: new RegExp(title) })).toHaveCount(0);
});

test("Sprachwahl erfolgt ausschließlich in der Welt-Auswahl", async ({ page }) => {
  test.setTimeout(30_000);
  const title = `Language Test World ${crypto.randomUUID()}`;
  await createTestWorld(page, title, "https://backup.example.com/language-test");
  await page.goto("/");
  await page.getByRole("radio", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Open a world" })).toBeVisible();
  await page.getByRole("button", { name: `${title} – Open a world`, exact: true }).click();
  await waitForManuscriptReady(page, "Manuscript");
  await expect(
    page.locator(".workspace-switch").getByRole("button", { name: "Manuscript", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Language" })).toHaveCount(0);
});
