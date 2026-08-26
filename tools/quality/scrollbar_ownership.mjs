import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import { analyzeCssDesignDebtSource } from "./css_design_debt.mjs";

export const scrollbarOwner = "packages/client/src/design/components/ScrollArea/ScrollArea.css";

const clientCssRoot = "packages/client/src";
const scrollbarColorDeclaration = /(?:^|[;{}])\s*(scrollbar-color)\s*:/giu;
const webkitScrollbarSelector = /::-webkit-scrollbar(?:-[\w-]+)?/giu;

function normalizedPath(path) {
  return path.split(sep).join("/");
}

function isRepositoryPath(file, repositoryPath) {
  const normalized = normalizedPath(file);
  return normalized === repositoryPath || normalized.endsWith(`/${repositoryPath}`);
}

function sourceLine(source, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source[cursor] === "\n") line += 1;
  }
  return line;
}

function isHexDigit(character) {
  return character !== undefined && /[\dA-Fa-f]/u.test(character);
}

function decodeEscape(source, index) {
  const next = source[index + 1];
  if (!isHexDigit(next)) return { value: next, end: index + 2 };

  let end = index + 1;
  while (end < source.length && end < index + 7 && isHexDigit(source[end])) end += 1;
  const codePoint = Number.parseInt(source.slice(index + 1, end), 16);
  if (source[end] === "\r" && source[end + 1] === "\n") end += 2;
  else if (/\s/u.test(source[end] || "")) end += 1;
  const value =
    codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ? "�"
      : String.fromCodePoint(codePoint);
  return { value, end };
}

/**
 * Remove comments and string contents, decode CSS escapes and retain a map to
 * the original source. The shared CSS debt parser validates the grammar first;
 * this pass only makes forbidden semantic identifiers searchable without
 * allowing comments, strings or escapes to hide them.
 */
function searchableCss(source) {
  let text = "";
  const sourceIndexes = [];
  let cursor = 0;

  function append(value, sourceIndex) {
    text += value;
    for (let index = 0; index < value.length; index += 1) sourceIndexes.push(sourceIndex);
  }

  while (cursor < source.length) {
    if (source.startsWith("/*", cursor)) {
      const end = source.indexOf("*/", cursor + 2);
      append(" ", cursor);
      cursor = end + 2;
      continue;
    }

    const character = source[cursor];
    if (character === '"' || character === "'") {
      const quote = character;
      const start = cursor;
      cursor += 1;
      while (source[cursor] !== quote) {
        if (source[cursor] === "\\") {
          if (source[cursor + 1] === "\r" && source[cursor + 2] === "\n") cursor += 3;
          else cursor += 2;
        } else {
          cursor += 1;
        }
      }
      cursor += 1;
      append(" ", start);
      continue;
    }

    if (character === "\\") {
      const escaped = decodeEscape(source, cursor);
      append(escaped.value, cursor);
      cursor = escaped.end;
      continue;
    }

    append(character, cursor);
    cursor += 1;
  }

  return { text, sourceIndexes };
}

/** Find locally owned scrollbar recipes in one productive CSS source. */
export function analyzeScrollbarOwnershipSource({ file, source }) {
  // Reuse the project's strict CSS parser so malformed or unsupported syntax
  // cannot make this smaller ownership scanner silently skip a block.
  analyzeCssDesignDebtSource({ file, source });

  if (isRepositoryPath(file, scrollbarOwner)) return [];

  const { text, sourceIndexes } = searchableCss(source);
  const violations = [];

  for (const match of text.matchAll(scrollbarColorDeclaration)) {
    const identifierIndex = match.index + match[0].lastIndexOf(match[1]);
    const originalIndex = sourceIndexes[identifierIndex];
    violations.push({
      file: normalizedPath(file),
      line: sourceLine(source, originalIndex),
      kind: "scrollbar-color",
      message: "scrollbar-color declarations belong to the public ScrollArea owner",
    });
  }

  for (const match of text.matchAll(webkitScrollbarSelector)) {
    const originalIndex = sourceIndexes[match.index];
    violations.push({
      file: normalizedPath(file),
      line: sourceLine(source, originalIndex),
      kind: "webkit-scrollbar-selector",
      message: `${match[0]} selectors belong to the public ScrollArea owner`,
    });
  }

  return violations;
}

/** True only for productive client CSS; tests, stories and gallery fixtures are excluded. */
export function isScrollbarOwnershipSourceFile(file) {
  const path = normalizedPath(file);
  if (extname(path).toLowerCase() !== ".css") return false;
  const scopedPath = /(?:^|\/)packages\/client\/src\/(.*)$/u.exec(path)?.[1] || path;
  const segments = scopedPath.split("/");
  if (segments.some((segment) => ["test", "tests", "__tests__"].includes(segment.toLowerCase()))) {
    return false;
  }
  if (segments[0] === "design" && segments[1] === "testing") return false;
  return !/\.(?:test|spec|testSupport|story|stories)\.css$/iu.test(segments.at(-1));
}

export function discoverScrollbarOwnershipFiles(repositoryRoot) {
  const root = resolve(repositoryRoot, clientCssRoot);
  if (!existsSync(root)) throw new Error(`Scrollbar ownership scope is missing: ${clientCssRoot}`);
  const files = [];

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && isScrollbarOwnershipSourceFile(path)) files.push(path);
    }
  }

  visit(root);
  return files.sort((left, right) => normalizedPath(left).localeCompare(normalizedPath(right)));
}

export function scanScrollbarOwnership(repositoryRoot) {
  const owner = resolve(repositoryRoot, scrollbarOwner);
  if (!existsSync(owner))
    throw new Error(`Public ScrollArea CSS owner is missing: ${scrollbarOwner}`);

  const violations = [];
  for (const file of discoverScrollbarOwnershipFiles(repositoryRoot)) {
    const source = readFileSync(file, "utf8");
    for (const violation of analyzeScrollbarOwnershipSource({ file, source })) {
      violations.push({
        ...violation,
        file: normalizedPath(relative(repositoryRoot, file)),
      });
    }
  }
  return violations;
}

export function formatScrollbarOwnershipViolation(violation) {
  return `${violation.file}:${violation.line}: [Scrollbar-Owner] ${violation.message}`;
}
