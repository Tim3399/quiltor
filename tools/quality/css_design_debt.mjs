import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";

export const cssDesignDebtNativeTypes = Object.freeze(["button", "input", "select", "textarea"]);
export const cssDesignOwnerClassesByComponent = Object.freeze({
  AdaptivePanel: Object.freeze(["adaptive-panel"]),
  Alert: Object.freeze(["design-alert"]),
  Button: Object.freeze(["ui-button"]),
  Checkbox: Object.freeze(["ui-checkbox"]),
  Chip: Object.freeze(["design-chip", "design-chip-item", "design-chip-list"]),
  CommandPalette: Object.freeze(["ui-command-palette"]),
  ConfirmDialog: Object.freeze(["ui-confirm-dialog"]),
  Dialog: Object.freeze(["ui-dialog", "ui-dialog-backdrop"]),
  Disclosure: Object.freeze(["design-disclosure"]),
  DropdownMenu: Object.freeze(["ui-dropdown-menu"]),
  EmptyState: Object.freeze(["empty-state-component"]),
  Field: Object.freeze(["ui-field"]),
  IconButton: Object.freeze(["icon-button"]),
  ListboxSelect: Object.freeze(["ui-select-control", "ui-select-listbox"]),
  Menu: Object.freeze(["ui-menu"]),
  PageState: Object.freeze(["page-state"]),
  Popover: Object.freeze(["ui-popover", "ui-popover-sheet"]),
  ProgressBar: Object.freeze(["progress-component"]),
  SaveStatus: Object.freeze(["save-status-component"]),
  ScrollArea: Object.freeze(["scroll-area"]),
  SegmentedControl: Object.freeze(["ui-segmented"]),
  Select: Object.freeze(["ui-select"]),
  SelectableRow: Object.freeze(["selectable-row"]),
  SelectionCard: Object.freeze(["selection-card"]),
  SelectionMenu: Object.freeze(["ui-selection-menu"]),
  Sheet: Object.freeze([
    "ui-sheet",
    "ui-sheet-backdrop",
    "utility-sheet",
    "utility-sheet-content",
  ]),
  SidePanel: Object.freeze(["side-panel"]),
  Tabs: Object.freeze(["design-tabs"]),
  TextArea: Object.freeze(["ui-field"]),
  TextField: Object.freeze(["ui-text-field"]),
  Toast: Object.freeze(["design-toast", "design-toast-region"]),
  ToolbarButton: Object.freeze(["ui-toolbar-button"]),
  UndoRedoControls: Object.freeze(["undo-redo-controls"]),
  WorkspaceToolbar: Object.freeze(["workspace-toolbar"]),
});

const currentDesignOwnerClasses = [
  ...new Set(Object.values(cssDesignOwnerClassesByComponent).flat()),
];

export const cssDesignDebtOwnerClasses = Object.freeze([
  // Product styles may add feature classes to a public component, but must
  // never reach into these colocated implementation selectors.
  ...currentDesignOwnerClasses,

  // Retired product recipes remain protected so they cannot return under the
  // guise of a feature-local component.
  "secondary-action",
  "danger-text",
  "empty-message",
  "error-box",
  "toast",
  "fatal-state",
  "loading-state",
  "loading-mark",
  "ui-sidebar",
  "ui-inspector",
  "binder",
  "inspector",
  "panel-heading",
  "panel-tabs",
  "panel-body",
  "empty-inspector",
  "ui-toolbar",
  "ui-toolbar__group",
  "context-bar",
  "context-title",
  "context-tools",
  "tool-group",
  "stats",
]);
export const cssDesignDebtBaselineUpdateCommand =
  "node tools/quality/check_css_design_debt.mjs --write-baseline";

