import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8125";
const output = resolve("docs/screenshots");
await mkdir(output, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});

const created = await page.request.post(`${baseUrl}/api/worlds/create`, {
  data: { title: "Der gläserne Atlas", gitUrl: "" },
});
const { world } = await created.json();
await page.request.post(`${baseUrl}/api/worlds/open`, { data: { id: world.id } });

const manuscript = {
  chapters: [
    {
      id: "c-arrival",
      title: "Die Ankunft",
      body: "Der Morgen lag still über dem Hafen. Zwischen den Masten schimmerte das Archiv wie eine Erinnerung aus Glas.\n\nMara blieb am Ende des Stegs stehen. Heute würde sie erfahren, weshalb die Karten seit drei Nächten ihre Linien veränderten.",
      note: "Die Unruhe der Stadt nur andeuten. Das Archiv als stillen Gegenpol etablieren.",
    },
    {
      id: "c-archive",
      title: "Das Archiv",
      body: "Im Lesesaal wartete bereits der Hüter der Karten.",
      note: "Erstes Zusammentreffen mit der Kartographengilde.",
    },
    {
      id: "c-storm",
      title: "Vor dem Sturm",
      body: "",
      note: "Konflikt zwischen Gilde und Hafenrat zuspitzen.",
    },
    { id: "c-crossing", title: "Die Überfahrt", body: "", note: "" },
  ],
  words: [
    { w: "Lichtsaum", d: "Schimmernde Grenze auf alten Karten" },
    { w: "Gezeitenarchiv", d: "Zentrales Archiv der Stadt" },
  ],
  zeichenAktiv: ["…", "—", "»", "«"],
};
const figures = {
  nodes: [
    {
      id: "mara",
      x: 80,
      y: 90,
      type: "person",
      name: "Mara Venn",
      label: "Kartographin",
      sub: "Liest Veränderungen in lebenden Karten.",
      accent: "gold",
      important: true,
      profile: { rolle: "Protagonistin", herkunft: "Nordhafen", extra: [] },
    },
    {
      id: "iven",
      x: 430,
      y: 90,
      type: "person",
      name: "Iven Rook",
      label: "Archivar",
      sub: "Bewahrt die verbotenen Küstenkarten.",
      accent: "rose",
      profile: { rolle: "Mentor", extra: [] },
    },
    {
      id: "gilde",
      x: 780,
      y: 90,
      type: "organisation",
      name: "Kartographengilde",
      label: "Organisation",
      sub: "Kontrolliert die offiziellen Seewege.",
      accent: "ink",
      profile: { extra: [] },
    },
    {
      id: "archiv",
      x: 250,
      y: 330,
      type: "ort",
      name: "Gezeitenarchiv",
      label: "Ort",
      sub: "Ein gläserner Bau direkt über dem Wasser.",
      accent: "moss",
      profile: { extra: [] },
      mapX: 220,
      mapY: 260,
    },
    {
      id: "leuchtturm",
      x: 1120,
      y: 330,
      type: "ort",
      name: "Leuchtturmklippe",
      label: "Ort",
      sub: "Letzter fester Punkt vor dem Kartennebel.",
      accent: "ink",
      profile: { extra: [] },
      mapX: 860,
      mapY: 520,
    },
    {
      id: "atlas",
      x: 620,
      y: 330,
      type: "objekt",
      name: "Der gläserne Atlas",
      label: "Artefakt",
      sub: "Seine Linien reagieren auf kommende Entscheidungen.",
      accent: "gold",
      important: true,
      profile: { extra: [] },
    },
    {
      id: "lumen",
      x: 970,
      y: 330,
      type: "tier",
      name: "Lumen",
      label: "Küstenvogel",
      sub: "Findet Wege durch den Kartennebel.",
      accent: "moss",
      profile: { extra: [] },
    },
  ],
  edges: [
    {
      id: "e1",
      from: "mara",
      to: "iven",
      label: "misstraut",
      gerichtet: true,
      style: "solid",
      versions: [
        { momentId: "t2", label: "arbeitet mit", active: true },
        { momentId: "t3", label: "vertraut", active: true },
      ],
    },
    { id: "e2", from: "mara", to: "atlas", label: "trägt", gerichtet: true, style: "gold" },
    { id: "e3", from: "iven", to: "archiv", label: "hütet", gerichtet: true, style: "solid" },
    {
      id: "e4",
      from: "gilde",
      to: "iven",
      label: "beauftragt",
      gerichtet: true,
      style: "dashed",
      versions: [{ momentId: "t3", label: "verfolgt", active: true, style: "blood" }],
    },
    { id: "e5", from: "mara", to: "lumen", label: "verbunden", gerichtet: false, style: "solid" },
    {
      id: "e6",
      from: "atlas",
      to: "gilde",
      label: "beansprucht",
      gerichtet: true,
      style: "dashed",
    },
  ],
  timeline: [
    {
      id: "t1",
      title: "Ankunft im Nordhafen",
      date: "1847-09-03",
      note: "Mara erreicht die Stadt und sucht das Archiv.",
    },
    {
      id: "t2",
      title: "Öffnung des Atlas",
      date: "1847-09-06",
      note: "Die erste verborgene Route erscheint.",
    },
    {
      id: "t3",
      title: "Bruch mit der Gilde",
      date: "1847-09-11",
      note: "Die Gilde erklärt Iven und Mara zu Verrätern.",
    },
    {
      id: "t4",
      title: "Die Überfahrt",
      date: "1847-09-14",
      note: "Aufbruch durch den Kartennebel.",
    },
  ],
};

await page.request.post(`${baseUrl}/api/manuscript`, {
  data: manuscript,
  headers: { "If-Match": '"0"' },
});
await page.request.post(`${baseUrl}/api/state`, { data: figures, headers: { "If-Match": '"0"' } });

await page.goto(`${baseUrl}/?world=${world.id}`);
await page.getByLabel("Kapiteltext").waitFor();
await page.screenshot({ path: `${output}/manuscript.png` });

await page.getByRole("button", { name: "Figuren", exact: true }).click();
await page.getByLabel("Figuren und Beziehungen").waitFor();
const viewMenuButton = page.getByRole("button", { name: "Ansicht", exact: true });
await viewMenuButton.click();
await page.getByRole("menuitem", { name: "Zeit ausblenden" }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${output}/world-graph.png` });

await viewMenuButton.click();
await page.getByRole("menuitem", { name: "Zeit einblenden" }).click();
await page.getByRole("button", { name: "Öffnung des Atlas" }).click();
await page.screenshot({ path: `${output}/timeline-playback.png` });

await page.getByRole("button", { name: "Timeline", exact: true }).click();
await page.locator(".story-moment").filter({ hasText: "Bruch mit der Gilde" }).click();
await page.screenshot({ path: `${output}/timeline-manager.png` });

await page.getByRole("button", { name: "Orte", exact: true }).click();
await page.getByLabel("Orte verwalten").waitFor();
await page.getByRole("button", { name: "Distanz messen" }).click();
await page.locator(".story-node").filter({ hasText: "Gezeitenarchiv" }).click();
await page.locator(".story-node").filter({ hasText: "Leuchtturmklippe" }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${output}/places.png` });

await browser.close();
