import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium, expect } from "@playwright/test";
import {
  buildManifest,
  CAPTURE_VIEWPORT,
  MANIFEST_NAME,
  README_VIEWS,
  readVersion,
  SCREENSHOT_LANGUAGES,
} from "./readme_screenshots.mjs";
import { settleUntilStable } from "./settle.mjs";

/*
 *   node tools/documentation/capture_readme.mjs --lang de|en
 *
 * Takes the README pictures of one language into docs/screenshots/<lang>/ (or
 * $QUILTOR_SCREENSHOT_DIR/<lang>/) from the shipped example world in that language
 * (src/quiltor/resources/example_world/<lang>.json, written by npm run world:update), with the
 * interface in that language.
 */

/**
 * Interface names the capture clicks and waits for, per language. They are the values of the
 * locale keys named on the right; a renamed key fails the capture, never a wrong picture.
 */
const INTERFACE = {
  de: {
    browserLocale: "de-DE",
    manuscriptToolbar: "Manuskript", // manuscript.manuscript
    chapterText: "Kapiteltext", // manuscript.chapterText
    figures: "Figuren", // shell.figures
    figuresCanvas: "Figuren und Beziehungen", // figures.figuresAndRelationsLabel
    viewMenu: "Ansicht", // figures.figureViewMenu
    hideTime: "Zeit ausblenden", // figures.hideTimeline
    showTime: "Zeit einblenden", // figures.showTimeline
    timeline: "Timeline", // shared.timeline
    places: "Orte", // shell.places
    placesCanvas: "Orte verwalten", // places.placesLabel
    measure: "Distanz messen", // places.measureDistance
    placesInspector: "Orte-Inspector", // places.placesInspectorLabel
    storyboard: "Storyboard", // storyboard.storyboard
    storyboardCanvas: "Storyboard-Fläche", // storyboard.storyboardCanvasLabel
    hideMinimap: "Übersichtskarte ausblenden", // tools.hideMinimap
    figureInspector: "Figuren-Inspector", // figures.figureInspectorLabel
    profile: "Steckbrief", // figures.profile
    openNoteFocus: "Notiz im Fokus öffnen", // shared.noteFocusOpen
    noteFor: (name) => `Notiz für ${name}`, // shared.noteFocusEditor
  },
  en: {
    browserLocale: "en-US",
    manuscriptToolbar: "Manuscript",
    chapterText: "Chapter text",
    figures: "Characters",
    figuresCanvas: "Characters and relationships",
    viewMenu: "View",
    hideTime: "Hide timeline",
    showTime: "Show timeline",
    timeline: "Timeline",
    places: "Places",
    placesCanvas: "Manage places",
    measure: "Measure distance",
    placesInspector: "Place inspector",
    storyboard: "Storyboard",
    storyboardCanvas: "Storyboard canvas",
    hideMinimap: "Hide overview map",
    figureInspector: "Character inspector",
    profile: "Profile",
    openNoteFocus: "Open note in focus mode",
    noteFor: (name) => `Note for ${name}`,
  },
};

const { values } = parseArgs({ options: { lang: { type: "string" } } });
const lang = values.lang;
if (!SCREENSHOT_LANGUAGES.includes(lang)) {
  throw new Error(`Pass --lang with one of: ${SCREENSHOT_LANGUAGES.join(", ")}.`);
}
const ui = INTERFACE[lang];
const SHIP_DIRECTORY = "src/quiltor/resources/example_world";
const shipped = JSON.parse(readFileSync(join(SHIP_DIRECTORY, `${lang}.json`), "utf8"));
const { manuscript, storyWorld: figures, storyboards } = shipped;
const mapBytes = readFileSync(join(SHIP_DIRECTORY, shipped.mapImage.file));
if (createHash("sha256").update(mapBytes).digest("hex") !== shipped.mapImage.id) {
  throw new Error(`The shipped harbour map is not the one ${lang}.json names.`);
}
const nameOf = (id) => figures.nodes.find((node) => node.id === id).name;
const momentTitle = (id) => figures.timeline.find((moment) => moment.id === id).title;

