import type { Locator, Page } from "@playwright/test";
import type { FigureNode } from "../../packages/client/src/modules/story-world/model";
import {
  expandedMapState,
  mockExpandedMapWorld,
  openExpandedMapWorld,
} from "./support/expanded-map-fixture";
import { createTestWorld, expect, test } from "./support/world-fixture";

const GEOMETRY_TOLERANCE = 1.5;

function node(state: { nodes: FigureNode[] }, id: string) {
  return state.nodes.find((item) => item.id === id);
}

function placeNode(page: Page, id: string) {
  return page.locator(`.react-flow__node[data-id="${id}"]`);
}

async function expectCenterAt(locator: Locator, expected: { x: number; y: number }) {
  await expect
    .poll(async () => {
      const rect = await locator.boundingBox();
      if (!rect) return Number.POSITIVE_INFINITY;
      return Math.max(
        Math.abs(rect.x + rect.width / 2 - expected.x),
        Math.abs(rect.y + rect.height / 2 - expected.y),
      );
    })
    .toBeLessThanOrEqual(GEOMETRY_TOLERANCE);
}

async function useGermanTheme(page: Page, theme: "light" | "dark" = "light") {
  await page.addInitScript((selected) => {
    localStorage.setItem("quiltor-theme", selected);
    localStorage.setItem("quiltor-interface-language", "de");
  }, theme);
}

function waitForStoryWorldWrite(page: Page, marker: string) {
  return page.waitForResponse(
    (response) =>
      response.url().includes("/api/state") &&
      response.request().method() === "PUT" &&
      Boolean(response.request().postData()?.includes(marker)) &&
      response.ok(),
  );
}

async function expectAnchorUnchanged(
  savedState: () => { nodes: FigureNode[] },
  id: string,
  expected: { parentPlaceId: string; mapU: number; mapV: number },
) {
  await expect
    .poll(() => {
      const place = node(savedState(), id);
      return {
        parentPlaceId: place?.parentPlaceId,
        mapU: place?.mapU,
        mapV: place?.mapV,
      };
    })
    .toEqual(expected);
}

test("A map place toggles between card and pin without moving its anchor", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "Toggle geometry uses the fixed wide canvas.");
  await useGermanTheme(page);
  const fixture = await mockExpandedMapWorld(page);
  await openExpandedMapWorld(page);

  const graufurthNode = placeNode(page, "graufurth");
  const card = graufurthNode.locator(".story-node");
  const cardRect = await card.boundingBox();
  if (!cardRect) throw new Error("The place card has no screen geometry.");
  const cardCenter = { x: cardRect.x + cardRect.width / 2, y: cardRect.y + cardRect.height / 2 };
  await card.hover();
  await graufurthNode
    .getByRole("button", { name: "Ort Graufurth als Stecknadel anzeigen" })
    .click();

  const pin = page.locator('.place-node-pin[data-place-id="graufurth"]');
  await expect(pin).toBeVisible();
  await expectCenterAt(pin.locator(".place-node-pin__tip"), cardCenter);
  await expectAnchorUnchanged(fixture.savedState, "graufurth", {
    parentPlaceId: "weltkarte",
    mapU: 0.3,
    mapV: 0.4,
  });
  await page.mouse.move(20, 500);
  await page.screenshot({
    path: testInfo.outputPath("light-pin-unselected.png"),
    animations: "disabled",
  });

  await page.getByRole("button", { name: "Orte rückgängig", exact: true }).click();
  await expect(card).toBeVisible();
  await page.getByRole("button", { name: "Orte wiederholen", exact: true }).click();
  await expect(pin).toBeVisible();
  await pin.locator(".place-node-pin__name").click();
  await expect(page.locator(".places-inspector")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("light-pin-selected.png"),
    animations: "disabled",
  });
  await page
    .locator(".places-inspector")
    .getByRole("button", { name: "Ort Graufurth als Karte anzeigen" })
    .click();
  await expect(card).toBeVisible();
  await expectCenterAt(card, cardCenter);
  await expectAnchorUnchanged(fixture.savedState, "graufurth", {
    parentPlaceId: "weltkarte",
    mapU: 0.3,
    mapV: 0.4,
  });
  await expect(placeNode(page, "nordhafen").locator(".story-node")).toBeVisible();
});

test("A permanent pin survives a real backend reload", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "Persistence needs one isolated backend world.");
  await useGermanTheme(page);
  const world = await createTestWorld(page, "Stecknadel-Persistenz");
  await page.goto(`/?world=${world.id}`);
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();
  await page.getByRole("button", { name: "Orte", exact: true }).click();

  const created = waitForStoryWorldWrite(page, '"name":"Neuer Ort"');
  await page.getByRole("button", { name: "Neuer Ort", exact: true }).click();
  await created;
  const inspector = page.locator(".places-inspector");
  await expect(inspector).toBeVisible();
  const pinned = waitForStoryWorldWrite(page, '"placeDisplay":"pin"');
  await inspector.getByRole("button", { name: "Ort Neuer Ort als Stecknadel anzeigen" }).click();
  await pinned;
  await expect(page.getByRole("status")).toContainText("Gespeichert");

  await page.reload();
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();
  await page.getByRole("button", { name: "Orte", exact: true }).click();
  await expect(page.locator(".place-node-pin[data-place-id] .place-node-pin__name")).toHaveText(
    "Neuer Ort",
  );
  const persisted = await page.request.get(`/api/state?world=${world.id}`);
  expect(persisted.ok()).toBeTruthy();
  const payload = (await persisted.json()) as { payload: { nodes: FigureNode[] } };
  expect(payload.payload.nodes.find((item) => item.name === "Neuer Ort")).toMatchObject({
    placeDisplay: "pin",
  });
});

