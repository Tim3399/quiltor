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

test("The opened-out harbour map still zooms, and grabbing its picture moves the map", async ({
  page,
}) => {
  const { world, map } = await openHarbourMap(page);
  const viewport = page.locator(".places-flow-area .react-flow__viewport");
  const initial = await viewport.getAttribute("style");
  await page.locator(".react-flow__controls-zoomin").click();
  await waitForMapViewport(page);
  expect(await viewport.getAttribute("style")).not.toBe(initial);

  // An unpinned map is a node of its own: an empty point of its picture drags it.
  const mapId = world.ids.figures.nordhafen;
  const before = await stored(page, world.id, mapId);
  const box = await map.boundingBox();
  if (!box) throw new Error("The map has no screen geometry.");
  const start = { x: box.x + box.width * 0.9, y: box.y + box.height * 0.2 };
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
