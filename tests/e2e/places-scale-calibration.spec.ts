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

/**
 * Zooms out until the map's picture lies whole inside the free canvas: inside the canvas,
 * left of the inspector. How large the first framing draws it depends on the platform's
 * fonts and chrome (on macOS the picture ran under the inspector), so the points a test
 * plans on the picture are only taken once all of it can be reached.
 */
async function mapInView(page: Page, mapId: string) {
  const frame = page.locator(
    `.react-flow__node-placeMap[data-id="${mapId}"] .place-map-node__frame`,
  );
  const canvas = page.locator(".places-flow-area");
  const inspector = page.locator(".places-inspector");
  for (let step = 0; step < 6; step += 1) {
    const picture = await frame.boundingBox();
    const area = await canvas.boundingBox();
    if (!picture || !area) throw new Error("The map or the canvas has no screen geometry.");
    const panel = (await inspector.count()) ? await inspector.boundingBox() : null;
    const right = Math.min(area.x + area.width, panel ? panel.x : Number.POSITIVE_INFINITY);
    if (
      picture.x >= area.x + 8 &&
      picture.y >= area.y + 8 &&
      picture.x + picture.width <= right - 8 &&
      picture.y + picture.height <= area.y + area.height - 8
    )
      return;
    await page.locator(".react-flow__controls-zoomout").click();
    await waitForMapViewport(page);
  }
  throw new Error("The map's picture does not fit the free canvas.");
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
  await mapInView(page, mapId);
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
    if ((await bareMap(page, mapId, a)) && (await bareMap(page, mapId, b))) {
      return measured(await viewportZoom(page), a, b);
    }
  }
  throw new Error("No bare stretch of 300 flow units on the harbour picture.");
}

/** The zoom of the flow viewport: screen pixels per flow unit. */
async function viewportZoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>(".places-flow-area .react-flow__viewport");
    if (!viewport) throw new Error("No viewport.");
    return new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a;
  });
}

/**
 * The two ends as the mouse can reach them, and the scale a length laid on them makes.
 *
 * A mouse position is a whole pixel, and a flow unit is a fraction of one once the map has
 * been zoomed out to fit: at 0.83 one pixel of rounding is 1.2 flow units, so a stretch
 * planned as 300 units is measured as 301.2 and its 3 km read 0.996 km per 100px on macOS,
 * where the picture needs that zoom-out. The ends are therefore rounded here, and the scale
 * the app must show is worked out from the rounded ends, the way the app measures them.
 */
function measured(zoom: number, from: Point, to: Point) {
  const a = { x: Math.round(from.x), y: Math.round(from.y) };
  const b = { x: Math.round(to.x), y: Math.round(to.y) };
  const flowLength = Math.hypot(b.x - a.x, b.y - a.y) / zoom;
  return {
    a,
    b,
    /** Units per 100 flow units for `length` laid on the stretch, as the footer reads it. */
    scaleFor: (length: number) => Number(((length * 100) / flowLength).toPrecision(3)),
  };
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
  const { a, b, scaleFor } = await stretchOnMap(page, world.id, mapId);
  await page.mouse.click(a.x, a.y);
  await expect(page.getByText("Setze das Ende der Strecke.")).toBeVisible();
  await page.mouse.click(b.x, b.y);
  await applyLength(page, "3");

  await expect(footerScale(page)).toContainText(`${scaleFor(3)} km pro 100px`);
  await savedScale(page, world.id, mapId, scaleFor(3));
  await page.reload();
  await page.getByRole("button", { name: "Orte", exact: true }).click();
  await expect(footerScale(page)).toContainText(`${scaleFor(3)} km pro 100px`);
});

test("(a2) Zoomed out, the mouse's whole pixels make the scale of the stretch they span", async ({
  page,
}) => {
  const world = await openHarbourMap(page);
  const mapId = world.ids.figures.nordhafen;
  // One step out, as macOS needs to bring the picture clear of the inspector: a flow unit is
  // then 0.83 pixel, and the two ends the mouse can hit are up to 1.2 units off the plan.
  await page.locator(".react-flow__controls-zoomout").click();
  await waitForMapViewport(page);
  await startCalibration(page);
  const { a, b, scaleFor } = await stretchOnMap(page, world.id, mapId);
  await page.mouse.click(a.x, a.y);
  await expect(page.getByText("Setze das Ende der Strecke.")).toBeVisible();
  await page.mouse.click(b.x, b.y);
  await applyLength(page, "3");

  await expect(footerScale(page)).toContainText(`${scaleFor(3)} km pro 100px`);
  await savedScale(page, world.id, mapId, scaleFor(3));
});