const schemaVersion = 1;
const scope = Object.freeze({
  roots: Object.freeze([
    "packages/client/src/app",
    "packages/client/src/modules",
    "packages/client/src/shared",
  ]),
  extensions: Object.freeze([".css"]),
  excluded: Object.freeze([
    "**/*.test.css",
    "**/*.spec.css",
    "**/*.testSupport.css",
    "**/*.story.css",
    "**/*.stories.css",
    "**/{test,tests,__tests__}/**",
  ]),
});
const categoryManifest = Object.freeze({
  nativeTypeSelectors: cssDesignDebtNativeTypes,
  designOwnerOverrides: cssDesignDebtOwnerClasses,
});
const selectorListPseudoClasses = new Set([
  "global",
  "has",
  "host",
  "host-context",
  "is",
  "local",
  "not",
  "slotted",
  "where",
]);
const groupingAtRules = new Set([
  "container",
  "document",
  "layer",
  "media",
  "scope",
  "starting-style",
  "supports",
  "-moz-document",
]);
const declarationAtRules = new Set([
  "annotation",
  "character-variant",
  "color-profile",
  "counter-style",
  "font-face",
  "font-feature-values",
  "font-palette-values",
  "ornaments",
  "page",
  "property",
  "styleset",
  "stylistic",
  "swash",
]);

function normalizedPath(path) {
  return path.split(sep).join("/");
}

function emptyCounts(names) {
  return Object.fromEntries(names.map((name) => [name, 0]));
}

function compactCounts(counts, names) {
  return Object.fromEntries(
    names.filter((name) => counts[name] > 0).map((name) => [name, counts[name]]),
  );
}

function compactDebt(debt) {
  const nativeTypeSelectors = compactCounts(debt.nativeTypeSelectors, cssDesignDebtNativeTypes);
  const designOwnerOverrides = compactCounts(debt.designOwnerOverrides, cssDesignDebtOwnerClasses);
  return {
    ...(Object.keys(nativeTypeSelectors).length ? { nativeTypeSelectors } : {}),
    ...(Object.keys(designOwnerOverrides).length ? { designOwnerOverrides } : {}),
  };
}

function hasDebt(debt) {
  return (
    Object.keys(debt.nativeTypeSelectors || {}).length > 0 ||
    Object.keys(debt.designOwnerOverrides || {}).length > 0
  );
}

function scannerError(state, message, index = state.index) {
  const prefix = state.source.slice(0, index);
  const line = prefix.split("\n").length;
  const lastNewline = prefix.lastIndexOf("\n");
  const column = index - lastNewline;
  throw new Error(
    `CSS design-debt scanner could not parse ${state.file}:${line}:${column}: ${message}`,
  );
}

function isWhitespace(character) {
  return /\s/u.test(character);
}

function isHexDigit(character) {
  return character !== undefined && /[\dA-Fa-f]/u.test(character);
}

function isNameStart(character) {
  return (
    character !== undefined && (/[A-Z_a-z]/u.test(character) || character.codePointAt(0) >= 0x80)
  );
}

function isNameCharacter(character) {
  return isNameStart(character) || /[\d-]/u.test(character || "");
}

function designOwnerClass(identifier) {
  return cssDesignDebtOwnerClasses.find(
    (owner) =>
      identifier === owner ||
      identifier.startsWith(`${owner}--`) ||
      identifier.startsWith(`${owner}__`),
  );
}

function skipComment(state, index) {
  const end = state.source.indexOf("*/", index + 2);
  if (end === -1) scannerError(state, "unterminated comment", index);
  return end + 2;
}

function skipString(state, index) {
  const quote = state.source[index];
  let cursor = index + 1;
  while (cursor < state.source.length) {
    const character = state.source[cursor];
    if (character === quote) return cursor + 1;
    if (character === "\n" || character === "\r" || character === "\f") {
      scannerError(state, "unescaped newline in string", cursor);
    }
    if (character === "\\") {
      if (cursor + 1 >= state.source.length) {
        scannerError(state, "unterminated escape in string", cursor);
      }
      if (state.source[cursor + 1] === "\r" && state.source[cursor + 2] === "\n") {
        cursor += 3;
      } else {
        cursor += 2;
      }
    } else {
      cursor += 1;
    }
  }
  scannerError(state, "unterminated string", index);
}

function consumeEscape(state, index) {
  if (state.source[index] !== "\\") return undefined;
  const next = state.source[index + 1];
  if (next === undefined || next === "\n" || next === "\r" || next === "\f") {
    scannerError(state, "invalid CSS escape", index);
  }
  if (!isHexDigit(next)) return { value: next, end: index + 2 };

  let end = index + 1;
  while (end < state.source.length && end < index + 7 && isHexDigit(state.source[end])) {
    end += 1;
  }
  const codePoint = Number.parseInt(state.source.slice(index + 1, end), 16);
  if (state.source[end] === "\r" && state.source[end + 1] === "\n") end += 2;
  else if (isWhitespace(state.source[end])) end += 1;
  const value =
    codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ? "�"
      : String.fromCodePoint(codePoint);
  return { value, end };
}