test("A permanent pin keeps pointer-accurate placement and returns as a card", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Pointer geometry is covered once at the full map size.",
  );
  await useGermanTheme(page);
  const state = expandedMapState();
  Object.assign(node(state, "graufurth") ?? {}, { placeDisplay: "pin" });
  const fixture = await mockExpandedMapWorld(page, state);
  await openExpandedMapWorld(page);

  const mapRect = await page
    .locator('.react-flow__node-placeMap[data-id="weltkarte"]')
    .boundingBox();
  if (!mapRect) throw new Error("The expanded map has no screen geometry.");
  const target = { u: 0.64, v: 0.58 };
  const pointer = {
    x: mapRect.x + mapRect.width * target.u,
    y: mapRect.y + mapRect.height * target.v,
  };
  const permanentPin = page.locator('.place-node-pin[data-place-id="graufurth"]');
  const startTip = await permanentPin.locator(".place-node-pin__tip").boundingBox();
  if (!startTip) throw new Error("The permanent pin tip has no screen geometry.");
  await page.mouse.move(startTip.x + startTip.width / 2, startTip.y + startTip.height / 2);
  await page.mouse.down();
  await page.mouse.move(pointer.x, pointer.y, { steps: 12 });
  const previewTip = await page
    .getByTestId("place-drag-preview")
    .locator(".place-drag-preview__tip")
    .boundingBox();
  if (!previewTip) throw new Error("The drag preview tip has no screen geometry.");
  expect(Math.abs(previewTip.x + previewTip.width / 2 - pointer.x)).toBeLessThanOrEqual(
    GEOMETRY_TOLERANCE,
  );
  expect(Math.abs(previewTip.y + previewTip.height / 2 - pointer.y)).toBeLessThanOrEqual(
    GEOMETRY_TOLERANCE,
  );
  await page.mouse.up();
  await expect(permanentPin).toBeVisible();
  await expect
    .poll(() => {
      const place = node(fixture.savedState(), "graufurth");
      if (place?.placeDisplay !== "pin") return Number.POSITIVE_INFINITY;
      return Math.max(
        Math.abs((place.mapU ?? Number.POSITIVE_INFINITY) - target.u) * mapRect.width,
        Math.abs((place.mapV ?? Number.POSITIVE_INFINITY) - target.v) * mapRect.height,
      );
    })
    .toBeLessThanOrEqual(GEOMETRY_TOLERANCE);
  await expectCenterAt(permanentPin.locator(".place-node-pin__tip"), pointer);

  await permanentPin.getByRole("button", { name: "Ort Graufurth als Karte anzeigen" }).click();
  const card = placeNode(page, "graufurth").locator(".story-node");
  await expect(card).toBeVisible();
  await expectCenterAt(card, pointer);
});

test("Compact pin toggles remain keyboard reachable without replacing map actions", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "compact", "This scenario owns the compact viewport.");
  await useGermanTheme(page, "dark");
  const fixture = await mockExpandedMapWorld(page);
  await openExpandedMapWorld(page);
  const graufurthNode = placeNode(page, "graufurth");
  const toPin = graufurthNode.getByRole("button", {
    name: "Ort Graufurth als Stecknadel anzeigen",
  });
  await toPin.focus();
  await expect(toPin).toBeFocused();
  await page.keyboard.press("Enter");
  const pin = page.locator('.place-node-pin[data-place-id="graufurth"]');
  await expect(pin).toBeVisible();
  const toCard = pin.getByRole("button", { name: "Ort Graufurth als Karte anzeigen" });
  await expect(toCard).toBeFocused();
  await page.keyboard.press("Space");
  await expect(graufurthNode.locator(".story-node")).toBeVisible();
  await expect(toPin).toBeFocused();
  await expect
    .poll(() => node(fixture.savedState(), "graufurth")?.placeDisplay ?? "card")
    .toBe("card");
  await expect(
    page.locator(".place-map-chrome").getByRole("button", { name: "Weltkarte einklappen" }),
  ).toBeVisible();

  await page.keyboard.press("Enter");
  await expect(pin).toBeVisible();
  await expect(toCard).toBeFocused();
  await expect
    .poll(async () => {
      const icon = await toCard.locator("svg").boundingBox();
      if (!icon) return Number.POSITIVE_INFINITY;
      return Math.max(Math.abs(icon.width - 16), Math.abs(icon.height - 16));
    })
    .toBeLessThanOrEqual(GEOMETRY_TOLERANCE);
  await page.screenshot({
    path: testInfo.outputPath("dark-compact-pin.png"),
    animations: "disabled",
  });
});
