// Static popup inventory for the layout audit.
//
// Finds every component under packages/client/src/{app,modules,shared} that renders a popup
// building block. Detection is pattern based (never a list of component names), so a menu added
// tomorrow shows up without touching this file. The audit compares the result with what the
// runtime run actually reached (see tests/audit/support/coverage-map.ts).
//
// The scanner is a small lexer, not a parser: it blanks comments, string literals and template
// text so that a word inside them can never match, then matches patterns on the remaining code.
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {{ component: string, file: string, patterns: string[] }} InventoryItem */

const SOURCE_ROOTS = Object.freeze([
  "packages/client/src/app",
  "packages/client/src/modules",
  "packages/client/src/shared",
]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const EXCLUDED_FILE = /\.(?:test|testSupport|stories)\.[cm]?[jt]sx?$/;
const EXCLUDED_DIRECTORIES = new Set(["__tests__", "node_modules"]);

// JSX elements whose tag name is exactly one of these.
const POPUP_TAGS = new Set([
  "Menu",
  "MenuItem",
  "MenuSubmenu",
  "DropdownMenu",
  "ContextMenu",
  "SelectionMenu",
  "Popover",
  "Sheet",
  "AdaptivePanel",
  "ListboxSelect",
  "CommandPalette",
]);
// JSX elements whose tag name ends in Dialog (ConfirmDialog, SearchDialog, ...).
const DIALOG_TAG = /(?:^|\.)\w*Dialog$/;
const POPUP_ROLES = ["menu", "listbox", "dialog"];

const IDENTIFIER = /[\w$]/;

/**
 * Blanks everything that is not code. Returns two strings of the original length:
 * `code` has comments, strings and template text replaced by spaces; `kept` has only comments
 * replaced, so string values stay readable. `depth[i]` is the brace/paren/bracket depth at i.
 * @param {string} source
 */
function lex(source) {
  const length = source.length;
  const code = source.split("");
  const kept = source.split("");
  const depth = new Array(length).fill(0);
  const blank = (text, from, to) => {
    for (let i = from; i < to; i += 1) {
      if (text[i] !== "\n") text[i] = " ";
    }
  };
  /** @type {Array<"template" | "brace">} */
  const stack = [];
  let level = 0;
  let index = 0;

  const readTemplate = () => {
    // index is just after a backtick or just after the `}` closing a ${ ... }
    const start = index;
    while (index < length) {
      const character = source[index];
      if (character === "\\") {
        index += 2;
      } else if (character === "`") {
        blank(code, start, index);
        index += 1;
        return;
      } else if (character === "$" && source[index + 1] === "{") {
        blank(code, start, index);
        index += 2;
        stack.push("template");
        level += 1;
        return;
      } else {
        index += 1;
      }
    }
    blank(code, start, length);
  };

  while (index < length) {
    const character = source[index];
    depth[index] = level;
    if (character === "/" && source[index + 1] === "/") {
      const end = source.indexOf("\n", index);
      const stop = end < 0 ? length : end;
      blank(code, index, stop);
      blank(kept, index, stop);
      index = stop;
    } else if (character === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end < 0 ? length : end + 2;
      blank(code, index, stop);
      blank(kept, index, stop);
      index = stop;
    } else if (character === '"' || character === "'") {
      // A quote that never closes on its own line is JSX text (an apostrophe), not a string.
      let end = index + 1;
      while (end < length && source[end] !== character && source[end] !== "\n") {
        end += source[end] === "\\" ? 2 : 1;
      }
      if (source[end] === character) {
        blank(code, index + 1, end);
        index = end + 1;
      } else {
        index += 1;
      }
    } else if (character === "`") {
      index += 1;
      readTemplate();
    } else if (character === "{" || character === "(" || character === "[") {
      stack.push("brace");
      level += 1;
      index += 1;
    } else if (character === "}" || character === ")" || character === "]") {
      const top = stack.pop();
      level = Math.max(0, level - 1);
      index += 1;
      if (top === "template" && character === "}") readTemplate();
    } else {
      index += 1;
    }
  }
  return { code: code.join(""), kept: kept.join(""), depth };
}

/** Index of the bracket matching the one at `open`, in already blanked code. */
function matchingBracket(code, open) {
  const pairs = { "{": "}", "(": ")", "[": "]" };
  let level = 0;
  for (let i = open; i < code.length; i += 1) {
    if (pairs[code[i]]) level += 1;
    else if (code[i] === "}" || code[i] === ")" || code[i] === "]") {
      level -= 1;
      if (level === 0) return i;
    }
  }
  return code.length - 1;
}

/**
 * Top-level declarations in source order: { name, start }.
 * @param {string} code
 * @param {number[]} depth
 */
function topLevelDeclarations(code, depth) {
  const found = [];
  const patterns = [
    /(?:^|[\s;}])(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?\s*[(<]/g,
    /(?:^|[\s;}])(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=:]/g,
    /(?:^|[\s;}])(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const start = match.index + match[0].search(/\S/);
      if ((depth[start] ?? 0) !== 0) continue;
      found.push({ name: match[1] ?? "default", start });
    }
  }
  return found.sort((left, right) => left.start - right.start);
}

