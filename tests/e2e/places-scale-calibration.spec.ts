import type { Page } from "@playwright/test";
import { seedExampleWorld } from "./support/example-world";
import { waitForMapViewport } from "./support/expanded-map-fixture";
import { expect, test } from "./support/world-fixture";

/*
 * T-79 part 3: setting the harbour map's scale by measuring a stretch on it, by two clicks
 * or by one drag, and from two places whose distance is known. Positions are planned in
 * flow units and turned into screen points through the viewport's own transform, so the
 * stretch is exactly 300 flow units whatever the fit zoom is.
 */

type Point = { x: number; y: number };
type StoredNode = Record<string, number | string | undefined>;

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
  return world;
}

async function storedNodes(page: Page, worldId: string): Promise<StoredNode[]> {
  const response = await page.request.get(`/api/state?world=${worldId}`);
  return (await response.json()).payload.nodes;
}

async function stored(page: Page, worldId: string, id: string) {
  const node = (await storedNodes(page, worldId)).find((item) => item.id === id);
  if (!node) throw new Error(`No stored node ${id}.`);
  return node;
}

const footerScale = (page: Page) => page.locator(".place-map-chrome__scale");

async function startCalibration(page: Page) {
  await page.getByRole("button", { name: "Maßstab von Nordhafen", exact: true }).click();
  await page.getByRole("button", { name: "Auf der Karte messen", exact: true }).click();
  await expect(page.getByText("Maßstab messen: Setze den Anfang der Strecke.")).toBeVisible();
}

/** Flow to screen through the viewport's transform. */
async function toScreen(page: Page, flow: Point): Promise<Point> {
  return page.evaluate(({ x, y }) => {
    const viewport = document.querySelector<HTMLElement>(".places-flow-area .react-flow__viewport");
    if (!viewport) throw new Error("No viewport.");
    const pane = viewport.parentElement?.getBoundingClientRect();
    const matrix = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
    return {
      x: (pane?.left ?? 0) + matrix.e + x * matrix.a,
      y: (pane?.top ?? 0) + matrix.f + y * matrix.d,
    };
  }, flow);
}

async function bareMap(page: Page, mapId: string, point: Point) {
  return page.evaluate(
    ({ x, y, id }) =>
      document.elementFromPoint(x, y)?.closest(".react-flow__node")?.getAttribute("data-id") === id,
    { ...point, id: mapId },
  );
}

/**
 * Two screen points exactly 300 flow units apart on the bare harbour picture.
 *
 * Planned in flow units inside the stored map frame, and moved down the picture until
 * neither end lies on a place or on the map's own header and footer.
 */
async function stretchOnMap(page: Page, worldId: string, mapId: string) {
  const map = await stored(page, worldId, mapId);
  const left = Number(map.mapX ?? map.x);
  const top = Number(map.mapY ?? map.y);
  const width = Number(map.mapWidth);
  const height = Number(map.mapHeight);
  for (const v of [0.12, 0.2, 0.28, 0.36, 0.44, 0.52, 0.6, 0.68, 0.76, 0.84]) {
    const from = { x: left + width * 0.5, y: top + height * v };
    const to = { x: from.x + 300, y: from.y };
    const a = await toScreen(page, from);
    const b = await toScreen(page, to);
    if ((await bareMap(page, mapId, a)) && (await bareMap(page, mapId, b))) return { a, b };
  }
  throw new Error("No bare stretch of 300 flow units on the harbour picture.");
}

/** Waits until the stored scale is the one shown, so a reload cannot outrun the autosave. */
async function savedScale(page: Page, worldId: string, mapId: string, expected: number) {
  await expect
    .poll(async () => {
      const scale = (await stored(page, worldId, mapId)).mapScale as unknown as
        | { unitsPer100px: number }
        | undefined;
      // As the footer reads it: mouse positions arrive in whole pixels, so the stored value
      // is the measured one, a hair off the planned 300 flow units.
      return Number((scale?.unitsPer100px ?? 0).toPrecision(3)) === expected;
    })
    .toBe(true);
}

