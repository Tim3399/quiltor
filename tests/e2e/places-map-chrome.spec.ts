import { expect, test } from "./support/transient-network";
import {
  closePlaceSheet,
  expandedMapState,
  mockExpandedMapWorld,
  openExpandedMapWorld,
  selectMapChild,
  waitForMapViewport,
} from "./support/expanded-map-fixture";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("quiltor-theme", "light");
    localStorage.setItem("quiltor-interface-language", "de");
  });
});

test("Expanded map identity survives child selection and clearing the selection", async ({
  page,
}) => {
  await mockExpandedMapWorld(page);
  await openExpandedMapWorld(page);
  const chrome = page.locator('.place-map-chrome[data-map-id="x-weltkarte"]');
  await expect(chrome).toBeVisible();
  await expect(chrome.locator(".place-map-chrome__name")).toHaveText("Weltkarte");
  await expect(chrome.locator(".place-map-chrome__footer")).toContainText("25 km");
  await selectMapChild(page);
  await expect(chrome).toBeVisible();
  await expect(page.locator(".place-map-chrome")).toHaveCount(1);

  // A pane click clears editing selection but must keep the active map surface.
  let empty: { x: number; y: number } | null = null;
  for (let attempt = 0; attempt < 4 && !empty; attempt += 1) {
    empty = await page.locator(".react-flow__pane").evaluate((pane) => {
      const rect = pane.getBoundingClientRect();
      for (let y = rect.top + 4; y < rect.bottom; y += 24) {
        for (let x = rect.left + 4; x < rect.right; x += 24) {
          if (document.elementFromPoint(x, y) === pane) return { x, y };
        }
      }
      return null;
    });
    if (!empty) {
      await page.locator(".react-flow__controls-zoomout").click();
      await waitForMapViewport(page);
    }
  }
  if (!empty) throw new Error("No empty canvas point is reachable");
  await page.mouse.click(empty.x, empty.y);
  await expect(page.locator(".places-inspector")).toHaveCount(0);
  await expect(chrome).toBeVisible();
});

test("Expanded header keeps crop, lock, enter and collapse actions on the same map", async ({
  page,
}) => {
  const fixture = await mockExpandedMapWorld(page);
  await openExpandedMapWorld(page);
  const chrome = page.locator(".place-map-chrome");
  await chrome.getByRole("button", { name: "Bild in Weltkarte anpassen" }).click();
  await expect(chrome.locator(".place-map-chrome__name")).toHaveText("Weltkarte");
  await chrome.getByRole("button", { name: "Bild vergrößern" }).click();
  await expect
    .poll(() => fixture.savedState().nodes.find((node) => node.id === "x-weltkarte")?.mapImageZoom)
    .toBeGreaterThan(1);
  await chrome.getByRole("button", { name: "Bild in Weltkarte fertig anpassen" }).click();
  await chrome.getByRole("button", { name: "Weltkarte lösen", exact: true }).click();
  await expect(chrome.getByRole("button", { name: "Weltkarte feststellen" })).toBeVisible();
  await chrome.getByRole("button", { name: "Weltkarte feststellen" }).click();
  await expect(chrome.getByRole("button", { name: "Weltkarte lösen", exact: true })).toBeVisible();

  await chrome.getByRole("button", { name: "Weltkarte öffnen", exact: true }).click();
  await expect(page.locator(".place-level-trail")).toContainText("Weltkarte");
  await expect(chrome).toHaveCount(0);
  await page
    .locator(".place-level-trail")
    .getByRole("button", { name: "Welt", exact: true })
    .click();
  await expect(chrome).toBeVisible();
  await chrome.getByRole("button", { name: "Weltkarte einklappen" }).click();
  await expect(chrome).toHaveCount(0);
  await closePlaceSheet(page);
  await expect
    .poll(() => fixture.savedState().nodes.find((node) => node.id === "x-weltkarte")?.mapExpanded)
    .toBe(false);
  await expect(page.locator('.react-flow__node-placeMap[data-id="x-weltkarte"]')).toHaveCount(0);
  const card = page.locator('.react-flow__node[data-id="x-weltkarte"]');
  await expect(card.locator(".story-node.is-map")).toBeVisible();
  // The node can be clipped at the compact viewport edge, where a generic node click may
  // choose one of its nested map-action buttons as the first reachable hit target.
  await card.locator("strong").click();
  if ((page.viewportSize()?.width ?? 0) <= 820) {
    await expect(page.getByRole("dialog", { name: "Orte-Inspector" })).toBeVisible();
  }
  await closePlaceSheet(page);
  await expect(page.getByRole("button", { name: "Weltkarte aufklappen" }).first()).toBeVisible();
});

