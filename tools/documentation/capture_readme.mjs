import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { figures, manuscript, storyboards } from "./readme_fixture.mjs";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8125";
const output = resolve("docs/screenshots");
await mkdir(output, { recursive: true });

async function checkedJson(response, operation) {
  if (!response.ok()) {
    throw new Error(`${operation}: HTTP ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

const browser = await chromium.launch({ args: ["--lang=de-DE"] });
let context;
let worldId;
const failures = [];
const captures = [];
try {
  context = await browser.newContext({
    baseURL: baseUrl,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on("pageerror", (error) => failures.push(`Browser: ${error.message}`));
  page.on("response", (response) => {
    if (response.url().includes("/api/") && response.status() >= 400) {
      failures.push(`API: HTTP ${response.status()} ${response.url()}`);
    }
  });
  await page.addInitScript(() => {
    localStorage.setItem("quiltor-theme", "light");
    localStorage.setItem("quiltor-interface-language", "de");
  });

  const created = await checkedJson(
    await context.request.post("/api/worlds/create", {
      data: { title: "Der gläserne Atlas", backupUrl: "" },
      timeout: 10_000,
    }),
    "Create screenshot world",
  );
  if (typeof created.world?.id !== "string" || !/^[0-9a-f]{32}$/.test(created.world.id)) {
    throw new Error("World creation returned an invalid world ID.");
  }
  worldId = created.world.id;
  console.log(`Created screenshot world ${worldId}.`);

  for (const [endpoint, contract, payload] of [
    ["state", "quiltor.story-world", figures],
    ["manuscript", "quiltor.manuscript", manuscript],
    ["storyboards", "quiltor.storyboards", storyboards],
  ]) {
    const url = `/api/${endpoint}?world=${encodeURIComponent(worldId)}`;
    const initialResponse = await context.request.get(url, { timeout: 10_000 });
    const initial = await checkedJson(initialResponse, `Read ${endpoint}`);
    const etag = initialResponse.headers().etag;
    if (initial.contract !== contract || initial.version !== 1 || !/^"\d+"$/.test(etag || "")) {
      throw new Error(`Read ${endpoint}: invalid document envelope or ETag.`);
    }
    const revision = Number(etag.slice(1, -1));
    if (!Number.isSafeInteger(revision) || initial.revision !== revision) {
      throw new Error(`Read ${endpoint}: inconsistent document revision.`);
    }
    const saved = await checkedJson(
      await context.request.put(url, {
        data: { contract, version: 1, revision, payload },
        headers: { "If-Match": etag },
        timeout: 10_000,
      }),
      `Seed ${endpoint}`,
    );
    if (saved.ok !== true || !Number.isSafeInteger(saved.revision) || saved.revision <= revision) {
      throw new Error(`Seed ${endpoint}: invalid save acknowledgement.`);
    }
  }

  async function capture(name) {
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(1435, 895);
    await page.waitForTimeout(600);
    if (failures.length) throw new Error(failures.join("\n"));
    await page.screenshot({
      path: resolve(output, `${name}.png`),
      animations: "disabled",
      caret: "hide",
    });
    captures.push(name);
    console.log(`Captured ${name}.png`);
  }

  await page.goto(`/?world=${encodeURIComponent(worldId)}`);
  await page.getByRole("toolbar", { name: "Manuskript", exact: true }).waitFor();
  await expect(page.getByLabel("Kapiteltext", { exact: true })).toContainText("Mara");
  await capture("manuscript");

  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  await page.getByLabel("Figuren und Beziehungen", { exact: true }).waitFor();
  await expect(page.locator(".story-node")).toHaveCount(figures.nodes.length);
  const viewMenu = page.getByRole("button", { name: "Ansicht", exact: true });
  await viewMenu.click();
  const hideTime = page.getByRole("menuitem", { name: "Zeit ausblenden", exact: true });
  if (await hideTime.isVisible()) await hideTime.click();
  else await page.keyboard.press("Escape");
  await page.locator(".react-flow__controls-fitview").click();
  await capture("world-graph");

  await viewMenu.click();
  await page.getByRole("menuitem", { name: "Zeit einblenden", exact: true }).click();
  await page.getByRole("button", { name: "Öffnung des Atlas", exact: true }).click();
  await page.mouse.move(1030, 650);
  await page.mouse.down();
  await page.mouse.move(1030, 590, { steps: 12 });
  await page.mouse.up();
  await capture("timeline-playback");

  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await page.locator(".story-moment").filter({ hasText: "Bruch mit der Gilde" }).click();
  await capture("timeline-manager");

  await page.getByRole("button", { name: "Orte", exact: true }).click();
  await page.getByLabel("Orte verwalten", { exact: true }).waitFor();
  await page.locator(".react-flow__controls-fitview").click();
  await page.getByRole("button", { name: "Distanz messen", exact: true }).click();
  await page.locator('.react-flow__node[data-id="archiv"] .story-node').click();
  await page.locator('.react-flow__node[data-id="leuchtturm"] .story-node').click();
  await page.getByRole("complementary", { name: "Orte-Inspector" }).waitFor();
  await page.locator(".react-flow__controls-fitview").click();
  await capture("places");

  await page.getByRole("button", { name: "Storyboard", exact: true }).click();
  await page.getByLabel("Storyboard-Fläche", { exact: true }).waitFor();
  await expect(page.locator("[data-storyboard-node-kind]")).toHaveCount(
    storyboards.nodes.filter((node) => node.boardId === "main-storyboard").length,
  );
  await page.locator(".react-flow__controls-fitview").click();
  await page.getByRole("button", { name: "Übersichtskarte ausblenden", exact: true }).click();
  await capture("storyboard");

  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  await page.locator('.react-flow__node[data-id="mara"] .story-node').click();
  const inspector = page.getByRole("complementary", { name: "Figuren-Inspector" });
  await inspector.getByRole("tab", { name: "Steckbrief", exact: true }).click();
  await inspector.getByRole("button", { name: "Notiz im Fokus öffnen", exact: true }).click();
  await page.getByRole("textbox", { name: "Notiz für Mara Venn", exact: true }).waitFor();
  await capture("shared-notes");
  if (captures.length !== 7 || failures.length)
    throw new Error(`Incomplete capture: ${failures.join("\n")}`);
  console.log(`Captured all ${captures.length} README screenshots.`);
} finally {
  try {
    if (context && worldId) {
      for (const page of context.pages()) await page.close();
      const deleted = await checkedJson(
        await context.request.post("/api/worlds/delete", {
          data: { id: worldId },
          timeout: 10_000,
        }),
        "Delete screenshot world",
      );
      if (deleted.ok !== true) throw new Error("Screenshot world deletion was not acknowledged.");
      console.log(`Deleted screenshot world ${worldId}.`);
    }
  } finally {
    await browser.close();
  }
}
