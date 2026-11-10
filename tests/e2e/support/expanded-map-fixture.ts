import { expect, type Page } from "@playwright/test";
import type { FigureState } from "../../../packages/client/src/modules/story-world/model";
import { decodeStoryWorldV1 } from "../../../packages/client/src/platform/contracts/v1/storyWorld";
import { WORLD } from "../../world/ids.generated";
import {
  fulfillDocumentSave,
  fulfillStoryWorld,
  mockRequiredWorldDocuments,
} from "./application-api";
import { exampleWorldDocuments } from "./example-world";

const mapImage = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="680" viewBox="0 0 1000 680">
  <rect width="1000" height="680" fill="#d4e1e3"/>
  <path d="M0 0H750L715 65 815 130 725 180 810 240 695 295 775 350 690 415 740 490 650 550 660 680H0Z" fill="#e8e5d6" stroke="#829b98" stroke-width="3"/>
  <path d="M65 100Q225 180 380 95T660 130M90 235Q250 160 425 260T690 225M35 440Q215 330 400 440T620 400M115 565Q300 495 500 590" fill="none" stroke="#c4cdb5" stroke-width="28" opacity=".65"/>
  <path d="M225 0Q160 120 315 220T380 415Q420 495 695 500" fill="none" stroke="#a9c7cf" stroke-width="13"/>
  <path d="M115 375Q300 330 550 220M330 440Q430 520 575 550M310 210Q465 300 550 220" fill="none" stroke="#b8a88d" stroke-width="3" stroke-dasharray="9 8"/>
  <g fill="#97aa99" opacity=".6"><path d="M95 90l20-34 20 34zM130 102l24-40 24 40zM172 82l20-34 20 34zM470 87l22-38 22 38zM510 105l28-48 28 48zM560 84l20-34 20 34z"/></g>
</svg>`;

/** The ids of the test world's opened-out maps and the places standing on them. */
const MAP = WORLD.figures.xWeltkarte;
const ISLAND = WORLD.figures.xInselkarte;

/**
 * The opened-out map of the test world's check part, on its own: the world map with its three
 * places and, on request, the island map beside it. Nothing else of the world comes along, so
 * the canvas fits the same picture as before the world existed. The variants fold the map,
 * drop its scale or add the second map, as the map specs need them.
 */
export function expandedMapState({
  expanded = true,
  scale = true,
  secondMap = false,
}: {
  expanded?: boolean;
  scale?: boolean;
  secondMap?: boolean;
} = {}): FigureState {
  const { storyWorld } = exampleWorldDocuments({ include: ["base", "edge"] });
  const maps = new Set<string>(secondMap ? [MAP, ISLAND] : [MAP]);
  const nodes = structuredClone(
    storyWorld.nodes.filter(
      (node) =>
        maps.has(node.id) || (node.parentPlaceId !== undefined && maps.has(node.parentPlaceId)),
    ),
  );
  const map = nodes.find((node) => node.id === MAP);
  if (!map) throw new Error("The test world has lost its opened-out map.");
  // The specs measure the maps from the canvas origin and without a stored map position, the
  // way the fixture placed them before the world existed: a resize then writes a position of
  // its own, which the grip specs read. The cards carry no accent either, which the places
  // baseline photographs.
  for (const node of nodes) {
    delete node.accent;
    if (node.id === MAP) Object.assign(node, { x: 0, y: 0 });
    if (node.id === ISLAND) Object.assign(node, { x: 700, y: 0 });
    if (node.id === MAP || node.id === ISLAND) {
      delete node.mapX;
      delete node.mapY;
    }
  }
  map.mapExpanded = expanded;
  if (!scale) delete map.mapScale;
  // Beside the island map the world map is shown smaller, as the two-map specs expect.
  if (secondMap) Object.assign(map, { mapWidth: 600, mapHeight: 500 });
  return { nodes, edges: [], timeline: [], presence: [] };
}

/** All document reads and writes stay in this browser context, using the real wire codec. */
export async function mockExpandedMapWorld(page: Page, initialState = expandedMapState()) {
  let state = structuredClone(initialState);
  let revision = 0;
  const world = {
    id: "kartenwerkstatt",
    title: "Die nördlichen Küsten",
    backupUrl: "",
    updated: "2026-09-09T12:00:00Z",
  };
  await page.route("**/api/version", (route) =>
    route.fulfill({ json: { ok: true, version: "map-chrome" } }),
  );
  await page.route("**/api/whoami", (route) => route.fulfill({ json: { ok: false } }));
  await page.route("**/api/worlds", (route) =>
    route.fulfill({ json: { ok: true, worlds: [world] } }),
  );
  await page.route("**/api/worlds/open", (route) => route.fulfill({ json: { ok: true, world } }));
  await mockRequiredWorldDocuments(page, {
    manuscript: exampleWorldDocuments().manuscript,
    storyWorld: state,
  });
  await page.route("**/api/state*", (route) => {
    if (route.request().method() === "GET") return fulfillStoryWorld(route, state, revision);
    state = decodeStoryWorldV1(route.request().postDataJSON()).document;
    revision += 1;
    return fulfillDocumentSave(route, revision);
  });
  await page.route("**/api/place-map?*", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: mapImage }),
  );
  await page.route("**/api/assistant/status*", (route) =>
    route.fulfill({
      json: { ok: true, available: false, mode: "local", reason: "-", chunks: 0 },
    }),
  );
  return { savedState: () => state };
}

export async function openExpandedMapWorld(page: Page) {
  await page.goto("/?world=kartenwerkstatt");
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();
  await page.getByRole("button", { name: "Orte", exact: true }).click();
  await expect(page.locator(".places-workspace")).toBeVisible();
  await waitForMapViewport(page);
}

export async function waitForMapViewport(page: Page) {
  const viewport = page.locator(".places-flow-area .react-flow__viewport");
  let previous: string | null = null;
  await expect
    .poll(async () => {
      const current = await viewport.getAttribute("style");
      const settled = current !== null && current === previous;
      previous = current;
      return settled;
    })
    .toBe(true);
}

export async function closePlaceSheet(page: Page) {
  const sheet = page.getByRole("dialog", { name: "Orte-Inspector" });
  if (await sheet.isVisible()) {
    await page.keyboard.press("Escape");
    await expect(sheet).not.toBeVisible();
  }
}

/**
 * A command of a place card, where the user reaches it. Up to 820px the places workspace is
 * compact: selecting a card opens the inspector as a sheet over the canvas, so the card carries
 * no commands and the sheet offers them (D-T-219-F2). Wider, they are the card's own.
 */
export async function placeCardCommand(page: Page, nodeId: string, name: string) {
  const node = page.locator(`.react-flow__node[data-id="${nodeId}"]`);
  if ((page.viewportSize()?.width ?? 0) > 820) return node.getByRole("button", { name });
  const sheet = page.getByRole("dialog", { name: "Orte-Inspector" });
  if (!(await sheet.isVisible())) await node.click();
  await expect(sheet).toBeVisible();
  return sheet.getByRole("button", { name, exact: true });
}

export async function selectMapChild(page: Page) {
  const child = page.locator('.react-flow__node[data-id="x-graufurth"]');
  await child.click();
  await expect(page.locator(".places-inspector-header strong")).toHaveText("Graufurth");
  await closePlaceSheet(page);
  await waitForMapViewport(page);
}