async function applyLength(page: Page, length: string) {
  await page.getByRole("spinbutton", { name: "Länge der Strecke" }).fill(length);
  await page.getByRole("button", { name: "Übernehmen", exact: true }).click();
  await expect(page.getByText("Setze das Ende der Strecke.")).toHaveCount(0);
}

test("(a) Two clicks across 300 flow units at 3 km make 1 km per 100px, kept after reload", async ({
  page,
}) => {
  const world = await openHarbourMap(page);
  const mapId = world.ids.figures.nordhafen;
  await expect(footerScale(page)).toContainText("0.15 km pro 100px");
  await startCalibration(page);
  const { a, b } = await stretchOnMap(page, world.id, mapId);
  await page.mouse.click(a.x, a.y);
  await expect(page.getByText("Setze das Ende der Strecke.")).toBeVisible();
  await page.mouse.click(b.x, b.y);
  await applyLength(page, "3");

  await expect(footerScale(page)).toContainText("1 km pro 100px");
  await savedScale(page, world.id, mapId, 1);
  await page.reload();
  await page.getByRole("button", { name: "Orte", exact: true }).click();
  await expect(footerScale(page)).toContainText("1 km pro 100px");
});

test("(b) Dragging the same stretch gives the same scale, and Nordhafen stays where it was", async ({
  page,
}) => {
  const world = await openHarbourMap(page);
  const mapId = world.ids.figures.nordhafen;
  const before = await stored(page, world.id, mapId);
  await startCalibration(page);
  const { a, b } = await stretchOnMap(page, world.id, mapId);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, a.y, { steps: 6 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await applyLength(page, "3");

  await expect(footerScale(page)).toContainText("1 km pro 100px");
  await savedScale(page, world.id, mapId, 1);
  const after = await stored(page, world.id, mapId);
  expect([after.mapX, after.mapY, after.x, after.y]).toEqual([
    before.mapX,
    before.mapY,
    before.x,
    before.y,
  ]);
  await page.reload();
  await page.getByRole("button", { name: "Orte", exact: true }).click();
  await expect(footerScale(page)).toContainText("1 km pro 100px");
  const reloaded = await stored(page, world.id, mapId);
  expect([reloaded.mapX, reloaded.mapY]).toEqual([before.mapX, before.mapY]);
});

test("(c) Two places with a known distance between them set the scale", async ({ page }) => {
  const world = await openHarbourMap(page);
  const mapId = world.ids.figures.nordhafen;
  await startCalibration(page);
  for (const id of [world.ids.figures.salzmarkt, world.ids.figures.faehrsteg]) {
    await page.locator(`.react-flow__node[data-id="${id}"] .place-node-pin__mark`).click();
  }
  await applyLength(page, "2");

  // The anchors are where the pins stand on the stored frame.
  const nodes = await storedNodes(page, world.id);
  const map = nodes.find((node) => node.id === mapId) as StoredNode;
  const anchor = (id: string) => {
    const pin = nodes.find((node) => node.id === id) as StoredNode;
    return {
      x: Number(map.mapX ?? map.x) + Number(pin.mapU) * Number(map.mapWidth),
      y: Number(map.mapY ?? map.y) + Number(pin.mapV) * Number(map.mapHeight),
    };
  };
  const from = anchor(world.ids.figures.salzmarkt);
  const to = anchor(world.ids.figures.faehrsteg);
  const expected = (2 * 100) / Math.hypot(to.x - from.x, to.y - from.y);
  await expect(footerScale(page)).toContainText(`${Number(expected.toPrecision(3))} km pro 100px`);
});

test("(d) Escape leaves the scale as it was", async ({ page }) => {
  const world = await openHarbourMap(page);
  await startCalibration(page);
  const { a } = await stretchOnMap(page, world.id, world.ids.figures.nordhafen);
  await page.mouse.click(a.x, a.y);
  await page.keyboard.press("Escape");
  await expect(page.getByText("Setze das Ende der Strecke.")).toHaveCount(0);
  await expect(footerScale(page)).toContainText("0.15 km pro 100px");
});
