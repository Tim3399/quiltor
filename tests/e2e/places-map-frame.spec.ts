import { expect, test } from "./support/world-fixture";
import {
  mockExpandedMapWorld,
  openExpandedMapWorld,
  waitForMapViewport,
} from "./support/expanded-map-fixture";

test("The map shares one compact frame with its header and footer through pan and zoom", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    localStorage.setItem("quiltor-theme", "dark");
    localStorage.setItem("quiltor-interface-language", "de");
  });
  const fixture = await mockExpandedMapWorld(page);
  await openExpandedMapWorld(page);
  const chrome = page.locator(".place-map-chrome");
  const header = chrome.locator(".place-map-chrome__header");
  const footer = chrome.locator(".place-map-chrome__footer");
  for (const stage of ["initial", "zoomed", "panned"] as const) {
    if (stage === "zoomed") {
      await page.locator(".react-flow__controls-zoomin").click();
      await page.locator(".react-flow__controls-zoomin").click();
    } else if (stage === "panned") {
      const canvas = await page.locator(".places-flow-area").boundingBox();
      if (!canvas) throw new Error("Canvas has no screen geometry.");
      const x = canvas.x + canvas.width * 0.5;
      const y = canvas.y + canvas.height * 0.5;
      await page.mouse.move(x, y);
      await page.mouse.down({ button: "middle" });
      await page.mouse.move(x - 85, y - 50, { steps: 6 });
      await page.mouse.up({ button: "middle" });
    }
    await waitForMapViewport(page);
    await expect(chrome).toBeVisible();
    await expect
      .poll(async () => {
        const top = await header.boundingBox();
        const bottom = await footer.boundingBox();
        if (!top || !bottom) return Infinity;
        return Math.max(Math.abs(top.x - bottom.x), Math.abs(top.width - bottom.width));
      })
      .toBeLessThanOrEqual(1.5);
    const top = await header.boundingBox();
    const bottom = await footer.boundingBox();
    if (!top || !bottom) throw new Error("Map bars have no screen geometry.");
    const actionHeight = await header
      .locator("button")
      .first()
      .evaluate((button) => button.getBoundingClientRect().height);
    const scaleHeight = await footer
      .locator("button")
      .first()
      .evaluate((button) => button.getBoundingClientRect().height);
    // Narrow surfaces retain Quiltor's larger touch targets; the bars add only a small inset.
    expect(top.height).toBeLessThanOrEqual(Math.max(52, actionHeight + 14));
    expect(bottom.height).toBeLessThanOrEqual(Math.max(44, scaleHeight + 14));
    const readingCenters = await footer.locator(".place-map-chrome__cell").evaluateAll((cells) =>
      cells
        .map((cell) => cell.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => rect.top + rect.height / 2),
    );
    expect(Math.max(...readingCenters) - Math.min(...readingCenters)).toBeLessThanOrEqual(1.5);
    // Check the actual painted/hit-tested visual, not the unchanged world node bounds.
    const bleed = await page.locator(".places-flow-area").evaluate((surface) => {
      const top = surface.querySelector(".place-map-chrome__header")!.getBoundingClientRect();
      const bottom = surface.querySelector(".place-map-chrome__footer")!.getBoundingClientRect();
      const rect = surface.getBoundingClientRect();
      const map = surface.querySelector('.react-flow__node[data-id="weltkarte"]')!;
      const samples = [
        { x: top.left - 4, y: (top.bottom + bottom.top) / 2 },
        { x: top.right + 4, y: (top.bottom + bottom.top) / 2 },
        { x: top.left + top.width / 2, y: bottom.bottom + 4 },
        { x: top.left + top.width / 2, y: top.top - 4 },
      ];
      return samples.filter(({ x, y }) => {
        if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return false;
        return document
          .elementsFromPoint(x, y)
          .some(
            (element) =>
              map.contains(element) &&
              element.matches(
                "img, .place-map-node__frame, .place-plate__grid, .place-plate__rule",
              ),
          );
      });
    });
    expect(bleed, "Map visuals must stay within the shared frame").toEqual([]);
    await page.screenshot({
      path: info.outputPath(`dark-map-frame-${stage}.png`),
      animations: "disabled",
    });
  }
  expect(fixture.savedState().nodes.find((place) => place.id === "weltkarte")).toMatchObject({
    mapWidth: 1000,
    mapHeight: 680,
    x: 0,
    y: 0,
  });
  expect(fixture.savedState().nodes.find((place) => place.id === "graufurth")).toMatchObject({
    parentPlaceId: "weltkarte",
    mapU: 0.3,
    mapV: 0.4,
  });
});
