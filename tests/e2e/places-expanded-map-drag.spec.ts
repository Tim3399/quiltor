import type { Locator, Page } from "@playwright/test";
import { seedExampleWorld } from "./support/example-world";
import { waitForMapViewport } from "./support/expanded-map-fixture";
import { expect, test } from "./support/world-fixture";

/*
 * T-220: the places standing on the opened-out Nordhafen map must take the pointer, not the
 * map picture under them. Grab points are taken relative to the card and to the pin's mark:
 * a fixed pixel offset lands beside a card once a smaller fit zoom shrinks it, and then the
 * picture rightly takes the pointer (that was the whole of the T-220 report).
 */

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name === "compact",
    "The inspector sheet covers the canvas after opening the map out on a phone.",
  );
  await page.addInitScript(() => {
    localStorage.setItem("quiltor-theme", "light");
    localStorage.setItem("quiltor-interface-language", "de");
  });
});

async function openHarbourMap(page: Page) {
  const world = await seedExampleWorld(page);
  await page.getByRole("button", { name: "Orte", exact: true }).click();
  await expect(page.locator(".places-workspace")).toBeVisible();
  await page.getByRole("button", { name: "Nordhafen aufklappen", exact: true }).first().click();
  const map = page.locator(`.react-flow__node-placeMap[data-id="${world.ids.figures.nordhafen}"]`);
  await expect(map).toBeVisible();
  await waitForMapViewport(page);
  return { world, map };
}

async function stored(page: Page, worldId: string, id: string) {
  const response = await page.request.get(`/api/state?world=${worldId}`);
  const nodes = (await response.json()).payload.nodes as Array<Record<string, unknown>>;
  return nodes.find((node) => node.id === id);
}

async function pointOn(locator: Locator, u: number, v: number) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("The element has no screen geometry.");
  return { x: box.x + box.width * u, y: box.y + box.height * v };
}

async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 12 });
  await page.mouse.up();
}

for (const { kind, id, grab } of [
  { kind: "card", id: "archive", grab: ".place-node-shell" },
  { kind: "pin", id: "salzmarkt", grab: ".place-node-pin__mark" },
] as const) {
  test(`A ${kind} on the opened-out harbour map can be dragged and is saved`, async ({ page }) => {
    const { world, map } = await openHarbourMap(page);
    const placeId = world.ids.figures[id];
    const before = await stored(page, world.id, placeId);
    const node = page.locator(`.react-flow__node[data-id="${placeId}"]`);
    const start = await pointOn(node.locator(grab), 0.5, 0.5);
    const hit = await page.evaluate(
      ({ x, y, selector }) => Boolean(document.elementFromPoint(x, y)?.closest(selector)),
      { ...start, selector: `.react-flow__node[data-id="${placeId}"]` },
    );
    expect(hit, "the map picture takes the pointer from the place").toBe(true);

    await dragBy(page, start, 60, 40);
    await expect
      .poll(async () => {
        const after = await stored(page, world.id, placeId);
        return (
          after?.parentPlaceId === world.ids.figures.nordhafen &&
          (after.mapU !== before?.mapU || after.mapV !== before?.mapV)
        );
      })
      .toBe(true);
    await expect(map).toBeVisible();
  });
}

/**
 * An empty point of the map's picture that the pointer can reach, or null.
 *
 * Taken from where the picture is drawn, not from a fraction of the map: how large the first
 * framing draws it depends on the platform's fonts and chrome, and once zoomed in part of it
 * lies under the inspector or past the canvas. On macOS a point at 90% of its width landed on
 * the inspector (T-79). Searched on the part inside the free canvas, from the right, so the
 * drag towards the top left stays on the canvas too.
 */
async function bareMapPoint(page: Page, mapId: string) {
  return page.evaluate((id) => {
    const node = document.querySelector(`.react-flow__node-placeMap[data-id="${id}"]`);
    const frame = node?.querySelector(".place-map-node__frame")?.getBoundingClientRect();
    const area = document.querySelector(".places-flow-area")?.getBoundingClientRect();
    if (!frame || !area) return null;
    const panel = document.querySelector(".places-inspector")?.getBoundingClientRect();
    const left = Math.max(frame.left, area.left) + 12;
    const top = Math.max(frame.top, area.top) + 12;
    const right = Math.min(frame.right, area.right, panel ? panel.left : Number.POSITIVE_INFINITY);
    const bottom = Math.min(frame.bottom, area.bottom) - 12;
    for (let u = 0.95; u >= 0.05; u -= 0.05) {
      for (let v = 0.05; v <= 0.95; v += 0.05) {
        const x = left + (right - 12 - left) * u;
        const y = top + (bottom - top) * v;
        const under = document.elementFromPoint(x, y);
        if (
          under?.closest(".place-map-node__frame") &&
          under.closest(".react-flow__node")?.getAttribute("data-id") === id
        )
          return { x, y };
      }
    }
    return null;
  }, mapId);
}

/** How far the picture's right tenth reaches past the free canvas, in screen pixels. */
async function overhang(page: Page, mapId: string) {
  return page.evaluate((id) => {
    const frame = document
      .querySelector(`.react-flow__node-placeMap[data-id="${id}"] .place-map-node__frame`)
      ?.getBoundingClientRect();
    const area = document.querySelector(".places-flow-area")?.getBoundingClientRect();
    if (!frame || !area) throw new Error("The map or the canvas has no screen geometry.");
    const panel = document.querySelector(".places-inspector")?.getBoundingClientRect();
    const right = Math.min(area.right, panel ? panel.left : Number.POSITIVE_INFINITY);
    return frame.left + frame.width * 0.9 - right;
  }, mapId);
}

// One zoom step as before, and zoomed in until the picture's right tenth lies past the free
// canvas: what one step already did on macOS, forced on every platform.
for (const zoom of ["one step", "past the canvas"] as const) {
  test(`The opened-out harbour map still zooms, and grabbing its picture moves the map (${zoom})`, async ({
    page,
  }) => {
    const { world } = await openHarbourMap(page);
    const mapId = world.ids.figures.nordhafen;
    const viewport = page.locator(".places-flow-area .react-flow__viewport");
    const initial = await viewport.getAttribute("style");
    for (let step = 0; step < 6; step += 1) {
      await page.locator(".react-flow__controls-zoomin").click();
      await waitForMapViewport(page);
      if (zoom === "one step" || (await overhang(page, mapId)) > 0) break;
    }
    expect(await viewport.getAttribute("style")).not.toBe(initial);
    if (zoom === "past the canvas") {
      expect(await overhang(page, mapId), "the map is not drawn past the canvas").toBeGreaterThan(
        0,
      );
    }

    // An unpinned map is a node of its own: an empty point of its picture drags it.
    const before = await stored(page, world.id, mapId);
    const start = await bareMapPoint(page, mapId);
    expect(start, "no empty point of the map picture can be reached").not.toBeNull();
    if (!start) return;
    const hit = await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.closest(".react-flow__node")?.getAttribute("data-id"),
      start,
    );
    expect(hit, "the grab point is not on the map picture").toBe(mapId);
    await dragBy(page, start, -60, -40);
    await expect
      .poll(async () => {
        const after = await stored(page, world.id, mapId);
        return after?.mapX !== before?.mapX || after?.mapY !== before?.mapY;
      })
      .toBe(true);
  });
}
