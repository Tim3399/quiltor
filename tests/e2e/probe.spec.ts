import { expect, test } from "@playwright/test";
import { mockRequiredWorldDocuments } from "./support/application-api";

/*
 * Eine Messstelle in der laufenden Anwendung, ohne jedes Mal eine Wegwerf-Datei.
 *
 * Gestartet wird sie über `npm run probe -- "<ausdruck>"`; der Ausdruck läuft in der Seite
 * und sein Ergebnis kommt als JSON zurück. Ohne QUILTOR_PROBE tut diese Datei nichts, damit
 * sie im normalen Lauf nicht im Weg steht.
 *
 * Warum überhaupt im Browser und nicht im eingebetteten Fenster: ein ausgeblendeter
 * Browser-Bereich zeichnet nicht, dort feuert kein ResizeObserver, und React Flow misst dann
 * gar nichts. Messungen von dort sehen aus wie Befunde und sind keine.
 */

const AUSDRUCK = process.env.QUILTOR_PROBE ?? "";
const WORKSPACE = process.env.QUILTOR_PROBE_WORKSPACE ?? "";
const WARTEN = Number(process.env.QUILTOR_PROBE_WAIT ?? 2000);

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
  zeichenAktiv: ["„", "“", "…"],
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
  edges: [{ id: "e1", from: "mara", to: "hafen", label: "kennt", gerichtet: true }],
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

test("Sonde", async ({ page }) => {
  test.skip(!AUSDRUCK, "Nur mit QUILTOR_PROBE; siehe npm run probe.");

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
  // Die Leinwaende passen ihren Ausschnitt beim Ankommen an; erst danach stehen die Zahlen.
  await page.waitForTimeout(WARTEN);

  const ergebnis = await page.evaluate(
    (quelltext) => new Function(`return (${quelltext});`)(),
    AUSDRUCK,
  );
  console.log(`SONDE ${JSON.stringify(ergebnis ?? null)}`);
});
