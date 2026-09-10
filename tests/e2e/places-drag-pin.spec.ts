import { expect, type Locator, type Page, test } from "@playwright/test";
import type { FigureNode } from "../../packages/client/src/modules/story-world/model";
import {
  expandedMapState,
  mockExpandedMapWorld,
  openExpandedMapWorld,
  waitForMapViewport,
} from "./support/expanded-map-fixture";

const PREVIEW_TOLERANCE = 1.5;

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "Pointer geometry uses the fixed wide canvas.");
  await page.addInitScript(() => {
    localStorage.setItem("quiltor-theme", "light");
    localStorage.setItem("quiltor-interface-language", "de");
  });
});

function place(state: { nodes: FigureNode[] }, id: string) {
  return state.nodes.find((node) => node.id === id);
}

async function dragPlaceToPointer({
  page,
  node,
  placeId,
  target,
  grab = { u: 0.2, v: 0.3 },
  screenshot,
}: {
  page: Page;
  node: Locator;
  placeId: string;
  target: { x: number; y: number };
  grab?: { u: number; v: number };
  screenshot?: string;
}) {
  const before = await node.boundingBox();
  if (!before) throw new Error("The dragged place has no screen geometry.");
  const start = {
    x: before.x + before.width * grab.u,
    y: before.y + before.height * grab.v,
  };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });

  const preview = page.getByTestId("place-drag-preview");
  await expect(preview).toHaveCount(1);
  await expect(preview).toHaveAttribute("data-place-id", placeId);
  await expect(node).toHaveAttribute("data-drag-preview", "true");
  await expect(node).toBeHidden();

  await expect(preview.locator(".place-drag-preview__pin")).toBeVisible();
  await expect(preview.locator(".place-drag-preview__name")).toBeVisible();
  const tip = await preview.locator(".place-drag-preview__tip").boundingBox();
  if (!tip) throw new Error("The drag preview tip has no screen geometry.");
  expect(Math.abs(tip.x + tip.width / 2 - target.x)).toBeLessThanOrEqual(PREVIEW_TOLERANCE);
  expect(Math.abs(tip.y + tip.height / 2 - target.y)).toBeLessThanOrEqual(PREVIEW_TOLERANCE);
  if (screenshot) await page.screenshot({ path: screenshot, animations: "disabled" });

  await page.mouse.up();
  await expect(preview).toHaveCount(0);
  await expect(node).not.toHaveAttribute("data-drag-preview", "true");
  await expect(node).toBeVisible();
  await expect(node.locator(".story-node")).toBeVisible();
}

function pointOn(
  rect: { x: number; y: number; width: number; height: number },
  u: number,
  v: number,
) {
  return { x: rect.x + rect.width * u, y: rect.y + rect.height * v };
}

async function expectStoredAnchor(
  savedState: () => { nodes: FigureNode[] },
  id: string,
  expected: { u: number; v: number; parentPlaceId: string },
  hostRect: { width: number; height: number },
) {
  await expect
    .poll(() => {
      const stored = place(savedState(), id);
      if (stored?.parentPlaceId !== expected.parentPlaceId) return Number.POSITIVE_INFINITY;
      return Math.max(
        Math.abs((stored.mapU ?? Number.POSITIVE_INFINITY) - expected.u) * hostRect.width,
        Math.abs((stored.mapV ?? Number.POSITIVE_INFINITY) - expected.v) * hostRect.height,
      );
    })
    .toBeLessThanOrEqual(PREVIEW_TOLERANCE);
}

test("Derived places drag by a pointer-accurate pin on expanded and entered maps", async ({
  page,
}, testInfo) => {
  const fixture = await mockExpandedMapWorld(page);
  await openExpandedMapWorld(page);
  await page.locator(".react-flow__controls-zoomin").click();
  await waitForMapViewport(page);

  const map = page.locator('.react-flow__node-placeMap[data-id="weltkarte"]');
  const mapRect = await map.boundingBox();
  if (!mapRect) throw new Error("The expanded map has no screen geometry.");
  const firstAnchor = { u: 0.61, v: 0.56 };
  await dragPlaceToPointer({
    page,
    node: page.locator('.react-flow__node[data-id="graufurth"] .place-node-shell'),
    placeId: "graufurth",
    target: pointOn(mapRect, firstAnchor.u, firstAnchor.v),
    screenshot: testInfo.outputPath("expanded-map-drag-preview.png"),
  });
  await expectStoredAnchor(
    fixture.savedState,
    "graufurth",
    {
      ...firstAnchor,
      parentPlaceId: "weltkarte",
    },
    mapRect,
  );

  await page
    .locator(".place-map-chrome")
    .getByRole("button", { name: "Weltkarte öffnen", exact: true })
    .click();
  await expect(page.locator(".react-flow__node-placeGround")).toBeVisible();
  await waitForMapViewport(page);
  const groundRect = await page.locator(".react-flow__node-placeGround").boundingBox();
  if (!groundRect) throw new Error("The entered map ground has no screen geometry.");
  const secondAnchor = { u: 0.38, v: 0.68 };
  await dragPlaceToPointer({
    page,
    node: page.locator('.react-flow__node[data-id="graufurth"] .place-node-shell'),
    placeId: "graufurth",
    target: pointOn(groundRect, secondAnchor.u, secondAnchor.v),
    grab: { u: 0.75, v: 0.25 },
  });
  await expectStoredAnchor(
    fixture.savedState,
    "graufurth",
    {
      ...secondAnchor,
      parentPlaceId: "weltkarte",
    },
    groundRect,
  );
});

