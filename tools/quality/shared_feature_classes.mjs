import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

const NEWLINE = String.fromCharCode(10);

const MODULES = "packages/client/src/modules";

/**
 * CSS classes used across feature boundaries -- and why.
 *
 * Sharing is not forbidden; the `graph` module exists for exactly that. Only sharing
 * unnoticed is expensive: `.figure-layout` is named after the figures but carries the places
 * view as well, and a third grid column for the one took the other apart. This entry is the
 * place where somebody saw that. New shared classes stand out until they are listed here --
 * and entries that no longer share anything stand out just as much.
 */
export const SHARED_FEATURE_CLASSES = Object.freeze({
  "editable-chips":
    "Editable chip list shared by the terms sheet and the elements sheet: both show the same kind of list, one you switch on and off or remove from.",
  "figure-layout":
    "Grid frame of figures AND places. Change the column count only under .figure-workspace -- see StoryGraphLayout.test.ts.",
  "layout-without-inspector": "The same frame without the control column, in both views.",
  "has-selection": "Selection state of the inspector in figures and places.",
  "is-connecting": "The canvas connecting mode, in figures and places.",
  "importance-mark": "The star on a card, the same one in figures and places.",
  "story-world-toast": "Message surface of the world views, the same place in figures and places.",
  "graph-viewport-surface": "Canvas shell from the graph module; world graph and storyboard.",
  "has-minimap": "State of that same shell; it drives the keep-clear areas along the bottom edge.",
  "graph-edge-surface": "Edge surface from the graph module; world graph and storyboard.",
  "graph-edge-inspector-panel": "Edge inspector from the graph module; world graph and storyboard.",
  "graph-edge-appearance-select": "Shared shell of the three edge selects.",
  "graph-edge-appearance-select__label": "Part of that same shell.",
  "graph-edge-appearance-select__control": "Part of that same shell.",
  "directed-handle": "Connection handle from the figure board; the storyboard uses the same one.",
  "neutral-handle": "Undirected connection handle, likewise from the figure board.",
  "focus-side-toggle": "Described in FocusPanels.css, rendered by WorkspaceLayout.",
  "focus-helper-toggle": "Second tab of that same focus strip, the same division.",
  "writing-data-state": "Result display of the writing aid, shared by lookup and checking.",
  "writing-values": "List of hits inside that same result display.",
  "writing-value": "A single hit inside that same result display.",
  "writing-attribution": "Source note beneath that same result display.",
  "is-visible": "State in the chapter tree, set by the tree and by the rows.",
  "is-active": "Active entry in the chapter tree, set by the tree and by the rows.",
  selected:
    "A general state word that several stylesheets define for themselves. Not a shared decision -- more a candidate for untangling.",
  active: "Likewise a general state word with several definitions -- the same open flank.",
});

function normalized(path) {
  return path.split(sep).join("/");
}

function files(repositoryRoot) {
  const found = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else found.push(path);
    }
  };
  const root = resolve(repositoryRoot, MODULES);
  if (existsSync(root)) visit(root);
  return found;
}

/** `story-world/figures` rather than the file: features are folders, not modules. */
export function featureOf(path, repositoryRoot) {
  const relativePath = normalized(path).replace(
    `${normalized(resolve(repositoryRoot, MODULES))}/`,
    "",
  );
  const parts = relativePath.split("/");
  return parts.length > 1 ? `${parts[0]}/${parts[1].replace(/\.\w+$/u, "")}` : parts[0];
}

/** Class names a stylesheet defines. */
export function definedClasses(source) {
  return new Set([...source.matchAll(/\.([a-z][\w-]*)/gu)].map((match) => match[1]));
}

/**
 * Class names a component puts into `className`.
 *
 * Reading the attribute rather than the whole file matters: a bare word like "dashed" appears
 * in plenty of sources as an enum value, and counting those made the first version of this
 * check report noise while missing `.figure-layout`, which hides inside a template literal.
 */
