import type { Page } from "@playwright/test";
import { seedExampleWorld } from "./support/example-world";
import { expect, test } from "./support/world-fixture";

/*
 * T-325 (v3.26.x): measuring distances on a compact places workspace. The author's
 * screenshot was about 780px wide: the scale value, "pro 100px", the unit and "Auf der Karte
 * messen" stood at different heights, and the hint "Pro Ort werden ..." ran out of the
 * canvas on the right instead of wrapping.
 */

const WIDTHS = [780, 390] as const;

async function openMeasuring(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("quiltor-theme", "light");
    localStorage.setItem("quiltor-interface-language", "de");
  });
  await seedExampleWorld(page);
  await page.getByRole("button", { name: "Orte", exact: true }).click();
  await expect(page.locator(".places-workspace")).toBeVisible();
  await page.getByRole("button", { name: "Distanz messen", exact: true }).click();
  await expect(page.locator(".places-scale-legend")).toBeVisible();
}

for (const width of WIDTHS) {
  test.describe(`measuring distances at ${width}px`, () => {
    test.beforeEach(async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "wide", "Sets its own viewport; one project is enough.");
      await openMeasuring(page, width);
    });

    test("the legend's field, unit and button share one centre line", async ({ page }) => {
      const legend = page.locator(".places-scale-legend");
      const rows = await legend.evaluate((element) => {
        const parts = [
          element.querySelector(".places-scale-value"),
          element.querySelector(".places-scale-unit"),
          element.querySelector("button"),
        ];
        return parts.map((part) => {
          if (!part) return null;
          const box = part.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom, middle: box.top + box.height / 2 };
        });
      });
      expect(rows.every(Boolean), "value, unit and button are all there").toBe(true);
      const boxes = rows as { top: number; bottom: number; middle: number }[];
      // Where the legend wraps (a phone), parts sit on separate rows; only parts that share a
      // row have to share its centre line.
      const sameRow = (a: (typeof boxes)[number], b: (typeof boxes)[number]) =>
        a.top < b.bottom && b.top < a.bottom;
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          if (!sameRow(boxes[i], boxes[j])) continue;
          expect(
            Math.abs(boxes[i].middle - boxes[j].middle),
            `legend parts ${i} and ${j} are off one line`,
          ).toBeLessThanOrEqual(1);
        }
      }
    });

    test("the hint wraps inside the canvas instead of running out of it", async ({ page }) => {
      const geometry = await page
        .locator(".places-measure-overlays .mode-banner")
        .evaluate((banner) => {
          const area = banner.closest(".places-workspace")?.getBoundingClientRect();
          const box = banner.getBoundingClientRect();
          const copy = banner.querySelector(".mode-banner-copy") ?? banner;
          return {
            left: box.left,
            right: box.right,
            areaLeft: area?.left ?? 0,
            areaRight: area?.right ?? window.innerWidth,
            viewport: document.documentElement.clientWidth,
            copyOverflow: copy.scrollWidth - copy.clientWidth,
          };
        });
      expect(geometry.left).toBeGreaterThanOrEqual(geometry.areaLeft - 0.5);
      expect(geometry.right).toBeLessThanOrEqual(
        Math.min(geometry.areaRight, geometry.viewport) + 0.5,
      );
      expect(geometry.copyOverflow, "the hint's text is cut").toBeLessThanOrEqual(0);
    });
  });
}