const baseUrl = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8125";
const output = resolve(process.env.QUILTOR_SCREENSHOT_DIR || "docs/screenshots", lang);
await mkdir(output, { recursive: true });

async function checkedJson(response, operation) {
  if (!response.ok()) {
    throw new Error(`${operation}: HTTP ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

const browser = await chromium.launch({ args: [`--lang=${ui.browserLocale}`] });
let context;
let worldId;
const failures = [];
const captures = [];
try {
  context = await browser.newContext({
    baseURL: baseUrl,
    viewport: CAPTURE_VIEWPORT,
    deviceScaleFactor: 1,
    locale: ui.browserLocale,
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
  await page.addInitScript((language) => {
    localStorage.setItem("quiltor-theme", "light");
    localStorage.setItem("quiltor-interface-language", language);
  }, lang);

  const created = await checkedJson(
    await context.request.post("/api/worlds/create", {
      data: { title: shipped.title, backupUrl: "" },
      timeout: 10_000,
    }),
    "Create screenshot world",
  );
  if (typeof created.world?.id !== "string" || !/^[0-9a-f]{32}$/.test(created.world.id)) {
    throw new Error("World creation returned an invalid world ID.");
  }
  worldId = created.world.id;
  console.log(`Created the ${lang} screenshot world ${worldId}.`);

  // The city level is drawn on the harbour map; the world refers to it by its SHA-256.
  const map = await checkedJson(
    await context.request.post(`/api/place-maps?world=${encodeURIComponent(worldId)}`, {
      data: { data: mapBytes.toString("base64") },
      timeout: 10_000,
    }),
    "Upload the harbour map",
  );
  if (map.id !== shipped.mapImage.id)
    throw new Error("The harbour map was stored under another id.");

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

  // Fit-view, the scrub drag and the panels settle over several frames; a frame taken
  // mid-way differs by a sub-pixel, which is what made two runs disagree.
  async function settle(view) {
    await page.evaluate(async () => {
      await document.fonts.ready;
      const finite = document
        .getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime));
      await Promise.all(finite.map((animation) => animation.finished.catch(() => {})));
    });
    await settleUntilStable(
      () =>
        page.evaluate(
          () =>
            [...document.querySelectorAll(".react-flow__viewport")]
              .map((element) => getComputedStyle(element).transform)
              .join("|") +
            [...document.querySelectorAll(".react-flow__minimap-mask")]
              .map((element) => element.getAttribute("d"))
              .join("|"),
        ),
      { wait: (ms) => page.waitForTimeout(ms), label: `The ${view} view` },
    );
  }

  async function capture(name) {
    if (!README_VIEWS.includes(name)) throw new Error(`"${name}" is not in README_VIEWS.`);
    await page.mouse.move(CAPTURE_VIEWPORT.width - 5, CAPTURE_VIEWPORT.height - 5);
    await settle(name);
    if (failures.length) throw new Error(failures.join("\n"));
    await page.screenshot({
      path: resolve(output, `${name}.png`),
      animations: "disabled",
      caret: "hide",
    });
    captures.push(name);
    console.log(`Captured ${lang}/${name}.png`);
  }

  await page.goto(`/?world=${encodeURIComponent(worldId)}`);
  await page.getByRole("toolbar", { name: ui.manuscriptToolbar, exact: true }).waitFor();
  await expect(page.getByLabel(ui.chapterText, { exact: true })).toContainText("Mara");
  await capture("manuscript");

  await page.getByRole("button", { name: ui.figures, exact: true }).click();
  await page.getByLabel(ui.figuresCanvas, { exact: true }).waitFor();
  const viewMenu = page.getByRole("button", { name: ui.viewMenu, exact: true });
  await viewMenu.click();
  const hideTime = page.getByRole("menuitem", { name: ui.hideTime, exact: true });
  if (await hideTime.isVisible()) await hideTime.click();
  else await page.keyboard.press("Escape");
  // A place drawn on its own map is a sheet, not a figure: the board leaves it out
  // (belongsOnFigureBoard in figureCanvasModel.ts).
  await expect(page.locator(".story-node")).toHaveCount(
    figures.nodes.filter((node) => !node.mapImageId).length,
  );
  await page.locator(".react-flow__controls-fitview").click();
  await capture("world-graph");

  await viewMenu.click();
  await page.getByRole("menuitem", { name: ui.showTime, exact: true }).click();
  await page.getByRole("button", { name: momentTitle("t2"), exact: true }).click();
  // The drag pans the empty board upward; it must never grab a card and move it.
  const onCard = await page.evaluate(
    ([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest(".react-flow__node")),
    [1030, 650],
  );
  if (onCard) throw new Error("The pan gesture at (1030, 650) would drag a card.");
  await page.mouse.move(1030, 650);
  await page.mouse.down();
  await page.mouse.move(1030, 590, { steps: 12 });
  await page.mouse.up();
  await capture("timeline-playback");

  await page.getByRole("button", { name: ui.timeline, exact: true }).click();
  await page
    .locator(".story-moment")
    .filter({ hasText: momentTitle("t6") })
    .click();
  await capture("timeline-manager");

  await page.getByRole("button", { name: ui.places, exact: true }).click();
  await page.getByLabel(ui.placesCanvas, { exact: true }).waitFor();
  await page.locator(".react-flow__controls-fitview").click();
  await page.getByRole("button", { name: ui.measure, exact: true }).click();
  await page.locator('.react-flow__node[data-id="nordhafen"] .story-node').click();
  await page.locator('.react-flow__node[data-id="leuchtturm"] .story-node').click();
  await page.getByRole("complementary", { name: ui.placesInspector }).waitFor();
  await page.locator(".react-flow__controls-fitview").click();
  await capture("places");

  await page.getByRole("button", { name: ui.storyboard, exact: true }).click();
  await page.getByLabel(ui.storyboardCanvas, { exact: true }).waitFor();
  await expect(page.locator("[data-storyboard-node-kind]")).toHaveCount(
    storyboards.nodes.filter((node) => node.boardId === "main-storyboard").length,
  );
  await page.locator(".react-flow__controls-fitview").click();
  await page.getByRole("button", { name: ui.hideMinimap, exact: true }).click();
  await capture("storyboard");

  await page.getByRole("button", { name: ui.figures, exact: true }).click();
  await page.locator('.react-flow__node[data-id="mara"] .story-node').click();
  const inspector = page.getByRole("complementary", { name: ui.figureInspector });
  await inspector.getByRole("tab", { name: ui.profile, exact: true }).click();
  await inspector.getByRole("button", { name: ui.openNoteFocus, exact: true }).click();
  await page.getByRole("textbox", { name: ui.noteFor(nameOf("mara")), exact: true }).waitFor();
  await capture("shared-notes");
  if (captures.join() !== README_VIEWS.join() || failures.length)
    throw new Error(`Incomplete capture: ${failures.join("\n")}`);
  console.log(`Captured all ${captures.length} ${lang} README screenshots.`);
  const version = process.env.QUILTOR_SCREENSHOT_VERSION || readVersion(resolve("."));
  const manifest = buildManifest({ root: resolve("."), directory: output, version });
  const manifestText = JSON.stringify(manifest, null, 2);
  await writeFile(resolve(output, MANIFEST_NAME), `${manifestText}\n`);
  console.log(`Wrote ${lang}/${MANIFEST_NAME} for version ${version}.`);
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
      // biome-ignore lint/correctness/noUnsafeFinally: a screenshot world left behind in the library must fail the run, even over an earlier capture error; the inner finally still closes the browser.
      if (deleted.ok !== true) throw new Error("Screenshot world deletion was not acknowledged.");
      console.log(`Deleted screenshot world ${worldId}.`);
    }
  } finally {
    await browser.close();
  }
}