export function classNamesInSource(source) {
  const used = new Set();
  const attribute =
    /className\s*=\s*(?:"([^"]*)"|\{([\s\S]{0,400}?)\}\s*(?:\n|\/?>|[a-zA-Z-]+=))/gu;
  for (const match of source.matchAll(attribute)) {
    for (const word of (match[1] ?? match[2] ?? "").matchAll(/[a-z][\w-]{2,}/gu)) {
      used.add(word[0]);
    }
  }
  return used;
}

/**
 * Properties where a change moves the neighbouring view.
 *
 * The colour or weight of a shared class changes the impression at most. A grid column
 * changes where everything else lies -- that was the fault the places view took when the
 * figures needed a third column.
 */
const LAYOUT_PROPERTIES =
  /grid-template|grid-column|grid-row|position\s*:|inset|top\s*:|left\s*:|right\s*:|bottom\s*:|width\s*:|height\s*:|flex\s*:/u;

/**
 * Base rules of `.name` that set geometry and carry no note above them.
 *
 * Only the unqualified selector counts: that is the shared default every view inherits.
 * A qualified rule like `.figure-workspace .figure-layout` belongs to one view alone.
 */
export function missingGeometryNotes(source, name) {
  return baseRules(source, name)
    .filter((rule) => LAYOUT_PROPERTIES.test(rule.block) && !rule.above.endsWith("*/"))
    .map((rule) => rule.index + 1);
}

function baseRules(source, name) {
  const lines = source.split(NEWLINE);
  const found = [];
  lines.forEach((line, index) => {
    if (line.trimEnd() !== `.${name} {`) return;
    const closing = lines.slice(index).findIndex((entry) => entry.trim() === "}");
    found.push({
      index,
      block: lines.slice(index, index + closing + 1).join(NEWLINE),
      above: (lines[index - 1] ?? "").trim(),
    });
  });
  return found;
}

export function scanSharedFeatureClasses(repositoryRoot) {
  const sources = files(repositoryRoot);
  const stylesheets = sources.filter((path) => path.endsWith(".css"));
  const owners = new Map();
  for (const file of stylesheets) {
    for (const name of definedClasses(readFileSync(file, "utf8"))) {
      if (!owners.has(name)) owners.set(name, featureOf(file, repositoryRoot));
    }
  }

  const users = new Map();
  for (const file of sources.filter(
    (path) => /\.tsx$/u.test(path) && !/\.(?:test|story)\./u.test(path),
  )) {
    const feature = featureOf(file, repositoryRoot);
    for (const name of classNamesInSource(readFileSync(file, "utf8"))) {
      if (!owners.has(name)) continue;
      if (!users.has(name)) users.set(name, new Set());
      users.get(name).add(feature);
    }
  }

  const violations = [];
  const shared = new Set();
  for (const [name, features] of users) {
    if (features.size < 2) continue;
    shared.add(name);
    if (Object.hasOwn(SHARED_FEATURE_CLASSES, name)) continue;
    violations.push(
      `.${name} (from ${owners.get(name)}) is used by ${[...features].sort().join(" and ")} ` +
        "but is not in SHARED_FEATURE_CLASSES. Add it, and say in one sentence who is " +
        "relying on what here.",
    );
  }

  for (const name of Object.keys(SHARED_FEATURE_CLASSES)) {
    if (!shared.has(name)) {
      violations.push(
        `.${name} is in SHARED_FEATURE_CLASSES but is used from one place only now. ` +
          "Remove the entry, so the list keeps meaning something.",
      );
    }
  }

  // The register lives in tools/, the change happens in the stylesheet. Whoever touches a
  // grid column should read there who else depends on it -- not here.
  for (const name of Object.keys(SHARED_FEATURE_CLASSES)) {
    for (const file of stylesheets) {
      for (const line of missingGeometryNotes(readFileSync(file, "utf8"), name)) {
        violations.push(
          `${normalized(file).split("/modules/")[1]}: .${name} sets shared geometry, but ` +
            `above line ${line} there is no note saying which other views carry it. Put a ` +
            "sentence above it.",
        );
      }
    }
  }

  return violations.sort();
}

export function formatSharedFeatureClassReport(violations) {
  return violations.length
    ? ["Shared feature classes:", ...violations.map((line) => `- ${line}`)].join(NEWLINE)
    : "Shared feature classes are all registered.";
}
