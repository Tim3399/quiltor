// Times the five exports of a manuscript against a running Quiltor (T-364, checklist 2e).
//
//   node tools/release/stage-exports.mjs --base-url http://127.0.0.1:18481 \
//     --world sample=sample.json --world large=large.json --out exports.json
//
// Each --world file is a world as tests/world prints it ({ manuscript, figures, storyboards }).
// The script creates a world per file, stores the documents the way the product suites do and
// then asks for PDF, DOCX (editor and Normseite), EPUB and Markdown. Writes carry the Origin
// of --base-url, because a hosted server refuses a write from anywhere else. Everything is
// measured at the client of the proxy, not inside the container.
//
// Markdown is produced by the client, so that one runs in Chromium: the time is the click on
// "Manuskript als Markdown" until the browser receives the download.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";

const { values } = parseArgs({
  options: {
    "base-url": { type: "string" },
    world: { type: "string", multiple: true },
    out: { type: "string" },
    "pdf-timeout": { type: "string", default: "180" },
    "skip-markdown": { type: "boolean", default: false },
  },
});
if (!values["base-url"] || !values.world?.length || !values.out) {
  console.error(
    "usage: stage-exports.mjs --base-url URL --world name=file.json ... --out file.json",
  );
  process.exit(2);
}
const base = values["base-url"].replace(/\/$/, "");
const token = process.env.QUILTOR_STAGE_TOKEN ?? "";
const auth = token ? { Authorization: `Bearer ${token}` } : {};
const headers = { Origin: base, "Content-Type": "application/json", ...auth };

function secondsSince(start) {
  return Math.round(performance.now() - start) / 1000;
}

// A compressing proxy weakens or extends the tag ("0" -> W/"0", "0-zstd"); the client accepts both.
function revisionOf(response) {
  const match = /^(?:W\/)?"(\d+)(?:-(?:gzip|zstd|br))?"$/.exec(
    response.headers.get("etag") ?? '"0"',
  );
  if (!match) throw new Error(`unexpected ETag ${response.headers.get("etag")}`);
  return Number(match[1]);
}

async function call(method, path, body, extra = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...headers, ...extra.headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout((extra.timeout ?? 120) * 1000),
  });
  return response;
}

async function seed(title, world) {
  const created = await call("POST", "/api/worlds/create", { title, backupUrl: "" });
  if (!created.ok)
    throw new Error(`create ${title}: HTTP ${created.status} ${await created.text()}`);
  const id = (await created.json()).world.id;
  const documents = [
    ["state", "quiltor.story-world", world.figures],
    ["manuscript", "quiltor.manuscript", world.manuscript],
    ["storyboards", "quiltor.storyboards", world.storyboards],
  ];
  const started = performance.now();
  for (const [endpoint, contract, payload] of documents) {
    const path = `/api/${endpoint}?world=${id}`;
    const current = await call("GET", path);
    const revision = revisionOf(current);
    const saved = await call(
      "PUT",
      path,
      { contract, version: 1, revision, payload },
      { headers: { "If-Match": `"${revision}"` }, timeout: 120 },
    );
    if (!saved.ok)
      throw new Error(
        `save ${endpoint}: HTTP ${saved.status} ${(await saved.text()).slice(0, 300)}`,
      );
  }
  return { id, seedSeconds: secondsSince(started) };
}

async function timed(label, run) {
  const start = performance.now();
  try {
    const result = await run();
    return { label, seconds: secondsSince(start), ...result };
  } catch (error) {
    return {
      label,
      seconds: secondsSince(start),
      ok: false,
      error: String(error?.message ?? error),
    };
  }
}

async function download(path, body, kind, timeout) {
  const response = await call("POST", path, body, { timeout });
  const bytes = Buffer.from(await response.arrayBuffer());
  const ok = response.ok && bytes.length > 0;
  return {
    ok,
    status: response.status,
    bytes: bytes.length,
    contentType: response.headers.get("content-type"),
    magic: bytes
      .subarray(0, 5)
      .toString("latin1")
      .replace(/[^\x20-\x7e]/g, "?"),
    sha256: createHash("sha256").update(bytes).digest("hex").slice(0, 16),
    ...(ok ? {} : { error: bytes.toString("utf8").slice(0, 300) }),
    kind,
  };
}