test("(b) Dragging the same stretch gives the same scale, and Nordhafen stays where it was", async ({
  page,
}) => {
  const world = await openHarbourMap(page);
  const mapId = world.ids.figures.nordhafen;
  const before = await stored(page, world.id, mapId);
  await startCalibration(page);
  const { a, b, scaleFor } = await stretchOnMap(page, world.id, mapId);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, a.y, { steps: 6 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await applyLength(page, "3");

  await expect(footerScale(page)).toContainText(`${scaleFor(3)} km pro 100px`);
  await savedScale(page, world.id, mapId, scaleFor(3));
  const after = await stored(page, world.id, mapId);
  expect([after.mapX, after.mapY, after.x, after.y]).toEqual([
    before.mapX,
    before.mapY,
    before.x,
    before.y,
  ]);
  await page.reload();
  await page.getByRole("button", { name: "Orte", exact: true }).click();
  await expect(footerScale(page)).toContainText(`${scaleFor(3)} km pro 100px`);
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

/*
 * Part 4: the frame keeps its proportions, the scale follows the frame, and a distorted
 * frame (Shift held as the gesture begins) keeps its scale and asks for a new measurement.
 */

/**
 * Selects the map so its grips show, zooming out first while its right edge would lie
 * under the inspector that selecting opens.
 */
async function selectHarbour(page: Page, worldId: string, mapId: string) {
  const map = page.locator(`.react-flow__node-placeMap[data-id="${mapId}"]`);
  const inspector = page.locator(".places-inspector");
  for (let step = 0; step < 5; step += 1) {
    const { a } = await stretchOnMap(page, worldId, mapId);
    await page.mouse.click(a.x, a.y);
    await expect(page.locator(".place-map-node__handle.bottom.right")).toBeVisible();
    const mapBox = await map.boundingBox();
    const panel = (await inspector.count()) ? await inspector.boundingBox() : null;
    if (mapBox && (!panel || mapBox.x + mapBox.width < panel.x - 16)) return;
    await page.locator(".react-flow__controls-zoomout").click();
    await waitForMapViewport(page);
  }
  throw new Error("The map's corner stays under the inspector.");
}

/**
 * Drags the bottom-right grip by (dx, dy) screen pixels, Shift held or not.
 *
 * The minimap sits in the canvas's bottom-right corner, where it covers the grip of a map
 * that fills the view; grabbing it would pan the canvas instead. It is hidden first, and
 * the grab point is checked to be the grip itself.
 */
async function dragCorner(page: Page, dx: number, dy: number, shift = false) {
  const hide = page.getByRole("button", { name: "Übersichtskarte ausblenden", exact: true });
  if (await hide.isVisible()) await hide.click();
  const grip = page.locator(".place-map-node__handle.bottom.right");
  const box = await grip.boundingBox();
  if (!box) throw new Error("The corner grip has no screen geometry.");
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const onGrip = await page.evaluate(
    ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest(".react-flow__resize-control")),
    from,
  );
  expect(onGrip, "something lies over the corner grip").toBe(true);
  await page.mouse.move(from.x, from.y);
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 12 });
  await page.mouse.up();
  if (shift) await page.keyboard.up("Shift");
}

/** The measured distance Salzmarkt–Fährsteg, read off the measuring line. */
async function harbourDistance(page: Page, world: { ids: { figures: Record<string, string> } }) {
  await page.getByRole("button", { name: "Distanz messen", exact: true }).click();
  for (const id of [world.ids.figures.salzmarkt, world.ids.figures.faehrsteg]) {
    await page.locator(`.react-flow__node[data-id="${id}"] .place-node-pin__mark`).click();
  }
  const label = (await page.locator(".distance-edge.is-targeted").getAttribute("aria-label")) ?? "";
  await page.keyboard.press("Escape");
  const match = /: ([\d.]+) km$/.exec(label);
  if (!match) throw new Error(`Unexpected measuring line "${label}".`);
  return Number(match[1]);
}

async function storedFrame(page: Page, worldId: string, mapId: string) {
  const map = await stored(page, worldId, mapId);
  const scale = map.mapScale as unknown as { unitsPer100px: number } | undefined;
  return {
    width: Number(map.mapWidth),
    height: Number(map.mapHeight),
    unitsPer100px: scale?.unitsPer100px ?? Number.NaN,
  };
}

async function frameChanged(page: Page, worldId: string, mapId: string, width: number) {
  await expect.poll(async () => (await storedFrame(page, worldId, mapId)).width).not.toBe(width);
  return storedFrame(page, worldId, mapId);
}

