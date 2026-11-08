import type { Locator, Page } from "@playwright/test";
import { seedExampleWorld } from "./support/example-world";
import { waitForMapViewport } from "./support/expanded-map-fixture";
import { expect, test } from "./support/world-fixture";

/*
 * T-79 part 2: while measuring, a click on the opened-out Nordhafen picture sets a free
 * point. The picture is a node of its own, so the click arrives as a node click; before
 * this it chose the map's middle, which is exactly what the mutation of F-79-1 brings back.
 *
 * Expected distances come from the canvas itself: the viewport transform turns the click
 * into flow units, the pin's own transform says where it stands, and Nordhafen reads
 * 0.15 km per 100 px in the test world.
 */

const HARBOUR_KM_PER_100PX = 0.15;

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

/**
 * A screen point near (`u`, `v`) of the map picture where nothing lies above the picture.
 *
 * The frame, not the node: the map's header and footer lie over the node's edges. Places
 * and the measuring lines lie over the picture too, so the nearest bare spot is taken.
 */
async function pointOnMap(page: Page, map: Locator, mapId: string, u: number, v: number) {
  const box = await map.locator(".place-map-node__frame").boundingBox();
  if (!box) throw new Error("The map has no screen geometry.");
  const offsets = [0, 0.03, -0.03, 0.06, -0.06, 0.09, -0.09];
  for (const du of offsets) {
    for (const dv of offsets) {
      const point = { x: box.x + box.width * (u + du), y: box.y + box.height * (v + dv) };
      const hit = await page.evaluate(({ x, y }) => {
        const element = document.elementFromPoint(x, y);
        return element?.closest(".react-flow__node")?.getAttribute("data-id");
      }, point);
      if (hit === mapId) return point;
    }
  }
  throw new Error(`No bare spot of the map picture near ${u}, ${v}.`);
}

/** Screen to flow units through the viewport's own transform. */
async function toFlow(page: Page, client: { x: number; y: number }) {
  return page.evaluate(({ x, y }) => {
    const viewport = document.querySelector<HTMLElement>(".places-flow-area .react-flow__viewport");
    if (!viewport) throw new Error("No viewport.");
    const pane = viewport.parentElement?.getBoundingClientRect();
    const matrix = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
    return {
      x: (x - (pane?.left ?? 0) - matrix.e) / matrix.a,
      y: (y - (pane?.top ?? 0) - matrix.f) / matrix.d,
    };
  }, client);
}

/** Where a pin stands in flow units: its anchor on the stored map frame. */
async function pinAnchor(page: Page, worldId: string, mapId: string, pinId: string) {
  const response = await page.request.get(`/api/state?world=${worldId}`);
  const nodes = (await response.json()).payload.nodes as Array<Record<string, number>>;
  const map = nodes.find((node) => node.id === (mapId as unknown));
  const pin = nodes.find((node) => node.id === (pinId as unknown));
  if (!map || !pin) throw new Error("The harbour map or its pin is missing.");
  return {
    x: (map.mapX ?? map.x) + pin.mapU * map.mapWidth,
    y: (map.mapY ?? map.y) + pin.mapV * map.mapHeight,
  };
}

function kilometres(a: { x: number; y: number }, b: { x: number; y: number }) {
  return (Math.hypot(b.x - a.x, b.y - a.y) / 100) * HARBOUR_KM_PER_100PX;
}

async function targetedLabel(page: Page) {
  const edge = page.locator(".distance-edge.is-targeted");
  await expect(edge).toHaveCount(1);
  return (await edge.getAttribute("aria-label")) ?? "";
}

test("A pin and a point on the opened-out harbour map are measured in its scale", async ({
  page,
}) => {
  const { world, map } = await openHarbourMap(page);
  const mapId = world.ids.figures.nordhafen;
  const pin = page.locator(`.react-flow__node[data-id="${world.ids.figures.salzmarkt}"]`);
  await page.getByRole("button", { name: "Distanz messen", exact: true }).click();
  await expect(page.locator(".places-measure-overlays")).toBeVisible();

  await pin.locator(".place-node-pin__mark").click();
  await expect(page.locator(".places-measure-overlays").getByRole("status")).toContainText(
    "Wähle den zweiten Ort oder einen Punkt auf der Karte.",
  );
  const click = await pointOnMap(page, map, mapId, 0.85, 0.2);
  const flow = await toFlow(page, click);
  await page.mouse.click(click.x, click.y);

  const label = await targetedLabel(page);
  const match = /^Punkt – Salzmarkt: ([\d.]+) km$/.exec(label);
  expect(match, `targeted line reads "${label}"`).not.toBeNull();
  await expect(page.locator(".react-flow__node-measurePoint")).toHaveCount(1);
  const anchor = await pinAnchor(page, world.id, mapId, world.ids.figures.salzmarkt);
  const expected = kilometres(anchor, flow);
  expect(Number(match?.[1])).toBeCloseTo(expected, 1);
});

test("Two points on the harbour map are measured, and Escape takes them away", async ({ page }) => {
  const { world, map } = await openHarbourMap(page);
  const mapId = world.ids.figures.nordhafen;
  await page.getByRole("button", { name: "Distanz messen", exact: true }).click();

  const first = await pointOnMap(page, map, mapId, 0.8, 0.15);
  const second = await pointOnMap(page, map, mapId, 0.9, 0.85);
  const expected = kilometres(await toFlow(page, first), await toFlow(page, second));
  await page.mouse.click(first.x, first.y);
  await page.mouse.click(second.x, second.y);

  await expect(page.locator(".react-flow__node-measurePoint")).toHaveCount(2);
  const match = /^Punkt – Punkt: ([\d.]+) km$/.exec(await targetedLabel(page));
  expect(match).not.toBeNull();
  expect(Number(match?.[1])).toBeCloseTo(expected, 1);

  await page.keyboard.press("Escape");
  await expect(page.locator(".places-measure-overlays")).toHaveCount(0);
  await expect(page.locator(".react-flow__node-measurePoint")).toHaveCount(0);

  // Measuring left the map as it was: its places still take the pointer (T-220).
  const placeId = world.ids.figures.salzmarkt;
  const before = await page.request.get(`/api/state?world=${world.id}`);
  const stored = (body: { payload: { nodes: Array<Record<string, unknown>> } }) =>
    body.payload.nodes.find((node) => node.id === placeId);
  const was = stored(await before.json());
  const mark = page.locator(`.react-flow__node[data-id="${placeId}"] .place-node-pin__mark`);
  const box = await mark.boundingBox();
  if (!box) throw new Error("The pin has no screen geometry.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const now = stored(await (await page.request.get(`/api/state?world=${world.id}`)).json());
      return now?.mapU !== was?.mapU || now?.mapV !== was?.mapV;
    })
    .toBe(true);
});
