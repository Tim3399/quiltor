import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";

const roots = Object.freeze(["packages/client/src/app", "packages/client/src/modules"]);

function normalized(path) {
  return path.split(sep).join("/");
}

export function isActionRankProductFile(file) {
  const path = normalized(file);
  if (![".ts", ".tsx"].includes(extname(path).toLowerCase())) return false;
  const segments = path.split("/");
  if (segments.some((segment) => ["test", "tests", "__tests__"].includes(segment.toLowerCase()))) {
    return false;
  }
  return !/\.(?:test|spec|story|testSupport)\.(?:ts|tsx)$/i.test(segments.at(-1));
}

export function discoverActionRankFiles(repositoryRoot) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && isActionRankProductFile(path)) files.push(path);
    }
  };
  for (const root of roots) {
    const directory = resolve(repositoryRoot, root);
    if (!existsSync(directory)) throw new Error(`Action-rank scope is missing: ${root}`);
    visit(directory);
  }
  return files.sort((left, right) => normalized(left).localeCompare(normalized(right)));
}

/**
 * Every opening JSX element as `{ name, start, end }`, where start and end bound its
 * attribute text. A slot prop holds whole elements, so these ranges nest: an attribute
 * belongs to the innermost range containing it, never to the strip it was passed to.
 */
export function jsxElements(source) {
  const elements = [];
  const pattern = /<([A-Z][\w.]*)/gu;
  let match = pattern.exec(source);
  while (match) {
    const start = match.index + match[0].length;
    let braces = 0;
    let quote = "";
    let escaped = false;
    let index = start;
    for (; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
      } else if (character === "{") {
        braces += 1;
      } else if (character === "}") {
        braces = Math.max(0, braces - 1);
      } else if (character === ">" && braces === 0) {
        elements.push({ name: match[1], start, end: index });
        break;
      }
    }
    // Resume right after the element name, not after its attribute block: slot props hold
    // whole elements, and those nested elements are exactly what this check is looking for.
    pattern.lastIndex = start;
    match = pattern.exec(source);
  }
  return elements;
}

function ownerOf(elements, position) {
  let owner;
  for (const element of elements) {
    if (element.start <= position && position < element.end) {
      if (!owner || element.start > owner.start) owner = element;
    }
  }
  return owner;
}

function attributeOwners(source, elements, pattern) {
  const found = [];
  for (const match of source.matchAll(pattern)) {
    const owner = ownerOf(elements, match.index);
    if (owner) found.push({ owner, value: match[1] });
  }
  return found;
}

/**
 * The action-rank contract for workspace toolbars.
 *
 * A workspace action strip carries exactly three ranks: the create contract is the one
 * emphasised action, toggles stay quiet and report their state through `aria-pressed`,
 * and everything else is a plain toolbar action. The rule applies to files that render a
 * strip; dialogs and canvas overlays answer to their own patterns and are out of scope.
 */
export function analyzeActionRankSource(source) {
  if (!source.includes("<WorkspaceToolbarActions")) return [];
  const elements = jsxElements(source);
  const ranks = new Map();
  for (const { owner, value } of attributeOwners(
    source,
    elements,
    /\bappearance\s*=\s*["']([a-z]+)["']/gu,
  )) {
    ranks.set(owner, value);
  }
  const toggles = new Set(
    attributeOwners(source, elements, /\b(aria-pressed)\s*=/gu).map((entry) => entry.owner),
  );

  const violations = [];
  for (const element of elements) {
    if (element.name === "WorkspaceToolbarCreateButton") continue;
    const rank = ranks.get(element);
    if (rank === "primary") {
      violations.push(`<${element.name}> claims primary emphasis; only the create contract may`);
    }
    if (toggles.has(element) && (rank === "primary" || rank === "secondary")) {
      violations.push(`<${element.name}> is a toggle with ${rank} emphasis; a toggle stays quiet`);
    }
  }
  return violations;
}

export function scanActionRanks(repositoryRoot) {
  const violations = [];
  for (const file of discoverActionRankFiles(repositoryRoot)) {
    for (const message of analyzeActionRankSource(readFileSync(file, "utf8"))) {
      violations.push(`${normalized(relative(repositoryRoot, file))}: ${message}`);
    }
  }
  return violations;
}

export function formatActionRankReport(violations) {
  return violations.length
    ? `Action-rank contract failed:\n${violations.map((violation) => `- ${violation}`).join("\n")}`
    : "Action-rank contract holds.";
}
