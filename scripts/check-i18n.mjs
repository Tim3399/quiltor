import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const languageRoot = join(root, "src", "language");
const ignored = new Set(["node_modules", "dist", "test-results", "playwright-report", ".git"]);

// Product UI must be localized regardless of its source language. Technical labels that are
// intentionally language-neutral are explicit here instead of being silently ignored.
const allowedLiteralText = new Set(["Aa", "Esc", "JSON", "Tab", "⌘ F", "⌘ K", "python3 server.py"]);
const humanText = /[A-Za-zÄÖÜäöüß]/;
const attr = /\b(?:aria-label|title|placeholder)=["']([^"'{}]*)["']/g;
const jsxText = />([^<>{}\n]{2,})<\/[A-Za-z]/g;

const violations = [];

function scan(file, text) {
  text.split("\n").forEach((line, index) => {
    let m;
    attr.lastIndex = 0;
    while ((m = attr.exec(line))) {
      const content = m[1].trim();
      if (content && !allowedLiteralText.has(content))
        violations.push(`${file}:${index + 1}: [attr] "${content}"`);
    }
    jsxText.lastIndex = 0;
    while ((m = jsxText.exec(line))) {
      const content = m[1].trim();
      if (humanText.test(content) && !allowedLiteralText.has(content))
        violations.push(`${file}:${index + 1}: [text] "${content}"`);
    }
  });
}

function visit(path) {
  if (path === languageRoot) return;
  if (ignored.has(path.split(/[/\\]/).at(-1))) return;
  if (statSync(path).isDirectory())
    return readdirSync(path).forEach((name) => visit(join(path, name)));
  if (extname(path) !== ".tsx" || path.endsWith(".test.tsx")) return;
  scan(relative(root, path), readFileSync(path, "utf8"));
}

visit(join(root, "src"));
if (violations.length) {
  console.error(
    `Hartcodierte sichtbare Texte außerhalb von src/language (${violations.length}):\n` +
      violations.join("\n"),
  );
  process.exitCode = 1;
} else {
  console.log("Keine hartcodierten sichtbaren UI-Texte gefunden.");
}

// Strings and line comments have to be removed in a single pass, not by two chained regexes:
// stripping strings first lets an apostrophe inside a comment ("its own file") open a string
// that swallows the rest of the file, while stripping comments first eats the // in URLs.
function withoutStringsAndComments(text) {
  let out = "";
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "'") {
      while (++index < text.length && text[index] !== "'") if (text[index] === "\\") index++;
      out += "''";
    } else if (text[index] === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") index++;
      out += "\n";
    } else out += text[index];
  }
  return out;
}

function languageKeys(directory) {
  const keys = new Set();
  const duplicates = new Set();
  for (const name of readdirSync(directory)) {
    if (!name.endsWith(".ts") || name === "index.ts") continue;
    const text = readFileSync(join(directory, name), "utf8");
    const structure = withoutStringsAndComments(text);
    for (const match of structure.matchAll(/(?:^|[, {\n])\s*([A-Za-z_$][\w$]*)\s*:/gm)) {
      if (keys.has(match[1])) duplicates.add(match[1]);
      keys.add(match[1]);
    }
  }
  return { keys, duplicates };
}

const deCatalog = languageKeys(join(languageRoot, "de"));
const enCatalog = languageKeys(join(languageRoot, "en"));
const catalogFiles = (directory) =>
  readdirSync(directory)
    .filter((name) => name.endsWith(".ts") && name !== "index.ts")
    .sort();
const deFiles = catalogFiles(join(languageRoot, "de"));
const enFiles = catalogFiles(join(languageRoot, "en"));
const deKeys = deCatalog.keys;
const enKeys = enCatalog.keys;
const missingEnFiles = deFiles.filter((name) => !enFiles.includes(name));
const missingDeFiles = enFiles.filter((name) => !deFiles.includes(name));
const missingEn = [...deKeys].filter((key) => !enKeys.has(key));
const missingDe = [...enKeys].filter((key) => !deKeys.has(key));
if (
  missingEn.length ||
  missingDe.length ||
  missingEnFiles.length ||
  missingDeFiles.length ||
  deCatalog.duplicates.size ||
  enCatalog.duplicates.size
) {
  if (missingEnFiles.length)
    console.error(`Fehlende englische Katalogdateien: ${missingEnFiles.join(", ")}`);
  if (missingDeFiles.length)
    console.error(`Fehlende deutsche Katalogdateien: ${missingDeFiles.join(", ")}`);
  if (missingEn.length) console.error(`Fehlende englische Schlüssel: ${missingEn.join(", ")}`);
  if (missingDe.length) console.error(`Fehlende deutsche Schlüssel: ${missingDe.join(", ")}`);
  if (deCatalog.duplicates.size)
    console.error(`Doppelte deutsche Schlüssel: ${[...deCatalog.duplicates].join(", ")}`);
  if (enCatalog.duplicates.size)
    console.error(`Doppelte englische Schlüssel: ${[...enCatalog.duplicates].join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(`Sprachschlüssel sind vollständig und paarig (${deKeys.size}).`);
}