test("(f) The corner grip keeps the proportions, the scale follows, distances stay", async ({
  page,
}) => {
  const world = await openHarbourMap(page);
  const mapId = world.ids.figures.nordhafen;
  const distance = await harbourDistance(page, world);
  await selectHarbour(page, world.id, mapId);
  await dragCorner(page, 200, 200);

  const after = await frameChanged(page, world.id, mapId, 1500);
  expect(after.width / after.height).toBeCloseTo(1.5, 3);
  expect(after.unitsPer100px).toBeCloseTo((0.15 * 1500) / after.width, 3);
  await expect(page.getByText("Maßstab neu messen?")).toHaveCount(0);
  expect(await harbourDistance(page, world)).toBeCloseTo(distance, 1);
});

test("(g) With Shift the frame distorts, keeps its scale and asks to measure again", async ({
  page,
}) => {
  const world = await openHarbourMap(page);
  const mapId = world.ids.figures.nordhafen;
  await selectHarbour(page, world.id, mapId);
  await dragCorner(page, 200, 0, true);

  const after = await frameChanged(page, world.id, mapId, 1500);
  expect(after.width / after.height).not.toBeCloseTo(1.5, 2);
  expect(after.unitsPer100px).toBe(0.15);
  await expect(page.locator(".react-flow__selection")).toHaveCount(0);
  await expect(page.getByText("Maßstab neu messen?")).toBeVisible();
  await page.getByRole("button", { name: "Neu messen", exact: true }).click();
  await expect(page.getByText("Maßstab messen: Setze den Anfang der Strecke.")).toBeVisible();
});

test("(h) One undo takes back both the size and the scale", async ({ page }) => {
  const world = await openHarbourMap(page);
  const mapId = world.ids.figures.nordhafen;
  await selectHarbour(page, world.id, mapId);
  await dragCorner(page, 200, 200);
  await frameChanged(page, world.id, mapId, 1500);

  await page.getByRole("button", { name: "Orte rückgängig", exact: true }).click();
  await expect
    .poll(async () => storedFrame(page, world.id, mapId))
    .toEqual({ width: 1500, height: 1000, unitsPer100px: 0.15 });
});

test("(i) Two proportional resizes in a row each recompute without a hint", async ({ page }) => {
  const world = await openHarbourMap(page);
  const mapId = world.ids.figures.nordhafen;
  const distance = await harbourDistance(page, world);
  await selectHarbour(page, world.id, mapId);

  await dragCorner(page, 80, 80);
  const first = await frameChanged(page, world.id, mapId, 1500);
  await expect(page.getByText("Maßstab neu messen?")).toHaveCount(0);
  expect(first.unitsPer100px).toBeCloseTo((0.15 * 1500) / first.width, 3);

  await selectHarbour(page, world.id, mapId);
  await dragCorner(page, 60, 60);
  const second = await frameChanged(page, world.id, mapId, first.width);
  await expect(page.getByText("Maßstab neu messen?")).toHaveCount(0);
  expect(second.width / second.height).toBeCloseTo(1.5, 2);
  // Each step divides by its own factor, so the scale tracks the whole change.
  expect(second.unitsPer100px).toBeCloseTo((0.15 * 1500) / second.width, 2);
  expect(await harbourDistance(page, world)).toBeCloseTo(distance, 1);
});

test("(j) A map without a size is drawn at its picture's size and its scale follows", async ({
  page,
}) => {
  const world = await seedExampleWorld(page, { include: ["base", "edge"] });
  const levelId = world.ids.figures.xMasslosEbene;
  const mapId = world.ids.figures.xMassloseKarte;
  await page.getByRole("button", { name: "Orte", exact: true }).click();
  // The level's card lies outside the first framing; React Flow enters a level on the
  // node's own double click, which needs no pointer on screen.
  await page.locator(`.react-flow__node[data-id="${levelId}"]`).dispatchEvent("dblclick");
  const map = page.locator(`.react-flow__node-placeMap[data-id="${mapId}"]`);
  await expect(map, "the server did not fill in the picture's size").toBeVisible();
  await waitForMapViewport(page);

  // Drawn at the harbour picture's own 1200 by 800 pixels.
  const zoom = await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>(".places-flow-area .react-flow__viewport");
    return viewport ? new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a : Number.NaN;
  });
  const drawn = await map.boundingBox();
  if (!drawn) throw new Error("The map has no screen geometry.");
  expect(drawn.width / zoom).toBeCloseTo(1200, 0);
  expect(drawn.height / zoom).toBeCloseTo(800, 0);

  await selectHarbour(page, world.id, mapId);
  await dragCorner(page, 150, 100);
  await expect
    .poll(async () => Number((await stored(page, world.id, mapId)).mapWidth))
    .not.toBe(1200);
  const after = await storedFrame(page, world.id, mapId);
  expect(after.width / after.height).toBeCloseTo(1.5, 2);
  expect(after.unitsPer100px).toBeCloseTo((0.15 * 1200) / after.width, 3);
});
