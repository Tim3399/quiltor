import { expect, test } from "@playwright/test";
import { mockRequiredWorldDocuments } from "./support/application-api";

/*
 * A measuring point inside the running application, without a throwaway file every time.
 *
 * Started through `npm run probe -- "<expression>"`; the expression runs in the page and its
 * result comes back as JSON. Without QUILTOR_PROBE this file does nothing, so it stays out
 * of the way during a normal run.
 *
 * Why a real browser rather than the embedded pane: a hidden browser pane does not paint, no
 * ResizeObserver fires there, and React Flow then measures nothing at all. Numbers taken
 * from there look like findings and are none.
 */

const EXPRESSION = process.env.QUILTOR_PROBE ?? "";
const WORKSPACE = process.env.QUILTOR_PROBE_WORKSPACE ?? "";
const WAIT = Number(process.env.QUILTOR_PROBE_WAIT ?? 2000);

const manuscript = {
  chapters: [
    {
      id: "c1",
      title: "Die Ankunft",
      body: "Der Morgen lag still über dem Hafen.",
      note: "Die Unruhe nur andeuten.",
    },
  ],
  words: [{ w: "Gezeitenarchiv", d: "" }],
  activeSymbols: ["„", "“", "…"],
};

const figures = {
  nodes: [
    {
      id: "mara",
      x: 120,
      y: 120,
      type: "person" as const,
      name: "Mara Venn",
      label: "Kartographin",
      sub: "Liest lebende Karten.",
    },
    {
      id: "hafen",
      x: 460,
      y: 120,
      type: "ort" as const,
      name: "Hafen",
      label: "Ort",
      sub: "Ein Ort ohne Karte.",
    },
    {
      id: "hafenkarte",
      x: 120,
      y: 360,
      type: "ort" as const,
      name: "Nordhafen",
      label: "Ort",
      sub: "Eine begehbare Karte.",
      mapImageId: "karte-1",
      mapExpanded: true,
      mapWidth: 960,
      mapHeight: 720,
    },
    {
      id: "steg",
      x: 0,
      y: 0,
      type: "ort" as const,
      name: "Steg",
      label: "Ort",
      sub: "Auf der Karte.",
      parentPlaceId: "hafenkarte",
      mapU: 0.3,
      mapV: 0.4,
    },
  ],
  edges: [{ id: "e1", from: "mara", to: "hafen", label: "kennt", directed: true }],
  timeline: [{ id: "t1", title: "Ankunft", date: "1847-09-03", note: "Mara erreicht den Hafen." }],
  presence: [],
};

const storyboards = {
  boards: [{ id: "main-storyboard", title: "Erster Entwurf" }],
  nodes: [
    {
      id: "gruppe",
      boardId: "main-storyboard",
      kind: "group" as const,
      x: 0,
      y: 0,
      width: 620,
      height: 420,
      label: "Erster Akt",
    },
    {
      id: "karte-a",
      boardId: "main-storyboard",
      kind: "note" as const,
      x: 60,
      y: 80,
      text: "Ankunft im Hafen.",
    },
    {
      id: "karte-b",
      boardId: "main-storyboard",
      kind: "note" as const,
      x: 380,
      y: 80,
      text: "Aufbruch ins Archiv.",
    },
  ],
  edges: [
    {
      id: "kante-1",
      boardId: "main-storyboard",
      sourceNodeId: "karte-a",
      targetNodeId: "karte-b",
      directed: true,
    },
  ],
};

test("Browser probe", async ({ page }) => {
  test.skip(!EXPRESSION, "Only with QUILTOR_PROBE; see npm run probe.");

  await page.addInitScript(() => {
    localStorage.setItem("quiltor-theme", "light");
    localStorage.setItem("quiltor-interface-language", "de");
  });
  await page.route("**/api/version", (route) =>
    route.fulfill({ json: { ok: true, version: "sonde" } }),
  );
  await page.route("**/api/whoami", (route) => route.fulfill({ json: { ok: false } }));
  const world = { id: "sonde", title: "Sonde", backupUrl: "", updated: "2026-09-06T12:00:00Z" };
  await page.route("**/api/worlds", (route) =>
    route.fulfill({ json: { ok: true, worlds: [world] } }),
  );
  await page.route("**/api/worlds/open", (route) => route.fulfill({ json: { ok: true, world } }));
  await mockRequiredWorldDocuments(page, { manuscript, storyWorld: figures, storyboards });
  await page.route("**/api/assistant/status*", (route) =>
    route.fulfill({
      json: { ok: true, available: false, mode: "local", reason: "-", chunks: 0 },
    }),
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Sonde – Welt öffnen" }).click();
  await expect(page.getByRole("contentinfo", { name: "Arbeitsstand" })).toBeVisible();

  if (WORKSPACE) {
    await page.getByRole("button", { name: WORKSPACE, exact: true }).click();
  }
  // The canvases fit their viewport on arrival; only after that do the numbers settle.
  await page.waitForTimeout(WAIT);

  const result = await page.evaluate((source) => new Function(`return (${source});`)(), EXPRESSION);
  console.log(`PROBE ${JSON.stringify(result ?? null)}`);
});
