import type { Locator, Page } from "@playwright/test";
import { seedExampleWorld } from "./support/example-world";
import {
  closePlaceSheet,
  expandedMapState,
  mockExpandedMapWorld,
  openExpandedMapWorld,
} from "./support/expanded-map-fixture";
import { expect, test } from "./support/world-fixture";

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
    const world = await seedExampleWorld(page, { open: false });
    // A chapter of one paragraph, a relationship without time versions, the first moment.
    const chapterTitle = world.text("ch.c5.title");
    const chapterBody = world.text("ch.c5.body");
    const edgeLabel = world.text("edge.e3.label");
    const momentTitle = world.text("moment.t1.title");
    await page.goto(`/?world=${world.id}`);
    await expect(page.getByLabel("Kapiteltext")).toBeVisible();
    await page.getByRole("button", { name: "Fokus", exact: true }).click();
    const picker = page.getByRole("button", { name: "Kapitelauswahl öffnen" });
    await expect(picker).toHaveAttribute("aria-expanded", "false");
    await picker.click();
    const chapters = page.locator(".focus-chapter-list");
    await expectContained(chapters, page);
    const secondChapter = chapters.getByRole("button", { name: chapterTitle });
    await secondChapter.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Kapiteltext")).toBeFocused();
    await expect(page.getByLabel("Kapiteltext")).toHaveText(chapterBody);
    await expect(secondChapter).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "Kapitelauswahl schließen" }).click();
    await page.getByRole("button", { name: "Details öffnen" }).click();
    await expectContained(page.locator(".focus-helper-panel"), page);
    await expect(page.locator(".focus-helper-panel h3").first()).toHaveCSS("font-size", "12px");
    await expect(page.locator(".focus-helper-chip").first()).toHaveCSS("font-size", "12px");
    await page.screenshot({ path: testInfo.outputPath(`focus-reading-${theme}.png`) });
    await page.getByRole("button", { name: "Details schließen" }).click();
    await page.getByRole("button", { name: /Fokusmodus verlassen/ }).click();
    await expect(page.getByLabel("Kapiteltext")).toHaveText(chapterBody);

    await page.getByRole("button", { name: "Figuren", exact: true }).click();
    const relationship = page.locator(".graph-edge-label__text").filter({ hasText: edgeLabel });
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
    await expect(strip.locator(".timeline-moment-copy b").first()).toHaveCSS("font-size", "12px");
    const moment = strip.getByRole("button", { name: momentTitle });
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
