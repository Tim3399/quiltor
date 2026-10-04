import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FigureNode } from "../../packages/client/src/modules/story-world/model";
import { encodeStoryWorldDocument } from "./support/application-api";
import { createTestWorld, expect, test } from "./support/world-fixture";

const occupiedMap: FigureNode = {
  id: "world-map",
  type: "ort",
  name: "Weltkarte",
  x: 80,
  y: 80,
};

const mapChild: FigureNode = {
  id: "harbour",
  type: "ort",
  name: "Hafen",
  x: 80,
  y: 80,
  parentPlaceId: occupiedMap.id,
};

const emptyPlace: FigureNode = {
  id: "wasteland",
  type: "ort",
  name: "Ödland",
  x: 420,
  y: 180,
};

async function seedPlaces(page: Page, worldId: string) {
  const mapImage = await readFile("distribution/assets/icons/icon.iconset/icon_128x128.png");
  const upload = await page.request.post(`/api/place-maps?world=${worldId}`, {
    data: { data: mapImage.toString("base64") },
  });
  expect(upload.ok(), await upload.text()).toBeTruthy();
  const storedImage = (await upload.json()) as { id?: unknown };
  expect(typeof storedImage.id).toBe("string");
  const mapImageId = storedImage.id as string;
  const map = {
    ...occupiedMap,
    mapImageId,
    mapWidth: 640,
    mapHeight: 400,
    mapExpanded: false,
  };
  const child = { ...mapChild, mapU: 0.35, mapV: 0.62 };
  const path = `/api/state?world=${worldId}`;
  const current = await page.request.get(path);
  expect(current.ok(), await current.text()).toBeTruthy();
  const revisionHeader = current.headers().etag ?? '"0"';
  const revision = Number(revisionHeader.replaceAll('"', ""));
  const saved = await page.request.put(path, {
    headers: { "If-Match": revisionHeader },
    data: encodeStoryWorldDocument(
      { nodes: [map, child, emptyPlace], edges: [], timeline: [], presence: [] },
      revision,
    ),
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  return { mapImageId };
}

async function persistedNodes(page: Page, worldId: string): Promise<FigureNode[]> {
  const response = await page.request.get(`/api/state?world=${worldId}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const document = (await response.json()) as { payload?: { nodes?: FigureNode[] } };
  return document.payload?.nodes ?? [];
}

async function openPlaces(page: Page, worldId: string) {
  await page.goto(`/?world=${worldId}`);
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();
  await page.getByRole("button", { name: "Orte", exact: true }).click();
  await expect(page.locator(".places-workspace")).toBeVisible();
}

async function requestDeletion(page: Page, placeId: string) {
  await page
    .locator(`.react-flow__node[data-id="${placeId}"] .story-node`)
    .click({ position: { x: 12, y: 12 } });
  if ((page.viewportSize()?.width ?? 0) <= 820) {
    const inspector = page.getByRole("dialog", { name: "Orte-Inspector" });
    await inspector.getByRole("button", { name: "Ort löschen", exact: true }).click();
    await expect(inspector).toHaveCount(0);
    return;
  }
  await page.getByRole("button", { name: "Ortsaktionen" }).click();
  await page.getByRole("menuitem", { name: "Ort löschen" }).click();
}

test("an occupied map cannot be deleted and remains intact after reload", async ({
  page,
}, testInfo) => {
  await page.addInitScript(
    (theme) => {
      localStorage.setItem("quiltor-theme", theme);
      localStorage.setItem("quiltor-interface-language", "de");
    },
    testInfo.project.name === "regular" ? "dark" : "light",
  );
  const world = await createTestWorld(page, `Karten-Löschschutz ${testInfo.project.name}`);
  const seeded = await seedPlaces(page, world.id);
  await openPlaces(page, world.id);

  await requestDeletion(page, occupiedMap.id);

  await expect(page.getByRole("alertdialog", { name: "Ort löschen" })).toHaveCount(0);
  const warning = page.locator('.story-world-toast[role="status"]');
  await expect(warning).toContainText("„Weltkarte“ kann noch nicht gelöscht werden.");
  await expect(warning).toContainText("Darin befindet sich 1 weiterer Ort.");
  if (testInfo.project.name === "regular" || testInfo.project.name === "compact") {
    const theme = testInfo.project.name === "regular" ? "dark" : "light";
    await page.screenshot({
      path: join(
        process.env.TEMP ?? testInfo.outputDir,
        `quiltor-place-delete-blocked-${testInfo.project.name}-${theme}.png`,
      ),
      animations: "disabled",
    });
  }

  await page.reload();
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();
  const nodes = await persistedNodes(page, world.id);
  expect(nodes.map((node) => node.id)).toEqual(
    expect.arrayContaining([occupiedMap.id, mapChild.id, emptyPlace.id]),
  );
  expect(nodes.find((node) => node.id === mapChild.id)).toMatchObject({
    parentPlaceId: occupiedMap.id,
    mapU: 0.35,
    mapV: 0.62,
  });
  expect(nodes.find((node) => node.id === occupiedMap.id)).toMatchObject({
    mapImageId: seeded.mapImageId,
    mapWidth: 640,
    mapHeight: 400,
  });
});

test("an empty place is deleted, saved and stays deleted after reload", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "regular",
    "Persistence is covered in the wide and compact interaction paths.",
  );
  await page.addInitScript(() => {
    localStorage.setItem("quiltor-theme", "light");
    localStorage.setItem("quiltor-interface-language", "de");
  });
  const world = await createTestWorld(page, "Leeren Ort löschen");
  await seedPlaces(page, world.id);
  await openPlaces(page, world.id);

  await requestDeletion(page, emptyPlace.id);
  const confirmation = page.getByRole("alertdialog", { name: "Ort löschen" });
  await expect(confirmation).toBeVisible();
  if (testInfo.project.name === "compact") {
    await page.screenshot({
      path: join(
        process.env.TEMP ?? testInfo.outputDir,
        "quiltor-place-delete-confirm-compact-light.png",
      ),
      animations: "disabled",
    });
  }
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/state" &&
      new URL(response.url()).searchParams.get("world") === world.id &&
      response.request().method() === "PUT" &&
      response.ok(),
  );
  await confirmation.getByRole("button", { name: "Ort löschen", exact: true }).click();
  await saved;
  await expect(page.locator('.save-status-component[role="status"]')).toContainText("Gespeichert");

  expect((await persistedNodes(page, world.id)).map((node) => node.id)).toEqual([
    occupiedMap.id,
    mapChild.id,
  ]);
  await page.reload();
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();
  await page.getByRole("button", { name: "Orte", exact: true }).click();
  await expect(page.locator(`.react-flow__node[data-id="${emptyPlace.id}"]`)).toHaveCount(0);
  const nodes = await persistedNodes(page, world.id);
  expect(nodes.map((node) => node.id)).toEqual([occupiedMap.id, mapChild.id]);
  expect(nodes.find((node) => node.id === mapChild.id)).toMatchObject({
    parentPlaceId: occupiedMap.id,
  });
});