async function office(id, preset, format) {
  const preview = await call("POST", `/api/manuscript-export/preview?world=${id}`, { preset });
  if (!preview.ok)
    throw new Error(
      `preview ${preset}: HTTP ${preview.status} ${(await preview.text()).slice(0, 200)}`,
    );
  const { preview: data } = await preview.json();
  return download(
    `/api/manuscript-export/${format}?world=${id}`,
    {
      preset,
      revision: data.revision,
      sourceSha256: data.sourceSha256,
      acknowledgedWarnings: data.warnings.map((warning) => warning.code),
    },
    format,
    180,
  );
}

async function markdown(browser, id) {
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: auth,
  });
  const page = await context.newPage();
  try {
    await page.goto(`${base}/?world=${id}`);
    await page.getByRole("toolbar", { name: "Manuskript" }).waitFor({ timeout: 90_000 });
    await page
      .getByRole("toolbar", { name: "Manuskript", exact: true })
      .getByRole("button", { name: "Weitere Aktionen", exact: true })
      .click();
    const start = performance.now();
    const waiting = page.waitForEvent("download", { timeout: 120_000 });
    await page.getByRole("menuitem", { name: "Manuskript als Markdown", exact: true }).click();
    const file = await waiting;
    const path = await file.path();
    const bytes = readFileSync(path);
    return {
      label: "markdown",
      seconds: secondsSince(start),
      ok: bytes.length > 0,
      bytes: bytes.length,
      fileName: file.suggestedFilename(),
    };
  } catch (error) {
    return { label: "markdown", seconds: 0, ok: false, error: String(error?.message ?? error) };
  } finally {
    await context.close();
  }
}

async function compression(id) {
  const rows = [];
  for (const path of [`/api/manuscript?world=${id}`, "/", "/api/version"]) {
    const response = await fetch(`${base}${path}`, {
      headers: { "Accept-Encoding": "zstd, gzip", ...auth },
    });
    const raw = Buffer.from(await response.arrayBuffer());
    rows.push({
      path: path.replace(/\?.*/, ""),
      status: response.status,
      contentEncoding: response.headers.get("content-encoding"),
      decodedBytes: raw.length,
      contentLength: response.headers.get("content-length"),
    });
  }
  return rows;
}

const report = { baseUrl: base, startedAt: new Date().toISOString(), worlds: [] };
const browser = values["skip-markdown"] ? null : await chromium.launch({ headless: true });
try {
  for (const entry of values.world) {
    const [name, file] = entry.split("=");
    const world = JSON.parse(readFileSync(file, "utf8"));
    const { id, seedSeconds } = await seed(`Stufe ${name}`, world);
    const results = [];
    results.push(
      await timed("pdf", () =>
        download("/api/book.pdf", { worldId: id }, "pdf", Number(values["pdf-timeout"])),
      ),
    );
    results.push(await timed("docx-editor", () => office(id, "editor", "docx")));
    results.push(await timed("docx-normseite", () => office(id, "normseite", "docx")));
    results.push(await timed("epub", () => office(id, "epub", "epub")));
    if (browser) results.push(await markdown(browser, id));
    report.worlds.push({
      name,
      worldId: id,
      chapters: world.manuscript.chapters.length,
      characters: world.manuscript.chapters.reduce((sum, chapter) => sum + chapter.body.length, 0),
      seedSeconds,
      results,
      compression: await compression(id),
    });
    for (const result of results) {
      console.log(
        `${name.padEnd(8)} ${result.label.padEnd(15)} ${String(result.seconds).padStart(8)} s  ${result.ok ? "ok" : "FAILED"}  ${result.bytes ?? ""} ${result.error ?? ""}`,
      );
    }
  }
} finally {
  await browser?.close();
}
mkdirSync(dirname(values.out), { recursive: true });
writeFileSync(values.out, `${JSON.stringify(report, null, 2)}\n`);
process.exit(report.worlds.some((entry) => entry.results.some((result) => !result.ok)) ? 1 : 0);
