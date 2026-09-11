import { expect, type Page } from "@playwright/test";
import type { FigureState } from "../../../packages/client/src/modules/story-world/model";
import { decodeStoryWorldV1 } from "../../../packages/client/src/platform/contracts/v1/storyWorld";
import {
  fulfillDocumentSave,
  fulfillStoryWorld,
  mockRequiredWorldDocuments,
} from "./application-api";

const mapImage = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="680" viewBox="0 0 1000 680">
  <rect width="1000" height="680" fill="#d4e1e3"/>
  <path d="M0 0H750L715 65 815 130 725 180 810 240 695 295 775 350 690 415 740 490 650 550 660 680H0Z" fill="#e8e5d6" stroke="#829b98" stroke-width="3"/>
  <path d="M65 100Q225 180 380 95T660 130M90 235Q250 160 425 260T690 225M35 440Q215 330 400 440T620 400M115 565Q300 495 500 590" fill="none" stroke="#c4cdb5" stroke-width="28" opacity=".65"/>
  <path d="M225 0Q160 120 315 220T380 415Q420 495 695 500" fill="none" stroke="#a9c7cf" stroke-width="13"/>
  <path d="M115 375Q300 330 550 220M330 440Q430 520 575 550M310 210Q465 300 550 220" fill="none" stroke="#b8a88d" stroke-width="3" stroke-dasharray="9 8"/>
  <g fill="#97aa99" opacity=".6"><path d="M95 90l20-34 20 34zM130 102l24-40 24 40zM172 82l20-34 20 34zM470 87l22-38 22 38zM510 105l28-48 28 48zM560 84l20-34 20 34z"/></g>
</svg>`;

export function expandedMapState({
  expanded = true,
  scale = true,
  secondMap = false,
}: {
  expanded?: boolean;
  scale?: boolean;
  secondMap?: boolean;
} = {}): FigureState {
  return {
    nodes: [
      {
        id: "weltkarte",
        type: "ort",
        name: "Weltkarte",
        label: "Karte",
        sub: "Die Küsten des Nordens.",
        x: 0,
        y: 0,
        mapImageId: "nordkueste",
        mapExpanded: expanded,
        mapWidth: secondMap ? 600 : 1000,
        mapHeight: secondMap ? 500 : 680,
        pinned: true,
        ...(scale ? { mapScale: { unitsPer100px: 25, unitLabel: "km" } } : {}),
      },
      ...[
        { id: "graufurth", name: "Graufurth", mapU: 0.3, mapV: 0.4 },
        { id: "nordhafen", name: "Nordhafen", mapU: 0.7, mapV: 0.4 },
        { id: "tannenhain", name: "Tannenhain", mapU: 0.48, mapV: 0.7 },
      ].map((place) => ({
        ...place,
        type: "ort" as const,
        x: 0,
        y: 0,
        label: "Ort",
        sub: "An der nördlichen Küste.",
        parentPlaceId: "weltkarte",
      })),
      ...(secondMap
        ? [
            {
              id: "inselkarte",
              type: "ort" as const,
              name: "Inselkarte",
              label: "Karte",
              sub: "Die vorgelagerten Inseln.",
              x: 700,
              y: 0,
              mapImageId: "inseln",
              mapExpanded: true,
              mapWidth: 600,
              mapHeight: 500,
              pinned: true,
            },
            {
              id: "inselhafen",
              type: "ort" as const,
              name: "Inselhafen",
              label: "Ort",
              sub: "Auf der vorgelagerten Insel.",
              x: 0,
              y: 0,
              parentPlaceId: "inselkarte",
              mapU: 0.5,
              mapV: 0.5,
            },
          ]
        : []),
    ],
    edges: [],
    timeline: [],
    presence: [],
  };
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
    manuscript: {
      chapters: [{ id: "ankunft", title: "Ankunft", body: "Mara erreicht den Hafen.", note: "" }],
      words: [],
      activeSymbols: [],
    },
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

export async function selectMapChild(page: Page) {
  const child = page.locator('.react-flow__node[data-id="graufurth"]');
  await child.click();
  await expect(page.locator(".places-inspector-header strong")).toHaveText("Graufurth");
  await closePlaceSheet(page);
  await waitForMapViewport(page);
}
