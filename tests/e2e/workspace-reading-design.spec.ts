import type { Locator, Page } from "@playwright/test";
import { mockRequiredWorldDocuments } from "./support/application-api";
import {
  closePlaceSheet,
  expandedMapState,
  mockExpandedMapWorld,
  openExpandedMapWorld,
} from "./support/expanded-map-fixture";
import { createTestWorld, expect, test } from "./support/world-fixture";

async function expectContained(locator: Locator, page: Page) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
}

for (const theme of ["light", "dark"] as const) {
  test(`Workspace reading labels and focus navigation remain usable in ${theme}`, async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === "compact")
      await page.setViewportSize({ width: 320, height: 844 });
    await page.addInitScript((selected) => localStorage.setItem("quiltor-theme", selected), theme);
    const world = await createTestWorld(page, "Lesbare Werkstatt");
    await mockRequiredWorldDocuments(page, {
      manuscript: {
        chapters: [
          { id: "c1", title: "Ankunft", body: "Der Morgen liegt still über dem Hafen.", note: "" },
          { id: "c2", title: "Aufbruch", body: "Mara öffnet die Karte.", note: "" },
        ],
        words: [],
        activeSymbols: ["…"],
      },
      storyWorld: {
        nodes: [
          {
            id: "mara",
            type: "person",
            x: 120,
            y: 120,
            name: "Mara Venn",
            label: "Kartographin",
            sub: "Liest lebende Karten.",
          },
          {
            id: "ivo",
            type: "person",
            x: 480,
            y: 120,
            name: "Ivo",
            label: "Archivar",
            sub: "Hütet das Hafenarchiv.",
          },
        ],
        edges: [{ id: "e1", from: "mara", to: "ivo", label: "vertraut", directed: true }],
        timeline: [
          {
            id: "t1",
            title: "Ankunft am Hafen",
            date: "1847-09-03",
            note: "Mara erreicht den Hafen.",
          },
        ],
        presence: [],
      },
    });
    await page.goto(`/?world=${world.id}`);
    await expect(page.getByLabel("Kapiteltext")).toBeVisible();
    await page.getByRole("button", { name: "Fokus", exact: true }).click();
    const picker = page.getByRole("button", { name: "Kapitelauswahl öffnen" });
    await expect(picker).toHaveAttribute("aria-expanded", "false");
    await picker.click();
    const chapters = page.locator(".focus-chapter-list");
    await expectContained(chapters, page);
    const secondChapter = chapters.getByRole("button", { name: /Aufbruch/ });
    await secondChapter.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Kapiteltext")).toBeFocused();
    await expect(page.getByLabel("Kapiteltext")).toHaveText("Mara öffnet die Karte.");
    await expect(secondChapter).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "Kapitelauswahl schließen" }).click();
    await page.getByRole("button", { name: "Details öffnen" }).click();
    await expectContained(page.locator(".focus-helper-panel"), page);
    await expect(page.locator(".focus-helper-panel h3").first()).toHaveCSS("font-size", "12px");
    await expect(page.locator(".focus-helper-chip").first()).toHaveCSS("font-size", "12px");
    await page.screenshot({ path: testInfo.outputPath(`focus-reading-${theme}.png`) });
    await page.getByRole("button", { name: "Details schließen" }).click();
    await page.getByRole("button", { name: /Fokusmodus verlassen/ }).click();
    await expect(page.getByLabel("Kapiteltext")).toHaveText("Mara öffnet die Karte.");

    await page.getByRole("button", { name: "Figuren", exact: true }).click();
    const relationship = page.locator(".graph-edge-label__text").filter({ hasText: "vertraut" });
    await expect(relationship).toHaveCSS("font-size", "12px");
    // At hand width the graph initially fits both cards in its overview zoom, which hides labels.
    await expect
      .poll(async () => {
        if (!(await relationship.isVisible()))
          await page.getByRole("button", { name: "Zoom In", exact: true }).click();
        return relationship.isVisible();
      })
      .toBe(true);
    await expect(relationship).toBeVisible();
    const strip = page.locator(".timeline-strip");
    await expectContained(strip, page);
    await expect(strip.locator(".timeline-moment-copy b")).toHaveCSS("font-size", "12px");
    const moment = strip.getByRole("button", { name: /Ankunft am Hafen/ });
    await moment.click();
    await expect(moment).toHaveAttribute("aria-pressed", "true");
    const dateWidth = await strip
      .locator('.timeline-details input[type="date"]')
      .evaluate((element) => element.getBoundingClientRect().width);
    expect(dateWidth, "Native date segments remain wide enough to edit").toBeGreaterThanOrEqual(
      110,
    );
    const captionFits = await moment.evaluate((element) => {
      const button = element.getBoundingClientRect();
      return [...element.querySelectorAll("b, small")].every((text) => {
        const box = text.getBoundingClientRect();
        return box.left >= button.left && box.right <= button.right + 1;
      });
    });
    expect(captionFits, "Title and date stay within the moment button").toBe(true);
    await expect(strip.locator(".timeline-title")).toHaveCSS("font-size", "12px");
    await page.screenshot({ path: testInfo.outputPath(`world-reading-${theme}.png`) });
  });

  test(`Map names preserve their spelling and fit the map tools in ${theme}`, async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === "compact")
      await page.setViewportSize({ width: 320, height: 844 });
    await page.addInitScript((selected) => localStorage.setItem("quiltor-theme", selected), theme);
    await mockExpandedMapWorld(page, expandedMapState({ expanded: false }));
    await openExpandedMapWorld(page);
    await page.locator('.react-flow__node[data-id="weltkarte"]').click();
    const name = page.locator(".place-map-toolbar__name");
    await expect(name).toHaveText("Weltkarte");
    await expect(name).toHaveCSS("font-size", "14px");
    await expect(name).toHaveCSS("text-transform", "none");
    await expect(name).toHaveCSS("font-family", /Garamond/);
    await expectContained(page.locator(".place-map-toolbar"), page);
    // Compact editing is owned by the inspector sheet; Escape clears the selection and its
    // contextual map tools together. The underlying toolbar must still fit its viewport.
    await page.screenshot({ path: testInfo.outputPath(`map-reading-${theme}.png`) });
    await closePlaceSheet(page);
  });
}