function wouldStartIdentifier(state, index) {
  const character = state.source[index];
  if (isNameStart(character) || character === "\\") return true;
  if (character !== "-") return false;
  const next = state.source[index + 1];
  return isNameStart(next) || next === "-" || next === "\\";
}

function readIdentifier(state, index) {
  if (!wouldStartIdentifier(state, index)) return undefined;
  let cursor = index;
  let value = "";
  while (cursor < state.source.length) {
    const character = state.source[cursor];
    if (isNameCharacter(character)) {
      value += character;
      cursor += 1;
      continue;
    }
    if (character === "\\") {
      const escaped = consumeEscape(state, cursor);
      value += escaped.value;
      cursor = escaped.end;
      continue;
    }
    break;
  }
  return { value, end: cursor };
}

function skipTrivia(state) {
  while (state.index < state.source.length) {
    if (isWhitespace(state.source[state.index])) {
      state.index += 1;
    } else if (state.source.startsWith("/*", state.index)) {
      state.index = skipComment(state, state.index);
    } else {
      return;
    }
  }
}

function isTriviaOnly(state, start, end) {
  let cursor = start;
  while (cursor < end) {
    if (isWhitespace(state.source[cursor])) {
      cursor += 1;
    } else if (state.source.startsWith("/*", cursor)) {
      cursor = skipComment(state, cursor);
    } else {
      return false;
    }
  }
  return true;
}

function skipTriviaAt(state, start, end) {
  let cursor = start;
  while (cursor < end) {
    if (isWhitespace(state.source[cursor])) {
      cursor += 1;
    } else if (state.source.startsWith("/*", cursor)) {
      cursor = skipComment(state, cursor);
      if (cursor > end) scannerError(state, "comment crosses a structural boundary", start);
    } else {
      break;
    }
  }
  return cursor;
}

function consumeUntil(state, stopCharacters) {
  const start = state.index;
  const stack = [];
  while (state.index < state.source.length) {
    const character = state.source[state.index];
    if (state.source.startsWith("/*", state.index)) {
      state.index = skipComment(state, state.index);
      continue;
    }
    if (character === '"' || character === "'") {
      state.index = skipString(state, state.index);
      continue;
    }
    if (character === "\\") {
      state.index = consumeEscape(state, state.index).end;
      continue;
    }
    if (character === "(" || character === "[") {
      stack.push(character === "(" ? ")" : "]");
      state.index += 1;
      continue;
    }
    if (character === ")" || character === "]") {
      if (stack.at(-1) !== character) {
        scannerError(state, `unexpected ${character}`);
      }
      stack.pop();
      state.index += 1;
      continue;
    }
    if (stack.length === 0 && stopCharacters.has(character)) {
      return { start, end: state.index, delimiter: character };
    }
    state.index += 1;
  }
  if (stack.length) scannerError(state, `unterminated ${stack.at(-1) === ")" ? "(" : "["}`);
  return { start, end: state.index, delimiter: undefined };
}

function findMatchingBlock(state, openIndex, opening, closing) {
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const stack = [closing];
  let cursor = openIndex + 1;
  while (cursor < state.source.length) {
    const character = state.source[cursor];
    if (state.source.startsWith("/*", cursor)) {
      cursor = skipComment(state, cursor);
      continue;
    }
    if (character === '"' || character === "'") {
      cursor = skipString(state, cursor);
      continue;
    }
    if (character === "\\") {
      cursor = consumeEscape(state, cursor).end;
      continue;
    }
    if (Object.hasOwn(pairs, character)) {
      stack.push(pairs[character]);
      cursor += 1;
      continue;
    }
    if (character === ")" || character === "]" || character === "}") {
      if (stack.at(-1) !== character) scannerError(state, `unexpected ${character}`, cursor);
      stack.pop();
      if (stack.length === 0) return { close: cursor, end: cursor + 1 };
    }
    cursor += 1;
  }
  scannerError(state, `unterminated ${opening}`, openIndex);
}