/**
 * @param {string} source
 * @returns {Array<{ component: string, pattern: string }>}
 */
export function scanSource(source) {
  const { code, kept, depth } = lex(source);
  /** @type {Array<{ index: number, pattern: string }>} */
  const hits = [];

  for (const match of code.matchAll(/<([A-Za-z_$][\w$.]*)(?=[\s/>])/g)) {
    const before = code[match.index - 1];
    if (before !== undefined && (IDENTIFIER.test(before) || before === ")" || before === "]")) {
      continue; // generic type argument such as useState<Dialog>, not a JSX element
    }
    const tag = match[1];
    if (POPUP_TAGS.has(tag) || DIALOG_TAG.test(tag))
      hits.push({ index: match.index, pattern: tag });
  }

  for (const match of code.matchAll(/(?<![\w$])createPortal\s*\(/g)) {
    hits.push({ index: match.index, pattern: "createPortal" });
  }

  for (const match of code.matchAll(/(?<![\w$])role\s*=\s*([{"'])/g)) {
    const valueStart = match.index + match[0].length - 1;
    let expression;
    if (match[1] === "{") {
      expression = kept.slice(valueStart, matchingBracket(code, valueStart) + 1);
    } else {
      const quote = kept[valueStart];
      expression = kept.slice(valueStart, kept.indexOf(quote, valueStart + 1) + 1);
    }
    for (const role of POPUP_ROLES) {
      if (new RegExp(`["'\`]${role}["'\`]`).test(expression)) {
        hits.push({ index: match.index, pattern: `role=${role}` });
      }
    }
  }

  const declarations = topLevelDeclarations(code, depth);
  return hits.map(({ index, pattern }) => {
    let owner = "(module)";
    for (const declaration of declarations) {
      if (declaration.start > index) break;
      owner = declaration.name;
    }
    return { component: owner, pattern };
  });
}

function normalized(path) {
  return path.split(sep).join("/");
}

function discoverFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) files.push(...discoverFiles(path));
    } else if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(extname(entry.name)) &&
      !EXCLUDED_FILE.test(entry.name)
    ) {
      files.push(path);
    }
  }
  return files;
}

const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

/**
 * @param {string} [rootDir]
 * @returns {InventoryItem[]}
 */
export function buildInventory(rootDir = process.cwd()) {
  const root = resolve(rootDir);
  /** @type {Map<string, { component: string, file: string, patterns: Set<string> }>} */
  const items = new Map();
  for (const sourceRoot of SOURCE_ROOTS) {
    let files;
    try {
      files = discoverFiles(join(root, sourceRoot));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    for (const path of files) {
      const file = normalized(relative(root, path));
      for (const { component, pattern } of scanSource(readFileSync(path, "utf8"))) {
        const key = `${file}\0${component}`;
        if (!items.has(key)) items.set(key, { component, file, patterns: new Set() });
        items.get(key).patterns.add(pattern);
      }
    }
  }
  return [...items.values()]
    .map(({ component, file, patterns }) => ({
      component,
      file,
      patterns: [...patterns].sort(compare),
    }))
    .sort(
      (left, right) => compare(left.file, right.file) || compare(left.component, right.component),
    );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(buildInventory(), null, 2)}\n`);
}
