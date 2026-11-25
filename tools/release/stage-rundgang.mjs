// The walk of the version stage (T-364, checklist item 4): the core route plus one station
// per task, one picture each, against a hosted Quiltor behind a proxy and the large world.
//
//   node tools/release/stage-rundgang.mjs --base-url URL --world large.json --out DIR
//
// The script is the reproducible part of the walk. A station that cannot be reached is not
// skipped: it takes a picture of where it stopped, is named `<id>-FEHLER.png` and counts as
// failed in rundgang.json. Stations that need things this script cannot do (a real AI run, a
// new deploy, a phone photo from a real phone) are listed as `manual` with what to look at.
// A fresh agent repeats the walk on the final commit and judges the pictures; this file only
// makes sure the same stations are visited the same way.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const { values } = parseArgs({
  options: {
    "base-url": { type: "string" },
    world: { type: "string" },
    out: { type: "string" },
    fixtures: {
      type: "string",
      default: resolve(import.meta.dirname, "../../tests/fixtures/real-files"),
    },
  },
});
if (!values["base-url"] || !values.world || !values.out) {
  console.error("usage: stage-rundgang.mjs --base-url URL --world large.json --out DIR");
  process.exit(2);
}
const base = values["base-url"].replace(/\/$/, "");
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const world = JSON.parse(readFileSync(values.world, "utf8"));

const token = process.env.QUILTOR_STAGE_TOKEN ?? "";
const auth = token ? { Authorization: `Bearer ${token}` } : {};
const results = [];
let counter = 0;

// A compressing proxy weakens or extends the tag ("0" -> W/"0", "0-zstd"); the client accepts both.
function revisionOf(response) {
  const match = /^(?:W\/)?"(\d+)(?:-(?:gzip|zstd|br))?"$/.exec(
    response.headers.get("etag") ?? '"0"',
  );
  if (!match) throw new Error(`unexpected ETag ${response.headers.get("etag")}`);
  return Number(match[1]);
}

async function api(method, path, body, headers = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Origin: base, "Content-Type": "application/json", ...auth, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response;
}

async function seedWorld() {
  const created = await api("POST", "/api/worlds/create", {
    title: "Rundgang grosse Welt",
    backupUrl: "",
  });
  const id = (await created.json()).world.id;
  for (const [endpoint, contract, payload] of [
    ["state", "quiltor.story-world", world.figures],
    ["manuscript", "quiltor.manuscript", world.manuscript],
    ["storyboards", "quiltor.storyboards", world.storyboards],
  ]) {
    const path = `/api/${endpoint}?world=${id}`;
    const current = await api("GET", path);
    const revision = revisionOf(current);
    const saved = await api(
      "PUT",
      path,
      { contract, version: 1, revision, payload },
      { "If-Match": `"${revision}"` },
    );
    if (!saved.ok) throw new Error(`seed ${endpoint}: HTTP ${saved.status}`);
  }
  return id;
}

const browser = await chromium.launch({ headless: true, args: ["--lang=de-DE"] });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "de-DE",
  timezoneId: "Europe/Berlin",
  acceptDownloads: true,
  extraHTTPHeaders: auth,
});
const page = await context.newPage();
const consoleErrors = [];
page.on("pageerror", (error) => consoleErrors.push(String(error.message).slice(0, 200)));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text().slice(0, 200));
});

/** Runs one station; the picture is taken afterwards, or at the point of failure. */
async function station(id, task, title, action) {
  counter += 1;
  const stem = `${String(counter).padStart(2, "0")}-${id}`;
  const record = { id, task, title, status: "ok", picture: `${stem}.png` };
  const errorsBefore = consoleErrors.length;
  try {
    const note = await action();
    if (note) record.note = note;
  } catch (error) {
    record.status = "failed";
    record.error = String(error?.message ?? error)
      .split("\n")[0]
      .slice(0, 300);
    record.picture = `${stem}-FEHLER.png`;
  }
  record.consoleErrors = consoleErrors.slice(errorsBefore);
  await page.screenshot({ path: join(out, record.picture) }).catch(() => {});
  results.push(record);
  console.log(`${record.status.padEnd(7)} ${stem} ${record.error ?? record.note ?? ""}`);
}

function manual(id, task, title, lookFor) {
  results.push({ id, task, title, status: "manual", lookFor });
  console.log(`manual  ${id} ${title}`);
}

const toolbar = (name) => page.getByRole("toolbar", { name, exact: true });
async function overflow(name, entry) {
  await toolbar(name).getByRole("button", { name: "Weitere Aktionen", exact: true }).click();
  if (entry) await page.getByRole("menuitem", { name: entry, exact: true }).click();
}

let worldId = "";
try {
  worldId = await seedWorld();
  console.log(`world ${worldId}`);
} catch (error) {
  console.error(`seeding failed: ${error.message}`);
  process.exit(1);
}