function selectorBranches(state, start, end) {
  const branches = [];
  let branchStart = start;
  const stack = [];
  let cursor = start;
  while (cursor < end) {
    const character = state.source[cursor];
    if (state.source.startsWith("/*", cursor)) {
      cursor = skipComment(state, cursor);
      continue;
    }
    if (character === '"' || character === "'") {
      cursor = skipString(state, cursor);
      continue;
    }
    if (character === "\\") {
      cursor = consumeEscape(state, cursor).end;
      continue;
    }
    if (character === "(" || character === "[") {
      stack.push(character === "(" ? ")" : "]");
    } else if (character === ")" || character === "]") {
      if (stack.at(-1) !== character) scannerError(state, `unexpected ${character}`, cursor);
      stack.pop();
    } else if (character === "{" || character === "}") {
      scannerError(state, `unexpected ${character} in selector`, cursor);
    } else if (character === "," && stack.length === 0) {
      if (isTriviaOnly(state, branchStart, cursor)) {
        scannerError(state, "empty selector in comma list", cursor);
      }
      branches.push([branchStart, cursor]);
      branchStart = cursor + 1;
    }
    cursor += 1;
  }
  if (stack.length) scannerError(state, `unterminated ${stack.at(-1) === ")" ? "(" : "["}`, end);
  if (isTriviaOnly(state, branchStart, end)) scannerError(state, "empty selector", branchStart);
  branches.push([branchStart, end]);
  return branches;
}

function collectSelectorTokens(state, start, end, found) {
  let cursor = start;
  while (cursor < end) {
    const character = state.source[cursor];
    if (isWhitespace(character)) {
      cursor += 1;
      continue;
    }
    if (state.source.startsWith("/*", cursor)) {
      cursor = skipComment(state, cursor);
      continue;
    }
    if (character === '"' || character === "'") {
      cursor = skipString(state, cursor);
      continue;
    }
    if (character === "[") {
      cursor = findMatchingBlock(state, cursor, "[", "]").end;
      continue;
    }
    if (character === ".") {
      const identifier = readIdentifier(state, cursor + 1);
      if (!identifier) scannerError(state, "class selector is missing an identifier", cursor);
      const owner = designOwnerClass(identifier.value);
      if (owner) found.designOwnerOverrides.add(owner);
      cursor = identifier.end;
      continue;
    }
    if (character === "#") {
      const identifier = readIdentifier(state, cursor + 1);
      if (!identifier) scannerError(state, "ID selector is missing an identifier", cursor);
      cursor = identifier.end;
      continue;
    }
    if (character === ":") {
      cursor += state.source[cursor + 1] === ":" ? 2 : 1;
      const identifier = readIdentifier(state, cursor);
      if (!identifier) scannerError(state, "pseudo selector is missing an identifier", cursor);
      cursor = identifier.end;
      if (state.source[cursor] === "(") {
        const block = findMatchingBlock(state, cursor, "(", ")");
        if (selectorListPseudoClasses.has(identifier.value.toLowerCase())) {
          for (const [branchStart, branchEnd] of selectorBranches(state, cursor + 1, block.close)) {
            collectSelectorTokens(state, branchStart, branchEnd, found);
          }
        }
        cursor = block.end;
      }
      continue;
    }
    if (wouldStartIdentifier(state, cursor)) {
      const identifier = readIdentifier(state, cursor);
      const name = identifier.value.toLowerCase();
      const namespacePrefix =
        state.source[identifier.end] === "|" && state.source[identifier.end + 1] !== "|";
      if (!namespacePrefix && cssDesignDebtNativeTypes.includes(name)) {
        found.nativeTypeSelectors.add(name);
      }
      cursor = identifier.end;
      continue;
    }
    if (character === "(" || character === ")" || character === "]") {
      scannerError(state, `unexpected ${character} in selector`, cursor);
    }
    if (character === "\\") {
      scannerError(state, "escaped selector token does not form an identifier", cursor);
    }
    cursor += 1;
  }
}

