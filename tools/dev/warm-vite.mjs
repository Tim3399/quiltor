// Warms a cold Vite dev server before a browser suite runs against it.
//
// The "Generate visual baselines" workflow serves the client with `npx vite` on a fresh runner.
// The first page request then waits for Vite's dependency optimisation, and opening a world
// waits again while the lazily imported workspaces compile. On windows-2025 that took 30.8 s
// for `/` alone (run 41859545842), and the first tests failed their 5 s wait for the editor
// while it still read "Werkstatt wird geöffnet …". A curl readiness probe does not pay that
// cost; a browser does.
//
// This loads the page once, then imports every module the client loads lazily, so the first
// test meets a warm server. It fails closed: any failed load or import, or the time limit,
// exits non-zero and the job stops before a single test runs.
//
//   node tools/dev/warm-vite.mjs --url http://127.0.0.1:4173 [--timeout-ms 120000]

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLIENT_SOURCES = join(REPO_ROOT, "packages", "client", "src");
const EXTENSIONS = [".tsx", ".ts", "/index.tsx", "/index.ts"];
const RELATIVE_DYNAMIC_IMPORT = /\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name) || /\.(test|story)\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

/** Absolute paths of every client module reached through a relative `import("./…")`. */
export function lazyModules(root = CLIENT_SOURCES) {
  const found = new Set();
  for (const file of sourceFiles(root)) {
    for (const [, specifier] of readFileSync(file, "utf8").matchAll(RELATIVE_DYNAMIC_IMPORT)) {
      const base = resolve(dirname(file), specifier);
      const target = EXTENSIONS.map((extension) => base + extension).find(existsSync);
      if (!target)
        throw new Error(
          `${relative(REPO_ROOT, file)} imports ${specifier}, which does not resolve`,
        );
      found.add(target);
    }
  }
  return [...found].sort();
}

/** The URL Vite serves a file outside its root under. */
export function viteFsUrl(path) {
  return "/@fs/" + pathToFileURL(path).pathname.replace(/^\/+/, "");
}

/**
 * Opens the page, then imports each module, all within timeoutMs.
 * `open` and `importModule` are injected so the time limit is testable without a browser.
 */
export async function warmUp({ open, importModule, modules, timeoutMs }) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`the dev server was not warm within ${timeoutMs} ms`)),
      timeoutMs,
    );
  });
  const work = (async () => {
    await open();
    for (const module of modules) await importModule(module);
  })();
  try {
    await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
  }
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (value === undefined) throw new Error(`${name} needs a value`);
  return value;
}

async function main(args) {
  const url = option(args, "--url");
  if (!url) throw new Error("--url is required");
  const timeoutMs = Number(option(args, "--timeout-ms", "120000"));
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("--timeout-ms must be positive");
  await warmViteServer({ url, timeoutMs });
}

const RELOADS_PER_MODULE = 3;

/**
 * Runs `load` again after the page reloaded under it, at most RELOADS_PER_MODULE times.
 *
 * An import that finds a dependency Vite has not optimised yet makes Vite optimise it and
 * reload the page, which destroys the context the import ran in. That reload is the cold start
 * this script pays for; once the page has loaded again, the import goes through.
 */
export async function importAcrossReloads(load, waitForLoad) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await load();
    } catch (error) {
      const reloaded = /Execution context was destroyed/.test(String(error?.message ?? error));
      if (!reloaded || attempt >= RELOADS_PER_MODULE) throw error;
      await waitForLoad();
    }
  }
}

/** Loads `url` in a headless Chromium and imports every lazy client module through it. */
export async function warmViteServer({ url, timeoutMs }) {
  const modules = lazyModules();
  if (modules.length === 0) throw new Error("found no lazily imported client module to warm");

  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  const started = Date.now();
  try {
    const page = await browser.newPage();
    await warmUp({
      modules,
      timeoutMs,
      open: async () => {
        const response = await page.goto(url, { waitUntil: "load", timeout: 0 });
        if (!response?.ok()) throw new Error(`${url} answered ${response?.status()}`);
      },
      importModule: (path) =>
        importAcrossReloads(
          () =>
            page.evaluate(async (specifier) => {
              await import(specifier);
            }, viteFsUrl(path)),
          () => page.waitForLoadState("load"),
        ),
    });
    console.log(
      `Vite is warm: page and ${modules.length} lazy modules in ${Date.now() - started} ms.`,
    );
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(
      `Warming the Vite dev server failed: ${error instanceof Error ? error.message : error}`,
    );
    process.exitCode = 1;
  });
}