// ------------------------------------------------------------------ core route
await station("core-open-world", "Core route", "Open the world list", async () => {
  await page.goto(`${base}/`);
  await page.waitForLoadState("networkidle").catch(() => {});
});
await station(
  "core-world-list-help",
  "T-324",
  "Help button in the world list is square, like the toggle",
  async () => {
    const help = page.getByRole("button", { name: /Hilfe/ }).first();
    await help.waitFor({ timeout: 15_000 });
    const box = await help.boundingBox();
    return `Help button ${Math.round(box.width)}x${Math.round(box.height)} px`;
  },
);
await station("core-world-opened", "Core route", "Open the world: manuscript visible", async () => {
  await page.goto(`${base}/?world=${worldId}`);
  await toolbar("Manuskript").waitFor({ timeout: 90_000 });
});
await station("core-write", "Core route", "Write: text in the chapter", async () => {
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.click({ timeout: 15_000 });
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Rundgang-Satz am Ende des Kapitels.", { delay: 5 });
  await page.waitForTimeout(1500);
});
await station("core-new-chapter", "Core route", "Create a chapter", async () => {
  await page
    .getByRole("button", { name: "Neues Kapitel", exact: true })
    .first()
    .click({ timeout: 15_000 });
});
await station("core-new-folder", "T-351", "Create a folder: input wide, text visible", async () => {
  await page.getByRole("button", { name: "Ordner hinzufügen" }).click({ timeout: 15_000 });
  await page.waitForTimeout(500);
});
await station(
  "core-print-view",
  "Core route",
  "Print preview of the large manuscript",
  async () => {
    await page.goto(`${base}/?world=${worldId}`);
    await toolbar("Manuskript").waitFor({ timeout: 90_000 });
    await overflow("Manuskript", "Druckansicht");
    await page.locator(".print-document").waitFor({ timeout: 30_000 });
    await page.locator('.print-document[data-book-ready="true"]').waitFor({ timeout: 240_000 });
    return `${await page.locator(".print-document .pagedjs_page").count()} pages`;
  },
);

// ------------------------------------------------------------------ stations per task
await station("t354-index-no-cache", "T-354", "index.html is not cached", async () => {
  const response = await fetch(`${base}/`);
  const cache = response.headers.get("cache-control");
  if (!/no-cache|no-store|max-age=0/.test(cache ?? "")) throw new Error(`Cache-Control: ${cache}`);
  return `Cache-Control: ${cache}`;
});
await station("t323-favicon", "T-323", "Favicon links on the document", async () => {
  const links = await page.evaluate(() =>
    [...document.querySelectorAll('link[rel~="icon"]')].map((link) => link.getAttribute("href")),
  );
  return links.join(", ");
});
await station("t326-timeline-1100", "T-326", "Timeline strip at 1100 px", async () => {
  await page.goto(`${base}/?world=${worldId}`);
  await toolbar("Manuskript").waitFor({ timeout: 90_000 });
  // The strip sits at the bottom of the figure board.
  await page
    .getByRole("tab", { name: "Figuren" })
    .or(page.getByRole("button", { name: "Figuren", exact: true }))
    .first()
    .click({ timeout: 15_000 });
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.waitForTimeout(1500);
});
await station("t326-timeline-1280", "T-326", "Timeline strip at 1280 px", async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(500);
});
await page.setViewportSize({ width: 1440, height: 900 });
await station("t371-search", "T-371", "Search: match in the text, counter and next", async () => {
  await page.keyboard.press("Control+f");
  await page.waitForTimeout(500);
});

await page.keyboard.press("Escape");

// ------------------------------------------------------------------ pictures to judge
// These stations only bring the view up and take the picture; whether it is right is for the
// agent that walks the final commit (the matching `manual` line says what to look at).
for (const [id, task, title, tab] of [
  ["view-figures", "T-331", "Figure board of the large world", "Figuren"],
  ["view-timeline", "T-328", "Timeline view", "Timeline"],
  ["view-places", "T-325/T-359", "Places: map", "Orte"],
  ["view-storyboard", "Core route", "Storyboard", "Storyboard"],
]) {
  await station(id, task, title, async () => {
    await page
      .getByRole("tab", { name: tab })
      .or(page.getByRole("button", { name: tab, exact: true }))
      .first()
      .click({ timeout: 15_000 });
    await page.waitForTimeout(1500);
  });
}
await station("view-assistant", "T-329", "Assistant opened", async () => {
  await page.getByRole("button", { name: "Assistent" }).first().click({ timeout: 15_000 });
  await page.waitForTimeout(1000);
});

// ------------------------------------------------------------------ not scriptable here
manual(
  "t325-measure",
  "T-325",
  "Measure on the map: apply active, back in measure distance, legend on one line",
  "Places view, start and stop measuring",
);
manual(
  "t328-timeline-toggle",
  "T-328",
  "Timeline on top on/off, map below without a jump",
  "not on the line yet",
);
manual(
  "t329-assistant",
  "T-329",
  "Send button inside the assistant field, hint visible",
  "Open the assistant",
);
manual("t330-parts", "T-330", "Long chapter complete, part i of n visible", "needs a real AI run");
manual(
  "t331-figure-board",
  "T-331",
  "Figure board does not stutter when dragging or zooming",
  "Figure board of the large world",
);
manual(
  "t344-extraction",
  "T-344",
  "Large world is extracted; the disambiguation question appears",
  "needs a real AI run",
);
manual(
  "t349-browser-ai",
  "T-349/T-362",
  "Browser AI after a fresh download",
  "needs a real AI run",
);
manual("t353-trash", "T-353", "Trash hint: undo aligned right", "Delete a chapter");
manual(
  "t358-phone-photo",
  "T-358/T-360",
  "Phone photo as a map",
  "Photos from tests/fixtures/real-files",
);
manual(
  "t359-map-edge",
  "T-359",
  "Limit the view to the map, map edge reached, lock arrangement",
  "Places view",
);
manual("t350-word", "T-350", "Word with tracked moves: no false warning", "Word import");

writeFileSync(
  join(out, "rundgang.json"),
  `${JSON.stringify({ baseUrl: base, worldId, stations: results }, null, 2)}\n`,
);
await browser.close();
process.exit(results.some((entry) => entry.status === "failed") ? 1 : 0);