test("Footer scale edits persist through the map state and update map measurements", async ({
  page,
}) => {
  const fixture = await mockExpandedMapWorld(page);
  await openExpandedMapWorld(page);
  const chrome = page.locator(".place-map-chrome");
  await chrome.getByRole("button", { name: "Maßstab von Weltkarte" }).click();
  const editor = page.getByRole("dialog", { name: "Maßstab von Weltkarte" });
  await editor.getByRole("spinbutton", { name: "Maßstab", exact: true }).fill("50");
  await editor.getByRole("textbox", { name: "Einheit" }).fill("km");
  await page.keyboard.press("Escape");
  await expect
    .poll(() => fixture.savedState().nodes.find((node) => node.id === "x-weltkarte")?.mapScale)
    .toEqual({ unitsPer100px: 50, unitLabel: "km" });
  await expect(chrome.locator(".place-map-chrome__footer")).toContainText("50 km");
  await expect(chrome.locator(".place-map-chrome__grid .place-map-chrome__value")).toHaveText(
    "24 km",
  );
  const map = fixture.savedState().nodes.find((node) => node.id === "x-weltkarte");
  expect(map).toMatchObject({ mapWidth: 1000, mapHeight: 680 });
  expect(fixture.savedState().nodes.find((node) => node.id === "x-graufurth")).toMatchObject({
    mapU: 0.3,
    mapV: 0.4,
    parentPlaceId: "x-weltkarte",
  });

  await page.getByRole("button", { name: "Distanz messen", exact: true }).click();
  // These anchors are 400 flow units apart; the map's edited scale is 50 km / 100 units.
  await expect(
    page.locator('.react-flow__edge[aria-label="Graufurth – Nordhafen: 200 km"]'),
  ).toHaveCount(1);
  await expect(chrome).toBeVisible();
});

test("Unscaled maps and hidden grids report truthful footer metadata", async ({ page }) => {
  await mockExpandedMapWorld(page, expandedMapState({ scale: false }));
  await openExpandedMapWorld(page);
  const footer = page.locator(".place-map-chrome__footer");
  await expect(footer).not.toContainText("km");
  await expect(footer.locator(".place-map-chrome__grid .place-map-chrome__value")).toHaveText(
    "48 px",
  );
  await expect(footer.locator(".place-map-chrome__scale-bar")).toHaveCount(0);
  await expect(footer.getByRole("button", { name: "Maßstab von Weltkarte" })).toBeVisible();
  await page.getByRole("button", { name: "Ansicht", exact: true }).click();
  await page.getByRole("menuitem", { name: "Raster ausblenden" }).click();
  await expect(page.locator(".place-plate__grid")).toHaveCount(0);
  await expect(footer).toContainText("Aus");
});

test("Only the active expanded map owns chrome and collapse falls back to the remaining map", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Two full maps need the wide canvas for direct selection.",
  );
  await mockExpandedMapWorld(page, expandedMapState({ secondMap: true }));
  await openExpandedMapWorld(page);
  await page
    .locator('.react-flow__node[data-id="x-weltkarte"]')
    .click({ position: { x: 100, y: 100 } });
  await expect(page.locator(".place-map-chrome")).toHaveAttribute("data-map-id", "x-weltkarte");
  await page.getByRole("button", { name: "Auswahl schließen" }).click();
  await page
    .locator('.react-flow__node[data-id="x-inselkarte"]')
    .click({ position: { x: 100, y: 100 } });
  await expect(page.locator(".place-map-chrome")).toHaveCount(1);
  await expect(page.locator(".place-map-chrome")).toHaveAttribute("data-map-id", "x-inselkarte");
  await page.getByRole("button", { name: "Auswahl schließen" }).click();
  await page.locator('.react-flow__node[data-id="x-graufurth"]').click();
  await expect(page.locator(".place-map-chrome")).toHaveAttribute("data-map-id", "x-weltkarte");
  await page.getByRole("button", { name: "Auswahl schließen" }).click();
  await page.locator('.react-flow__node[data-id="x-inselhafen"]').click();
  await expect(page.locator(".place-map-chrome")).toHaveAttribute("data-map-id", "x-inselkarte");
  await page
    .locator(".place-map-chrome")
    .getByRole("button", { name: "Inselkarte einklappen" })
    .click();
  await expect(page.locator(".place-map-chrome")).toHaveAttribute("data-map-id", "x-weltkarte");
});

