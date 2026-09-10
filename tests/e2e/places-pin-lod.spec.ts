import type { Page } from "@playwright/test";
import { expect, test } from "./support/world-fixture";
import {
  expandedMapState,
  mockExpandedMapWorld,
  openExpandedMapWorld,
  waitForMapViewport,
} from "./support/expanded-map-fixture";

async function zoomTo(page: Page, tier: "detail" | "compact" | "overview") {
  const surface = page.locator(".places-flow-area");
  const zoomIn = page.locator(".react-flow__controls-zoomin");
  const zoomOut = page.locator(".react-flow__controls-zoomout");
  for (let step = 0; step < 16; step += 1) {
    const current = (await surface.getAttribute("class"))?.match(
      /\bzoom-(detail|compact|overview)\b/,
    )?.[1];
    if (current === tier) return;
    await (tier === "detail" || (tier === "compact" && current === "overview")
      ? zoomIn
      : zoomOut
    ).click();
    await waitForMapViewport(page);
  }
  await expect(surface).toHaveClass(new RegExp(`\\bzoom-${tier}\\b`));
}

test("Pin detail levels reduce the actual footprint while keeping the geographic tip fixed", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "wide", "The complete zoom range uses the wide canvas.");
  await page.addInitScript(() => {
    localStorage.setItem("quiltor-theme", "dark");
    localStorage.setItem("quiltor-interface-language", "de");
  });
  const state = expandedMapState();
  state.nodes.find((place) => place.id === "graufurth")!.placeDisplay = "pin";
  const fixture = await mockExpandedMapWorld(page, state);
  await openExpandedMapWorld(page);
  const node = page.locator('.react-flow__node[data-id="graufurth"]');
  const pin = node.locator(".place-node-pin");
  const widths: number[] = [];
  for (const tier of ["detail", "compact", "overview"] as const) {
    await zoomTo(page, tier);
    await page.mouse.move(10, 100);
    const bounds = await node.boundingBox();
    if (!bounds) throw new Error("Pin node has no screen geometry.");
    widths.push(bounds.width);
    const map = await page.locator('.react-flow__node[data-id="weltkarte"]').boundingBox();
    const tip = await pin.locator(".place-node-pin__tip").boundingBox();
    if (!map || !tip) throw new Error("Map or pin tip has no screen geometry.");
    expect(Math.abs(tip.x + tip.width / 2 - (map.x + map.width * 0.3))).toBeLessThanOrEqual(1.5);
    expect(Math.abs(tip.y + tip.height / 2 - (map.y + map.height * 0.4))).toBeLessThanOrEqual(1.5);
    if (tier === "overview") {
      expect(bounds.width).toBeLessThanOrEqual(36);
      expect(bounds.height).toBeLessThanOrEqual(40);
      await expect(pin.locator(".place-node-pin__label")).toBeHidden();
      await node.focus();
      await expect(pin.locator(".place-node-pin__label")).toBeVisible();
      expect((await node.boundingBox())?.width).toBeCloseTo(bounds.width, 1);
      await page.locator(".react-flow__controls-zoomin").focus();
    } else {
      await expect(pin.locator(".place-node-pin__name")).toBeVisible();
    }
    await page.screenshot({
      path: info.outputPath(`dark-pin-${tier}.png`),
      animations: "disabled",
    });
  }
  expect(widths[1]).toBeLessThan(widths[0] - 20);
  expect(widths[2]).toBeLessThan(widths[1] / 2);
  await zoomTo(page, "detail");
  await pin.hover();
  await expect(pin.getByRole("button", { name: "Ort Graufurth als Karte anzeigen" })).toBeVisible();
  expect(fixture.savedState().nodes.find((place) => place.id === "graufurth")).toMatchObject({
    placeDisplay: "pin",
    parentPlaceId: "weltkarte",
    mapU: 0.3,
    mapV: 0.4,
  });
});
