import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const NEWLINE = String.fromCharCode(10);

const roots = Object.freeze(["packages/client/src", "apps"]);

/**
 * The breakpoint ladder.
 *
 * Media queries cannot read custom properties, so their numbers have to stay literals -- and
 * therefore appear dozens of times across the tree: 719px alone in 27 files. A token does not
 * help here; a closed list does: it keeps a 733 from turning up beside 719 one day and
 * breaking differently from the rest in a handful of places.
 *
 * Pairs like 719/720 and 1050/1099 are deliberate: `max-width: 719px` and `min-width: 720px`
 * share the same edge.
 */
export const BREAKPOINTS = Object.freeze([359, 480, 640, 719, 720, 820, 900, 1050, 1099]);

/**
 * Exceptions that grew up here, each with its reason.
 *
 * They are not part of the ladder and are not meant to become part of it. The entry records
 * that somebody has seen them -- new numbers outside the ladder still stand out.
 */
export const BREAKPOINT_EXCEPTIONS = Object.freeze({
  380: "ToolbarButton: its own threshold, below which the label gives way in compact mode too",
  399: "WorldGate: the narrowest device class on which the world list would still be two columns",
  520: "Storyboard: width and height of the same threshold, so flat windows break alike",
  760: "NoteEditor: follows the measure of the text, not the window ladder",
});

/** Raw geometry below this is an icon, a hairline or an optical nudge -- not a decision. */
const MEANINGFUL_PX = 24;

function normalized(path) {
  return path.split(sep).join("/");
}

export function discoverStylesheets(repositoryRoot) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && path.endsWith(".css")) files.push(path);
    }
  };
  for (const root of roots) {
    const directory = resolve(repositoryRoot, root);
    if (existsSync(directory)) visit(directory);
  }
  return files.sort((left, right) => normalized(left).localeCompare(normalized(right)));
}

/** Every `calc(…)` in the source, brackets balanced. */
export function calcExpressions(source) {
  const found = [];
  for (
    let start = source.indexOf("calc(");
    start >= 0;
    start = source.indexOf("calc(", start + 1)
  ) {
    let depth = 0;
    let index = start + 4;
    for (; index < source.length; index += 1) {
      if (source[index] === "(") depth += 1;
      else if (source[index] === ")") {
        depth -= 1;
        if (!depth) break;
      }
    }
    found.push(source.slice(start, index + 1));
  }
  return found;
}

/**
 * Two rules, both learned from faults this codebase really had.
 *
 * What is not checked is "the same value in two files". Measured, that gave 30 hits, almost
 * all of them alike by chance -- a menu with a 360px maximum width and a dialog with the same
 * are not making a shared decision. A rule that mostly reports noise gets nobody to look more
 * closely.
 */
export function analyzeLayoutGeometry(source) {
  const violations = [];

  for (const query of source.matchAll(/@media[^{]+/gu)) {
    for (const match of query[0].matchAll(/\b(min|max)-width\s*:\s*(\d+)px/gu)) {
      const value = Number(match[2]);
      if (BREAKPOINTS.includes(value)) continue;
      if (Object.hasOwn(BREAKPOINT_EXCEPTIONS, value)) continue;
      violations.push(
        `${match[1]}-width: ${value}px is not on the breakpoint ladder ` +
          `(${BREAKPOINTS.join(", ")}). Either take an existing edge, or give the new one a ` +
          "reason in BREAKPOINT_EXCEPTIONS.",
      );
    }
  }

  for (const expression of calcExpressions(source)) {
    if (!expression.includes("var(--")) continue;
    const raw = [...expression.matchAll(/(?<![\w-])(\d{2,4})px\b/gu)]
      .map((match) => Number(match[1]))
      .filter((value) => value >= MEANINGFUL_PX);
    if (!raw.length) continue;
    violations.push(
      `calc() mixes named and unnamed geometry (${raw.join("px, ")}px): ` +
        `${expression.replace(/\s+/gu, " ").slice(0, 90)}. ` +
        "A half-named calculation drifts as soon as one of its parts moves.",
    );
  }

  return violations;
}

export function scanLayoutGeometry(repositoryRoot) {
  const violations = [];
  for (const file of discoverStylesheets(repositoryRoot)) {
    for (const message of analyzeLayoutGeometry(readFileSync(file, "utf8"))) {
      violations.push(`${normalized(relative(repositoryRoot, file))}: ${message}`);
    }
  }
  return violations;
}

export function formatLayoutGeometryReport(violations) {
  return violations.length
    ? ["Layout geometry failed:", ...violations.map((line) => `- ${line}`)].join(NEWLINE)
    : "Layout geometry holds.";
}