function analyzeSelectorList(state, start, end, debt) {
  for (const [branchStart, branchEnd] of selectorBranches(state, start, end)) {
    const found = {
      nativeTypeSelectors: new Set(),
      designOwnerOverrides: new Set(),
    };
    collectSelectorTokens(state, branchStart, branchEnd, found);
    for (const name of found.nativeTypeSelectors) debt.nativeTypeSelectors[name] += 1;
    for (const name of found.designOwnerOverrides) debt.designOwnerOverrides[name] += 1;
  }
}

function declarationColon(state, start, end) {
  const stack = [];
  let cursor = start;
  while (cursor < end) {
    const character = state.source[cursor];
    if (state.source.startsWith("/*", cursor)) {
      cursor = skipComment(state, cursor);
      continue;
    }
    if (character === '"' || character === "'") {
      cursor = skipString(state, cursor);
      continue;
    }
    if (character === "\\") {
      cursor = consumeEscape(state, cursor).end;
      continue;
    }
    if (character === "(" || character === "[") {
      stack.push(character === "(" ? ")" : "]");
    } else if (character === ")" || character === "]") {
      if (stack.at(-1) !== character) scannerError(state, `unexpected ${character}`, cursor);
      stack.pop();
    } else if (character === ":" && stack.length === 0) {
      return cursor;
    }
    cursor += 1;
  }
  if (stack.length) scannerError(state, `unterminated ${stack.at(-1) === ")" ? "(" : "["}`, end);
  return undefined;
}

function validateDeclaration(state, start, end) {
  if (isTriviaOnly(state, start, end)) return;
  const colon = declarationColon(state, start, end);
  if (colon === undefined) scannerError(state, "style-block statement is not a declaration", start);
  const cursor = skipTriviaAt(state, start, colon);
  const property = readIdentifier(state, cursor);
  if (!property || skipTriviaAt(state, property.end, colon) !== colon) {
    scannerError(state, "invalid declaration property", start);
  }
}

function customPropertyBeforeBlock(state, start, end) {
  const colon = declarationColon(state, start, end);
  if (colon === undefined) return false;
  const cursor = skipTriviaAt(state, start, colon);
  const property = readIdentifier(state, cursor);
  return Boolean(
    property?.value.startsWith("--") && skipTriviaAt(state, property.end, colon) === colon,
  );
}

function skipRawBlock(state) {
  const block = findMatchingBlock(state, state.index - 1, "{", "}");
  state.index = block.end;
}

function parseAtRule(state, context) {
  const atIndex = state.index;
  state.index += 1;
  const identifier = readIdentifier(state, state.index);
  if (!identifier) scannerError(state, "at-rule is missing a name", atIndex);
  const name = identifier.value.toLowerCase();
  state.index = identifier.end;
  const prelude = consumeUntil(state, new Set([";", "{", "}"]));
  if (prelude.delimiter === ";") {
    state.index += 1;
    return;
  }
  if (prelude.delimiter !== "{") {
    scannerError(state, `unterminated @${name} rule`, atIndex);
  }
  state.index += 1;

  if (name === "keyframes" || name.endsWith("-keyframes")) {
    skipRawBlock(state);
    return;
  }
  if (name === "nest") {
    if (context !== "style")
      scannerError(state, "@nest is only valid inside a style rule", atIndex);
    analyzeSelectorList(state, prelude.start, prelude.end, state.debt);
    parseStyleBlock(state);
    return;
  }
  if (groupingAtRules.has(name)) {
    if (context === "rules") parseRuleList(state, true);
    else parseStyleBlock(state);
    return;
  }
  if (declarationAtRules.has(name)) {
    skipRawBlock(state);
    return;
  }
  scannerError(state, `unsupported block at-rule @${name}`, atIndex);
}

function parseQualifiedRule(state) {
  const selector = consumeUntil(state, new Set([";", "{", "}"]));
  if (selector.delimiter !== "{") {
    scannerError(state, "qualified rule is missing a block", selector.start);
  }
  analyzeSelectorList(state, selector.start, selector.end, state.debt);
  state.index += 1;
  parseStyleBlock(state);
}

