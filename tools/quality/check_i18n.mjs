import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { analyzeLocaleRegistry, closeLocaleRegistryParser } from "./locale_registry.mjs";

const root = process.cwd();
const sourceRoot = join(root, "packages", "client", "src");
const localeRoot = join(root, "locales");
const baseLocale = "de";
const failures = [];

const ignored = new Set([
  "node_modules",
  "dist",
  "test-results",
  "playwright-report",
  ".git",
  ".venv-desktop",
  "build",
]);

const allowedLiteralText = new Set([
  "Aa",
  "Esc",
  "JSON",
  "Tab",
  "⌘ F",
  "⌘ K",
  "python apps/web/server.py",
]);
const humanText = /[A-Za-zÄÖÜäöüß]/;
const attr = /\b(?:aria-label|title|placeholder)=["']([^"'{}]*)["']/g;
const jsxText = />([^<>{}\n]{2,})<\/[A-Za-z]/g;

function scanVisibleText(file, text) {
  text.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(attr)) {
      const content = match[1].trim();
      if (content && !allowedLiteralText.has(content)) {
        failures.push(`${file}:${index + 1}: hard-coded attribute "${content}"`);
      }
    }
    for (const match of line.matchAll(jsxText)) {
      const content = match[1].trim();
      if (humanText.test(content) && !allowedLiteralText.has(content)) {
        failures.push(`${file}:${index + 1}: hard-coded text "${content}"`);
      }
    }
  });
}

function visitSource(path) {
  if (ignored.has(path.split(/[/\\]/).at(-1))) return;
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path)) visitSource(join(path, name));
    return;
  }
  if (extname(path) !== ".tsx" || path.endsWith(".test.tsx")) return;
  scanVisibleText(relative(root, path), readFileSync(path, "utf8"));
}

function catalog(directory) {
  const messages = new Map();
  const files = readdirSync(directory)
    .filter((name) => name.endsWith(".ts") && name !== "index.ts")
    .sort();

  for (const name of files) {
    const path = join(directory, name);
    const source = readFileSync(path, "utf8");
    const property = /^\s*([A-Za-z_$][\w$]*)\s*:\s*("(?:\\.|[^"\\])*")\s*,?\s*$/gm;
    for (const match of source.matchAll(property)) {
      const key = match[1];
      const value = JSON.parse(match[2]);
      if (messages.has(key)) failures.push(`${relative(root, path)}: duplicate key ${key}`);
      messages.set(key, value);
    }
  }
  return { files, messages };
}

function placeholders(value) {
  return [...value.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((match) => match[1]).sort();
}

function validateManifest(locale, directory) {
  const path = join(directory, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    failures.push(`${relative(root, path)}: missing or invalid manifest (${error.message})`);
    return;
  }
  if (manifest.locale !== locale)
    failures.push(`${relative(root, path)}: locale must be "${locale}"`);
  if (typeof manifest.name !== "string" || !manifest.name.trim()) {
    failures.push(`${relative(root, path)}: name must be a non-empty native language name`);
  }
  if (manifest.direction !== "ltr" && manifest.direction !== "rtl") {
    failures.push(`${relative(root, path)}: direction must be "ltr" or "rtl"`);
  }
  try {
    if (Intl.getCanonicalLocales(locale)[0] !== locale) {
      failures.push(`${relative(root, path)}: use the canonical BCP 47 locale tag`);
    }
  } catch {
    failures.push(`${relative(root, path)}: ${locale} is not a valid BCP 47 locale tag`);
  }
}

visitSource(sourceRoot);

const locales = readdirSync(localeRoot)
  .filter((name) => statSync(join(localeRoot, name)).isDirectory())
  .sort();
if (!locales.includes(baseLocale)) failures.push(`locales/${baseLocale}: missing base locale`);
const registryPath = join(localeRoot, "index.ts");
const registrySource = existsSync(registryPath) ? readFileSync(registryPath, "utf8") : "";
if (!registrySource) failures.push("locales/index.ts: missing explicit locale package registry");
if (registrySource) {
  const registry = analyzeLocaleRegistry({
    file: registryPath,
    source: registrySource,
    expectedLocales: locales,
  });
  failures.push(...registry.violations.map((failure) => `locales/index.ts: ${failure}`));
}
closeLocaleRegistryParser();

const catalogs = new Map();
for (const locale of locales) {
  const directory = join(localeRoot, locale);
  validateManifest(locale, directory);
  if (!readdirSync(directory).includes("index.ts")) {
    failures.push(`locales/${locale}/index.ts: missing catalog entrypoint`);
  }
  catalogs.set(locale, catalog(directory));
}

const base = catalogs.get(baseLocale);
if (base) {
  for (const [locale, candidate] of catalogs) {
    if (locale === baseLocale) continue;
    const missingFiles = base.files.filter((name) => !candidate.files.includes(name));
    const extraFiles = candidate.files.filter((name) => !base.files.includes(name));
    const missingKeys = [...base.messages.keys()].filter((key) => !candidate.messages.has(key));
    const extraKeys = [...candidate.messages.keys()].filter((key) => !base.messages.has(key));
    if (missingFiles.length)
      failures.push(`locales/${locale}: missing files ${missingFiles.join(", ")}`);
    if (extraFiles.length)
      failures.push(`locales/${locale}: unexpected files ${extraFiles.join(", ")}`);
    if (missingKeys.length)
      failures.push(`locales/${locale}: missing keys ${missingKeys.join(", ")}`);
    if (extraKeys.length)
      failures.push(`locales/${locale}: unexpected keys ${extraKeys.join(", ")}`);
    for (const [key, baseMessage] of base.messages) {
      const translated = candidate.messages.get(key);
      if (translated === undefined) continue;
      const expected = placeholders(baseMessage);
      const actual = placeholders(translated);
      if (expected.join("\0") !== actual.join("\0")) {
        failures.push(
          `locales/${locale}: ${key} placeholders must be {${expected.join("}, {")}}, got {${actual.join("}, {")}}`,
        );
      }
    }
  }
}

if (failures.length) {
  console.error(`i18n check failed (${failures.length}):\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(
    `UI catalogs are complete: ${locales.join(", ")} (${base?.messages.size ?? 0} messages each).`,
  );
  console.log("No hard-coded visible UI text found.");
}