test("Chrome follows pan and zoom and disappears when its map leaves the canvas", async ({
  page,
}) => {
  await mockExpandedMapWorld(page);
  await openExpandedMapWorld(page);
  const chrome = page.locator(".place-map-chrome");
  const map = page.locator('.react-flow__node-placeMap[data-id="x-weltkarte"]');
  const before = await map.boundingBox();
  expect(before).not.toBeNull();
  await page.locator(".react-flow__controls-zoomin").click();
  await waitForMapViewport(page);
  const enlarged = await map.boundingBox();
  expect(enlarged?.width).toBeGreaterThan(before?.width ?? 0);
  await expect(chrome).toBeVisible();
  const canvas = await page.locator(".places-flow-area").boundingBox();
  if (!canvas) throw new Error("Places canvas has no geometry");
  // Middle-button panning works over both the map and pins without changing their geometry.
  for (let step = 0; step < 6 && (await chrome.isVisible()); step += 1) {
    await page.mouse.move(canvas.x + canvas.width * 0.25, canvas.y + canvas.height * 0.5);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(canvas.x + canvas.width * 0.9, canvas.y + canvas.height * 0.5, {
      steps: 5,
    });
    await page.mouse.up({ button: "middle" });
  }
  await expect(chrome).not.toBeVisible();
  await page.locator(".react-flow__controls-fitview").click();
  await expect(chrome).toBeVisible();
});

test("Reduced motion expansion frames immediately without intermediate camera travel", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockExpandedMapWorld(page, expandedMapState({ expanded: false }));
  await openExpandedMapWorld(page);
  const viewport = page.locator(".places-flow-area .react-flow__viewport");
  await viewport.evaluate((element) => {
    const record = { frames: [element.getAttribute("style") ?? ""] };
    (window as unknown as { mapCameraProbe: typeof record }).mapCameraProbe = record;
    new MutationObserver(() => record.frames.push(element.getAttribute("style") ?? "")).observe(
      element,
      {
        attributes: true,
        attributeFilter: ["style"],
      },
    );
  });
  await page.getByRole("button", { name: "Weltkarte aufklappen" }).first().click();
  await expect(page.locator(".place-map-chrome")).toBeVisible();
  await waitForMapViewport(page);
  const frames = await page.evaluate(() => [
    ...new Set(
      (window as unknown as { mapCameraProbe: { frames: string[] } }).mapCameraProbe.frames,
    ),
  ]);
  expect(
    frames.length,
    "Reduced motion must jump directly from the card view to the map view",
  ).toBeLessThanOrEqual(2);
  expect(frames.length).toBeGreaterThan(1);
});