function parseStyleBlock(state) {
  while (true) {
    skipTrivia(state);
    if (state.index >= state.source.length) scannerError(state, "unterminated style block");
    if (state.source[state.index] === "}") {
      state.index += 1;
      return;
    }
    if (state.source[state.index] === "@") {
      parseAtRule(state, "style");
      continue;
    }

    const statement = consumeUntil(state, new Set([";", "{", "}"]));
    if (statement.delimiter === ";") {
      validateDeclaration(state, statement.start, statement.end);
      state.index += 1;
      continue;
    }
    if (statement.delimiter === "}") {
      validateDeclaration(state, statement.start, statement.end);
      state.index += 1;
      return;
    }
    if (statement.delimiter !== "{") scannerError(state, "unterminated style block statement");
    state.index += 1;
    if (customPropertyBeforeBlock(state, statement.start, statement.end)) {
      skipRawBlock(state);
    } else {
      analyzeSelectorList(state, statement.start, statement.end, state.debt);
      parseStyleBlock(state);
    }
  }
}

function parseRuleList(state, expectClosingBrace) {
  while (true) {
    skipTrivia(state);
    if (state.index >= state.source.length) {
      if (expectClosingBrace) scannerError(state, "unterminated at-rule block");
      return;
    }
    if (state.source[state.index] === "}") {
      if (!expectClosingBrace) scannerError(state, "unexpected }");
      state.index += 1;
      return;
    }
    if (state.source[state.index] === "@") parseAtRule(state, "rules");
    else parseQualifiedRule(state);
  }
}

/**
 * Count selector-list branches that directly reference native controls or design-owner classes.
 * A target is counted at most once per comma-separated selector branch.
 */
export function analyzeCssDesignDebtSource({ file, source }) {
  const debt = {
    nativeTypeSelectors: emptyCounts(cssDesignDebtNativeTypes),
    designOwnerOverrides: emptyCounts(cssDesignDebtOwnerClasses),
  };
  const state = { file, source, index: 0, debt };
  parseRuleList(state, false);
  return compactDebt(debt);
}

/** True only for productive CSS files; test, support, and story styles are excluded. */
export function isCssDesignDebtSourceFile(file) {
  const path = normalizedPath(file);
  if (!scope.extensions.includes(extname(path).toLowerCase())) return false;
  const scopedPath =
    /(?:^|\/)packages\/client\/src\/(?:app|modules|shared)\/(.*)$/u.exec(path)?.[1] || path;
  const segments = scopedPath.split("/");
  if (segments.some((segment) => ["test", "tests", "__tests__"].includes(segment.toLowerCase()))) {
    return false;
  }
  return !/\.(?:test|spec|testSupport|story|stories)\.css$/iu.test(segments.at(-1));
}

export function discoverCssDesignDebtFiles(repositoryRoot) {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && isCssDesignDebtSourceFile(path)) files.push(path);
    }
  }
  for (const root of scope.roots) {
    const directory = resolve(repositoryRoot, root);
    if (!existsSync(directory)) throw new Error(`CSS design-debt scope is missing: ${root}`);
    visit(directory);
  }
  return files.sort((left, right) => normalizedPath(left).localeCompare(normalizedPath(right)));
}

export function createCssDesignDebtManifest(files) {
  const normalizedFiles = {};
  for (const file of Object.keys(files).sort()) {
    const debt = compactDebt({
      nativeTypeSelectors: {
        ...emptyCounts(cssDesignDebtNativeTypes),
        ...(files[file].nativeTypeSelectors || {}),
      },
      designOwnerOverrides: {
        ...emptyCounts(cssDesignDebtOwnerClasses),
        ...(files[file].designOwnerOverrides || {}),
      },
    });
    if (hasDebt(debt)) normalizedFiles[normalizedPath(file)] = debt;
  }
  return {
    schemaVersion,
    generatedBy: cssDesignDebtBaselineUpdateCommand,
    scope: {
      roots: [...scope.roots],
      extensions: [...scope.extensions],
      excluded: [...scope.excluded],
    },
    categories: {
      nativeTypeSelectors: [...cssDesignDebtNativeTypes],
      designOwnerOverrides: [...cssDesignDebtOwnerClasses],
    },
    countingUnit: "comma-separated selector branches containing the target (once per target)",
    files: normalizedFiles,
  };
}

