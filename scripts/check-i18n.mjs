import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const languageRoot = join(root, "src", "language");

const ignored = new Set([
  "node_modules",
  "dist",
  "test-results",
  "playwright-report",
  ".git",
  ".venv-desktop",
  "build",
]);

// Product UI must be localized regardless of its source language. Technical labels that are
// intentionally language-neutral are explicit here instead of being silently ignored.
const allowedLiteralText = new Set(["Aa", "Esc", "JSON", "Tab", "⌘ F", "⌘ K", "python3 server.py"]);

const humanText = /[A-Za-zÄÖÜäöüß]/;
const attr = /\b(?:aria-label|title|placeholder)=["']([^"'{}]*)["']/g;
const jsxText = />([^<>{}\n]{2,})<\/[A-Za-z]/g;

const violations = [];

function scan(file, text) {
  text.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(attr)) {
      const content = match[1].trim();

      if (content && !allowedLiteralText.has(content)) {
        violations.push(`${file}:${index + 1}: [attr] "${content}"`);
      }
    }

    for (const match of line.matchAll(jsxText)) {
      const content = match[1].trim();

      if (humanText.test(content) && !allowedLiteralText.has(content)) {
        violations.push(`${file}:${index + 1}: [text] "${content}"`);
      }
    }
  });
}

function visit(path) {
  if (path === languageRoot) {
    return;
  }

  if (ignored.has(path.split(/[/\\]/).at(-1))) {
    return;
  }

  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path)) {
      visit(join(path, name));
    }

    return;
  }

  if (extname(path) !== ".tsx" || path.endsWith(".test.tsx")) {
    return;
  }

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

// Remove strings and comments before looking for object keys.
//
// This deliberately understands all JavaScript/TypeScript string delimiters:
//   'single quotes'
//   "double quotes"
//   `template literals`
//
// Formatter choice must never change the result of the i18n check.
//
// Comments are removed in the same pass because stripping strings and comments
// with independent regexes is unsafe:
// - apostrophes inside comments can look like strings
// - // inside strings such as URLs can look like comments
//
// Newlines are preserved so regex anchors and diagnostics continue to behave
// predictably after stripping multi-line comments or template literals.
function withoutStringsAndComments(text) {
  let output = "";
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];

    // String literals: single quote, double quote or template literal.
    if (char === "'" || char === '"' || char === "`") {
      const quote = char;

      output += " ";
      index += 1;

      while (index < text.length) {
        const current = text[index];

        if (current === "\\") {
          // Preserve a newline after a line continuation, otherwise just
          // replace the escaped pair with spaces.
          if (text[index + 1] === "\n") {
            output += " \n";
          } else {
            output += "  ";
          }

          index += 2;
          continue;
        }

        if (current === quote) {
          output += " ";
          index += 1;
          break;
        }

        output += current === "\n" ? "\n" : " ";
        index += 1;
      }

      continue;
    }

    // Line comment.
    if (char === "/" && next === "/") {
      output += "  ";
      index += 2;

      while (index < text.length && text[index] !== "\n") {
        output += " ";
        index += 1;
      }

      continue;
    }

    // Block comment.
    if (char === "/" && next === "*") {
      output += "  ";
      index += 2;

      while (index < text.length) {
        if (text[index] === "*" && text[index + 1] === "/") {
          output += "  ";
          index += 2;
          break;
        }

        output += text[index] === "\n" ? "\n" : " ";
        index += 1;
      }

      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

function languageKeys(directory) {
  const keys = new Set();
  const duplicates = new Set();

  for (const name of readdirSync(directory)) {
    if (!name.endsWith(".ts") || name === "index.ts") {
      continue;
    }

    const text = readFileSync(join(directory, name), "utf8");

    const structure = withoutStringsAndComments(text);

    const keyPattern = /(?:^|[, {\n])\s*([A-Za-z_$][\w$]*)\s*:/gm;

    for (const match of structure.matchAll(keyPattern)) {
      const key = match[1];

      if (keys.has(key)) {
        duplicates.add(key);
      }

      keys.add(key);
    }
  }

  return {
    keys,
    duplicates,
  };
}

function catalogFiles(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".ts") && name !== "index.ts")
    .sort();
}

const deCatalog = languageKeys(join(languageRoot, "de"));

const enCatalog = languageKeys(join(languageRoot, "en"));

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
  if (missingEnFiles.length) {
    console.error(`Fehlende englische Katalogdateien: ${missingEnFiles.join(", ")}`);
  }

  if (missingDeFiles.length) {
    console.error(`Fehlende deutsche Katalogdateien: ${missingDeFiles.join(", ")}`);
  }

  if (missingEn.length) {
    console.error(`Fehlende englische Schlüssel: ${missingEn.join(", ")}`);
  }

  if (missingDe.length) {
    console.error(`Fehlende deutsche Schlüssel: ${missingDe.join(", ")}`);
  }

  if (deCatalog.duplicates.size) {
    console.error(`Doppelte deutsche Schlüssel: ${[...deCatalog.duplicates].join(", ")}`);
  }

  if (enCatalog.duplicates.size) {
    console.error(`Doppelte englische Schlüssel: ${[...enCatalog.duplicates].join(", ")}`);
  }

  process.exitCode = 1;
} else {
  console.log(`Sprachschlüssel sind vollständig und paarig (${deKeys.size}).`);
}