test("Map edges remain resizable and child anchors stay on the world surface", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "The side-edge drag needs the wide canvas.");
  const fixture = await mockExpandedMapWorld(page);
  await openExpandedMapWorld(page);
  const map = page.locator('.react-flow__node-placeMap[data-id="x-weltkarte"]');
  await map.click({ position: { x: 100, y: 150 } });
  const edge = map.locator(".place-map-node__line.left");
  await expect(edge).toBeVisible();
  const grip = await edge.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    for (const horizontal of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      for (const vertical of [0.25, 0.5, 0.75]) {
        const x = rect.left + rect.width * horizontal;
        const y = rect.top + rect.height * vertical;
        if (document.elementFromPoint(x, y)?.closest(".react-flow__resize-control") === element)
          return { x, y };
      }
    }
    throw new Error("Map side edge has no unobscured resize target");
  });
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.move(grip.x - 60, grip.y, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(() => fixture.savedState().nodes.find((node) => node.id === "x-weltkarte")?.mapWidth)
    .toBeGreaterThan(1000);
  expect(fixture.savedState().nodes.find((node) => node.id === "x-graufurth")).toMatchObject({
    mapU: 0.3,
    mapV: 0.4,
  });
  const anchor = await page.locator('.react-flow__node[data-id="x-graufurth"]').boundingBox();
  const rect = await map.boundingBox();
  if (!anchor || !rect) throw new Error("Resized map or child anchor has no geometry");
  expect((anchor.x + anchor.width / 2 - rect.x) / rect.width).toBeCloseTo(0.3, 2);
  expect((anchor.y + anchor.height / 2 - rect.y) / rect.height).toBeCloseTo(0.4, 2);
  await expect(page.locator(".place-map-chrome")).toBeVisible();
});

type Side = "left" | "right" | "top" | "bottom";
const OPPOSITE: Record<Side, Side> = { left: "right", right: "left", top: "bottom", bottom: "top" };
const OUTWARD: Record<Side, [number, number]> = {
  left: [-60, 0],
  right: [60, 0],
  top: [0, -60],
  bottom: [0, 60],
};

for (const side of ["left", "right", "top", "bottom"] as const) {
  test(`Dragging the ${side} grip moves only the ${side} edge of the map`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "wide", "The edge drag needs the wide canvas.");
    const fixture = await mockExpandedMapWorld(page);
    await openExpandedMapWorld(page);
    const map = page.locator('.react-flow__node-placeMap[data-id="x-weltkarte"]');
    // Selecting opens the inspector, which would cover the right edge of a map
    // that fills the view. Zooming out first (that click clears the selection)
    // brings all four edges into open canvas.
    for (let step = 0; step < 3; step += 1) {
      await page.locator(".react-flow__controls-zoomout").click();
    }
    await waitForMapViewport(page);
    await map.click({ position: { x: 60, y: 80 } });
    const line = map.locator(`.place-map-node__line.${side}`);
    await expect(line).toBeAttached();
    const grip = await line.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const horizontal = rect.width > rect.height;
      for (const along of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        for (const across of [0.5, 0.3, 0.7]) {
          const x = rect.left + rect.width * (horizontal ? along : across);
          const y = rect.top + rect.height * (horizontal ? across : along);
          if (document.elementFromPoint(x, y)?.closest(".react-flow__resize-control") === element)
            return { x, y };
        }
      }
      throw new Error("Map edge has no unobscured resize target");
    });
    const before = await map.boundingBox();
    if (!before) throw new Error("Map has no geometry");
    const edges = (box: {
      x: number;
      y: number;
      width: number;
      height: number;
    }): Record<Side, number> => ({
      left: box.x,
      right: box.x + box.width,
      top: box.y,
      bottom: box.y + box.height,
    });
    const was = edges(before);
    const [dx, dy] = OUTWARD[side];
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(grip.x + dx, grip.y + dy, { steps: 10 });
    await page.mouse.up();
    await expect
      .poll(async () => {
        const box = await map.boundingBox();
        return box ? Math.abs(edges(box)[side] - was[side]) : 0;
      })
      .toBeGreaterThan(20);
    const after = await map.boundingBox();
    if (!after) throw new Error("Resized map has no geometry");
    const now = edges(after);
    for (const other of ["left", "right", "top", "bottom"] as const) {
      if (other === side) continue;
      expect(now[other], `the ${other} edge must stay where it was`).toBeCloseTo(was[other], 0);
    }
    expect(now[OPPOSITE[side]]).toBeCloseTo(was[OPPOSITE[side]], 0);
    await expect
      .poll(() => {
        const saved = fixture.savedState().nodes.find((node) => node.id === "x-weltkarte");
        return { x: (saved?.mapX ?? 0) < 0, y: (saved?.mapY ?? 0) < 0 };
      })
      .toEqual({ x: side === "left", y: side === "top" });
  });
}