export function scanCssDesignDebt(repositoryRoot) {
  const files = {};
  for (const file of discoverCssDesignDebtFiles(repositoryRoot)) {
    const path = normalizedPath(relative(repositoryRoot, file));
    const debt = analyzeCssDesignDebtSource({ file: path, source: readFileSync(file, "utf8") });
    if (hasDebt(debt)) files[path] = debt;
  }
  return createCssDesignDebtManifest(files);
}

function sameArray(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validate strictly so malformed allowances cannot silently weaken the ratchet. */
export function cssDesignDebtManifestViolations(manifest) {
  const violations = [];
  if (!plainObject(manifest)) return ["manifest must be a JSON object"];
  if (manifest.schemaVersion !== schemaVersion)
    violations.push(`schemaVersion must be ${schemaVersion}`);
  if (manifest.generatedBy !== cssDesignDebtBaselineUpdateCommand) {
    violations.push(`generatedBy must be ${JSON.stringify(cssDesignDebtBaselineUpdateCommand)}`);
  }
  for (const key of ["roots", "extensions", "excluded"]) {
    if (!sameArray(manifest.scope?.[key], scope[key])) {
      violations.push(`scope.${key} does not match the enforced scanner scope`);
    }
  }
  for (const [category, names] of Object.entries(categoryManifest)) {
    if (!sameArray(manifest.categories?.[category], names)) {
      violations.push(`categories.${category} does not match the enforced debt categories`);
    }
  }
  if (
    manifest.countingUnit !==
    "comma-separated selector branches containing the target (once per target)"
  ) {
    violations.push("countingUnit does not match the enforced scanner semantics");
  }
  if (!plainObject(manifest.files)) {
    violations.push("files must be an object");
    return violations;
  }

  const fileNames = Object.keys(manifest.files);
  if (!sameArray(fileNames, [...fileNames].sort())) violations.push("files must be sorted by path");
  for (const file of fileNames) {
    const debt = manifest.files[file];
    if (file.includes("\\") || !scope.roots.some((root) => file.startsWith(`${root}/`))) {
      violations.push(`${file}: path must be normalized and stay inside the scanner scope`);
    }
    if (!isCssDesignDebtSourceFile(file)) {
      violations.push(`${file}: baseline entries must be productive CSS files`);
    }
    if (!plainObject(debt)) {
      violations.push(`${file}: debt entry must be an object`);
      continue;
    }
    const unknownCategories = Object.keys(debt).filter(
      (category) => !Object.hasOwn(categoryManifest, category),
    );
    if (unknownCategories.length) {
      violations.push(`${file}: unknown debt categories ${unknownCategories.join(", ")}`);
    }
    let entries = 0;
    for (const [category, names] of Object.entries(categoryManifest)) {
      const counts = debt[category];
      if (counts === undefined) continue;
      if (!plainObject(counts)) {
        violations.push(`${file}: ${category} must be an object`);
        continue;
      }
      for (const [name, count] of Object.entries(counts)) {
        entries += 1;
        if (!names.includes(name)) violations.push(`${file}: unknown ${category} item ${name}`);
        if (!Number.isInteger(count) || count <= 0) {
          violations.push(`${file}: ${category}.${name} must be a positive integer`);
        }
      }
    }
    if (entries === 0)
      violations.push(`${file}: debt-free files must not be stored in the baseline`);
  }
  return violations;
}

export function parseCssDesignDebtManifest(source) {
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch (error) {
    throw new Error(`CSS design-debt baseline is not valid JSON: ${error.message}`);
  }
  const violations = cssDesignDebtManifestViolations(manifest);
  if (violations.length) {
    throw new Error(`Invalid CSS design-debt baseline:\n${violations.join("\n")}`);
  }
  return manifest;
}

/** Serialize deterministically in the repository's Biome-compatible JSON layout. */
export function serializeCssDesignDebtManifest(manifest) {
  const violations = cssDesignDebtManifestViolations(manifest);
  if (violations.length) {
    throw new Error(`Invalid CSS design-debt manifest:\n${violations.join("\n")}`);
  }
  const lines = JSON.stringify(manifest, null, 2).split("\n");
  const formatted = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opening = /^(\s*)("(?:\\.|[^"\\])+"):\s*\[$/u.exec(lines[index]);
    if (!opening) {
      formatted.push(lines[index]);
      continue;
    }
    let closing = index + 1;
    while (closing < lines.length && !new RegExp(`^${opening[1]}\\][,]?$`).test(lines[closing])) {
      closing += 1;
    }
    if (closing >= lines.length) {
      formatted.push(lines[index]);
      continue;
    }
    const arrayLines = lines.slice(index, closing + 1);
    arrayLines[arrayLines.length - 1] = arrayLines.at(-1).replace(/,$/u, "");
    const values = JSON.parse(arrayLines.join("\n").slice(lines[index].indexOf("[")));
    const comma = lines[closing].trimEnd().endsWith(",") ? "," : "";
    const inline = `${opening[1]}${opening[2]}: [${values
      .map((value) => JSON.stringify(value))
      .join(", ")}]${comma}`;
    if (inline.length > 100) formatted.push(...lines.slice(index, closing + 1));
    else formatted.push(inline);
    index = closing;
  }
  return `${formatted.join("\n")}\n`;
}