test("A free place uses the pointer anchor when dropped onto an expanded map", async ({ page }) => {
  const state = expandedMapState();
  state.nodes.push({
    id: "klippenhaus",
    type: "ort",
    name: "Klippenhaus",
    label: "Ort",
    sub: "Jenseits der Küstenkarte.",
    x: -280,
    y: 260,
  });
  const fixture = await mockExpandedMapWorld(page, state);
  await openExpandedMapWorld(page);
  const mapRect = await page
    .locator('.react-flow__node-placeMap[data-id="weltkarte"]')
    .boundingBox();
  if (!mapRect) throw new Error("The expanded map has no screen geometry.");
  const anchor = { u: 0.22, v: 0.73 };
  await dragPlaceToPointer({
    page,
    node: page.locator('.react-flow__node[data-id="klippenhaus"] .place-node-shell'),
    placeId: "klippenhaus",
    target: pointOn(mapRect, anchor.u, anchor.v),
    grab: { u: 0.8, v: 0.2 },
  });
  await expectStoredAnchor(
    fixture.savedState,
    "klippenhaus",
    {
      ...anchor,
      parentPlaceId: "weltkarte",
    },
    mapRect,
  );
});

test("Pinned places and expanded maps retain their established drag behavior", async ({ page }) => {
  const state = expandedMapState();
  state.nodes.push({
    id: "wachturm",
    type: "ort",
    name: "Wachturm",
    label: "Ort",
    sub: "Bewacht den nördlichen Pass.",
    x: 0,
    y: 0,
    parentPlaceId: "weltkarte",
    mapU: 0.52,
    mapV: 0.2,
    pinned: true,
  });
  const fixture = await mockExpandedMapWorld(page, state);
  await openExpandedMapWorld(page);

  const pinned = page.locator('.react-flow__node[data-id="wachturm"]');
  await expect(pinned).not.toHaveClass(/\bdraggable\b/);
  const pinnedRect = await pinned.boundingBox();
  if (!pinnedRect) throw new Error("The pinned place has no screen geometry.");
  await page.mouse.move(pinnedRect.x + pinnedRect.width / 2, pinnedRect.y + pinnedRect.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    pinnedRect.x + pinnedRect.width / 2 + 60,
    pinnedRect.y + pinnedRect.height / 2 + 40,
    { steps: 8 },
  );
  await expect(page.getByTestId("place-drag-preview")).toHaveCount(0);
  await page.mouse.up();
  expect(place(fixture.savedState(), "wachturm")).toMatchObject({ mapU: 0.52, mapV: 0.2 });

  const chrome = page.locator(".place-map-chrome");
  await chrome.getByRole("button", { name: "Weltkarte lösen", exact: true }).click();
  await expect.poll(() => place(fixture.savedState(), "weltkarte")?.pinned).toBe(false);
  const map = page.locator('.react-flow__node-placeMap[data-id="weltkarte"]');
  const before = await map.boundingBox();
  if (!before) throw new Error("The expanded map has no screen geometry.");
  await page.mouse.move(before.x + before.width * 0.4, before.y + before.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width * 0.4 + 70, before.y + before.height * 0.4 + 45, {
    steps: 12,
  });
  await expect(page.getByTestId("place-drag-preview")).toHaveCount(0);
  await expect(map.locator(".place-map-node")).toBeVisible();
  await page.mouse.up();
  await expect
    .poll(() => {
      const moved = place(fixture.savedState(), "weltkarte");
      return [moved?.mapX, moved?.mapY];
    })
    .not.toEqual([undefined, undefined]);
});

test("Blur and touch cancellation restore the place without persisting the drag", async ({
  page,
}) => {
  const fixture = await mockExpandedMapWorld(page);
  await openExpandedMapWorld(page);
  const node = page.locator('.react-flow__node[data-id="graufurth"] .place-node-shell');
  const original = await node.boundingBox();
  if (!original) throw new Error("The derived place has no screen geometry.");
  const mapRect = await page
    .locator('.react-flow__node-placeMap[data-id="weltkarte"]')
    .boundingBox();
  if (!mapRect) throw new Error("The expanded map has no screen geometry.");

  for (const cancellation of ["blur", "touchcancel"] as const) {
    await page.mouse.move(original.x + original.width * 0.25, original.y + original.height * 0.3);
    await page.mouse.down();
    const target = pointOn(mapRect, cancellation === "blur" ? 0.68 : 0.55, 0.64);
    await page.mouse.move(target.x, target.y, { steps: 10 });
    await expect(page.getByTestId("place-drag-preview")).toHaveCount(1);
    await page.evaluate((type) => window.dispatchEvent(new Event(type)), cancellation);
    await expect(page.getByTestId("place-drag-preview")).toHaveCount(0);
    await expect(node).toBeVisible();
    await page.mouse.up();
    await expect
      .poll(async () => {
        const restored = await node.boundingBox();
        if (!restored) return Number.POSITIVE_INFINITY;
        return Math.max(Math.abs(restored.x - original.x), Math.abs(restored.y - original.y));
      })
      .toBeLessThanOrEqual(PREVIEW_TOLERANCE);
    expect(place(fixture.savedState(), "graufurth")).toMatchObject({
      parentPlaceId: "weltkarte",
      mapU: 0.3,
      mapV: 0.4,
    });
  }
});