function countFor(manifest, file, category, name) {
  return manifest.files[file]?.[category]?.[name] || 0;
}

/** Compare exact per-file ceilings. Reductions also fail until explicitly ratcheted down. */
export function compareCssDesignDebt({ baseline, current }) {
  for (const [label, manifest] of [
    ["baseline", baseline],
    ["current inventory", current],
  ]) {
    const violations = cssDesignDebtManifestViolations(manifest);
    if (violations.length) throw new Error(`Invalid ${label}:\n${violations.join("\n")}`);
  }

  const increases = [];
  const reductions = [];
  const files = [
    ...new Set([...Object.keys(baseline.files), ...Object.keys(current.files)]),
  ].sort();
  for (const file of files) {
    for (const [category, names] of Object.entries(categoryManifest)) {
      for (const name of names) {
        const allowed = countFor(baseline, file, category, name);
        const actual = countFor(current, file, category, name);
        if (actual === allowed) continue;
        const change = {
          file,
          category,
          name,
          allowed,
          actual,
          newFile: !Object.hasOwn(baseline.files, file),
        };
        (actual > allowed ? increases : reductions).push(change);
      }
    }
  }
  return {
    ok: increases.length === 0 && reductions.length === 0,
    increases,
    reductions,
  };
}

function debtLabel(change) {
  return change.category === "nativeTypeSelectors"
    ? `nativer Type-Selektor ${change.name}`
    : `direkter Design-Owner-Override .${change.name}`;
}

export function formatCssDesignDebtReport(result) {
  if (result.ok) return "CSS design debt matches the checked-in baseline.";
  const lines = ["CSS design-debt ratchet failed."];
  if (result.increases.length) {
    lines.push("", "Neue oder erhöhte CSS-Design-Debt:");
    for (const change of result.increases) {
      const newFile = change.newFile ? " (neue Datei mit Debt)" : "";
      lines.push(
        `- [Neue CSS-Design-Debt] ${change.file}: ${debtLabel(change)} ${change.allowed} -> ${change.actual}${newFile}`,
      );
    }
  }
  if (result.reductions.length) {
    lines.push("", "CSS-Debt wurde reduziert; die niedrigere Obergrenze muss eingecheckt werden:");
    for (const change of result.reductions) {
      lines.push(
        `- [Baseline aktualisieren] ${change.file}: ${debtLabel(change)} ${change.allowed} -> ${change.actual}`,
      );
    }
    lines.push("", `Baseline aktualisieren: ${cssDesignDebtBaselineUpdateCommand}`);
  }
  return lines.join("\n");
}

export function summarizeCssDesignDebt(manifest) {
  let nativeTypeSelectors = 0;
  let designOwnerOverrides = 0;
  for (const debt of Object.values(manifest.files)) {
    nativeTypeSelectors += Object.values(debt.nativeTypeSelectors || {}).reduce(
      (sum, count) => sum + count,
      0,
    );
    designOwnerOverrides += Object.values(debt.designOwnerOverrides || {}).reduce(
      (sum, count) => sum + count,
      0,
    );
  }
  return {
    files: Object.keys(manifest.files).length,
    nativeTypeSelectors,
    designOwnerOverrides,
  };
}
