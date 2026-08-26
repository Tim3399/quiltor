import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import { version as typescriptVersion } from "typescript";
import {
  isIdentifier,
  isJsxAttribute,
  isJsxExpression,
  isJsxOpeningElement,
  isJsxSelfClosingElement,
  isNoSubstitutionTemplateLiteral,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  isStringLiteral,
  isTemplateExpression,
} from "typescript/unstable/ast/is";
import { API } from "typescript/unstable/sync";

export const designSystemDebtControls = Object.freeze(["button", "input", "select", "textarea"]);
export const designSystemDebtLegacyClasses = Object.freeze([
  "ui-button",
  "icon-button",
  "primary",
  "field",
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
export const designSystemDebtBaselineUpdateCommand =
  "node tools/quality/check_design_system_debt.mjs --write-baseline";
export const designSystemDebtParserContract = Object.freeze({
  package: "typescript",
  version: typescriptVersion,
  api: "typescript/unstable/sync",
});

const schemaVersion = 1;
const scope = Object.freeze({
  roots: Object.freeze([
    "packages/client/src/app",
    "packages/client/src/modules",
    "packages/client/src/shared",
  ]),
  extensions: Object.freeze([".ts", ".tsx"]),
  excluded: Object.freeze([
    "**/*.test.ts(x)",
    "**/*.spec.ts(x)",
    "**/*.testSupport.ts(x)",
    "**/{test,tests,__tests__}/**",
  ]),
});
const categoryManifest = Object.freeze({
  controls: designSystemDebtControls,
  legacyClasses: designSystemDebtLegacyClasses,
});
const compiler = new API({ cwd: process.cwd() });
let compilerSnapshot;
const openFiles = new Set();

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
  const controls = compactCounts(debt.controls, designSystemDebtControls);
  const legacyClasses = compactCounts(debt.legacyClasses, designSystemDebtLegacyClasses);
  return {
    ...(Object.keys(controls).length ? { controls } : {}),
    ...(Object.keys(legacyClasses).length ? { legacyClasses } : {}),
  };
}

function hasDebt(debt) {
  return (
    Object.keys(debt.controls || {}).length > 0 || Object.keys(debt.legacyClasses || {}).length > 0
  );
}

function parseCurrentSource(file, source) {
  const absolute = resolve(file);
  const nextSnapshot = compiler.updateSnapshot(
    openFiles.has(absolute) ? { fileChanges: { invalidateAll: true } } : { openFiles: [absolute] },
  );
  compilerSnapshot?.dispose();
  compilerSnapshot = nextSnapshot;
  openFiles.add(absolute);
  const project = compilerSnapshot.getDefaultProjectForFile(absolute);
  const sourceFile = project?.program.getSourceFile(absolute);
  if (!project || !sourceFile || sourceFile.text !== source) {
    throw new Error(`TypeScript did not parse the current design-debt source ${absolute}`);
  }
  if (project.program.getSyntacticDiagnostics(absolute).length) {
    throw new Error(`TypeScript reported syntax errors in design-debt source ${absolute}`);
  }
  return sourceFile;
}

function collectLiteralClassTokens(node, tokens) {
  if (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node)) {
    for (const token of node.text.split(/\s+/)) {
      if (designSystemDebtLegacyClasses.includes(token)) tokens.add(token);
    }
    return;
  }
  if (isTemplateExpression(node)) {
    for (const literal of [node.head, ...node.templateSpans.map((span) => span.literal)]) {
      for (const token of literal.text.split(/\s+/)) {
        if (designSystemDebtLegacyClasses.includes(token)) tokens.add(token);
      }
    }
    for (const span of node.templateSpans) collectLiteralClassTokens(span.expression, tokens);
    return;
  }
  if (isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (isPropertyAssignment(property) || isShorthandPropertyAssignment(property)) {
        if (
          (isIdentifier(property.name) || isStringLiteral(property.name)) &&
          designSystemDebtLegacyClasses.includes(property.name.text)
        ) {
          tokens.add(property.name.text);
        }
        if (isPropertyAssignment(property)) {
          collectLiteralClassTokens(property.initializer, tokens);
        }
      } else {
        property.forEachChild((child) => collectLiteralClassTokens(child, tokens));
      }
    }
    return;
  }
  node.forEachChild((child) => collectLiteralClassTokens(child, tokens));
}

function classTokensFromAttribute(attribute) {
  if (!isJsxAttribute(attribute) || !isIdentifier(attribute.name)) return [];
  if (!["class", "className"].includes(attribute.name.text) || !attribute.initializer) return [];
  const tokens = new Set();
  if (isJsxExpression(attribute.initializer)) {
    if (attribute.initializer.expression) {
      collectLiteralClassTokens(attribute.initializer.expression, tokens);
    }
  } else {
    collectLiteralClassTokens(attribute.initializer, tokens);
  }
  return [...tokens];
}

/** Count raw intrinsic JSX controls and direct legacy class/className tokens in one source file. */
export function analyzeDesignSystemDebtSource({ file, source }) {
  const sourceFile = parseCurrentSource(file, source);
  const debt = {
    controls: emptyCounts(designSystemDebtControls),
    legacyClasses: emptyCounts(designSystemDebtLegacyClasses),
  };

  function visit(node) {
    if (isJsxOpeningElement(node) || isJsxSelfClosingElement(node)) {
      if (isIdentifier(node.tagName) && designSystemDebtControls.includes(node.tagName.text)) {
        debt.controls[node.tagName.text] += 1;
      }
      for (const attribute of node.attributes.properties) {
        for (const token of classTokensFromAttribute(attribute)) {
          debt.legacyClasses[token] += 1;
        }
      }
    }
    node.forEachChild(visit);
  }

  visit(sourceFile);
  return compactDebt(debt);
}

export function closeDesignSystemDebtParser() {
  compilerSnapshot?.dispose();
  compilerSnapshot = undefined;
  openFiles.clear();
  compiler.close();
}

/** True only for productive TS/TSX files; test and test-support fixtures are excluded. */
export function isDesignSystemDebtSourceFile(file) {
  const path = normalizedPath(file);
  if (!scope.extensions.includes(extname(path).toLowerCase())) return false;
  const scopedPath =
    /(?:^|\/)packages\/client\/src\/(?:app|modules|shared)\/(.*)$/.exec(path)?.[1] || path;
  const segments = scopedPath.split("/");
  if (segments.some((segment) => ["test", "tests", "__tests__"].includes(segment.toLowerCase()))) {
    return false;
  }
  return !/\.(?:test|spec|testSupport)\.(?:ts|tsx)$/i.test(segments.at(-1));
}

export function discoverDesignSystemDebtFiles(repositoryRoot) {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && isDesignSystemDebtSourceFile(path)) files.push(path);
    }
  }
  for (const root of scope.roots) {
    const directory = resolve(repositoryRoot, root);
    if (!existsSync(directory)) throw new Error(`Design-system debt scope is missing: ${root}`);
    visit(directory);
  }
  return files.sort((left, right) => normalizedPath(left).localeCompare(normalizedPath(right)));
}

export function createDesignSystemDebtManifest(files) {
  const normalizedFiles = {};
  for (const file of Object.keys(files).sort()) {
    const debt = compactDebt({
      controls: { ...emptyCounts(designSystemDebtControls), ...(files[file].controls || {}) },
      legacyClasses: {
        ...emptyCounts(designSystemDebtLegacyClasses),
        ...(files[file].legacyClasses || {}),
      },
    });
    if (hasDebt(debt)) normalizedFiles[normalizedPath(file)] = debt;
  }
  return {
    schemaVersion,
    generatedBy: designSystemDebtBaselineUpdateCommand,
    scope: {
      roots: [...scope.roots],
      extensions: [...scope.extensions],
      excluded: [...scope.excluded],
    },
    categories: {
      controls: [...designSystemDebtControls],
      legacyClasses: [...designSystemDebtLegacyClasses],
    },
    files: normalizedFiles,
  };
}

export function scanDesignSystemDebt(repositoryRoot) {
  const files = {};
  for (const file of discoverDesignSystemDebtFiles(repositoryRoot)) {
    const path = normalizedPath(relative(repositoryRoot, file));
    const debt = analyzeDesignSystemDebtSource({ file, source: readFileSync(file, "utf8") });
    if (hasDebt(debt)) files[path] = debt;
  }
  return createDesignSystemDebtManifest(files);
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

/** Validate the checked-in manifest strictly so a malformed allowance never passes silently. */
export function designSystemDebtManifestViolations(manifest) {
  const violations = [];
  if (!plainObject(manifest)) return ["manifest must be a JSON object"];
  if (manifest.schemaVersion !== schemaVersion) {
    violations.push(`schemaVersion must be ${schemaVersion}`);
  }
  if (manifest.generatedBy !== designSystemDebtBaselineUpdateCommand) {
    violations.push(`generatedBy must be ${JSON.stringify(designSystemDebtBaselineUpdateCommand)}`);
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
    if (!isDesignSystemDebtSourceFile(file)) {
      violations.push(`${file}: baseline entries must be productive TS/TSX files`);
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

export function parseDesignSystemDebtManifest(source) {
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch (error) {
    throw new Error(`Design-system debt baseline is not valid JSON: ${error.message}`);
  }
  const violations = designSystemDebtManifestViolations(manifest);
  if (violations.length) {
    throw new Error(`Invalid design-system debt baseline:\n${violations.join("\n")}`);
  }
  return manifest;
}

/** Serialize deterministically in the repository's Biome-compatible JSON layout. */
export function serializeDesignSystemDebtManifest(manifest) {
  const violations = designSystemDebtManifestViolations(manifest);
  if (violations.length) {
    throw new Error(`Invalid design-system debt manifest:\n${violations.join("\n")}`);
  }
  const lines = JSON.stringify(manifest, null, 2).split("\n");
  const formatted = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opening = /^(\s*)("(?:\\.|[^"\\])+"):\s*\[$/.exec(lines[index]);
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
    arrayLines[arrayLines.length - 1] = arrayLines.at(-1).replace(/,$/, "");
    const values = JSON.parse(arrayLines.join("\n").slice(lines[index].indexOf("[")));
    const comma = lines[closing].trimEnd().endsWith(",") ? "," : "";
    const inline = `${opening[1]}${opening[2]}: [${values.map((value) => JSON.stringify(value)).join(", ")}]${comma}`;
    if (inline.length > 100) {
      formatted.push(...lines.slice(index, closing + 1));
    } else {
      formatted.push(inline);
    }
    index = closing;
  }
  return `${formatted.join("\n")}\n`;
}

function countFor(manifest, file, category, name) {
  return manifest.files[file]?.[category]?.[name] || 0;
}

/** Compare exact per-file allowances. Reductions fail closed until the baseline is ratcheted down. */
export function compareDesignSystemDebt({ baseline, current }) {
  for (const [label, manifest] of [
    ["baseline", baseline],
    ["current inventory", current],
  ]) {
    const violations = designSystemDebtManifestViolations(manifest);
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
  return change.category === "controls"
    ? `rohes JSX-Control <${change.name}>`
    : `direkte Legacy-Klasse .${change.name}`;
}

export function formatDesignSystemDebtReport(result) {
  if (result.ok) return "Design-system debt matches the checked-in baseline.";
  const lines = ["Design-system debt ratchet failed."];
  if (result.increases.length) {
    lines.push("", "Neue oder erhöhte Design-Debt:");
    for (const change of result.increases) {
      const newFile = change.newFile ? " (neue Datei mit Debt)" : "";
      lines.push(
        `- [Neue Design-Debt] ${change.file}: ${debtLabel(change)} ${change.allowed} -> ${change.actual}${newFile}`,
      );
    }
  }
  if (result.reductions.length) {
    lines.push("", "Debt wurde reduziert; die niedrigere Obergrenze muss eingecheckt werden:");
    for (const change of result.reductions) {
      lines.push(
        `- [Baseline aktualisieren] ${change.file}: ${debtLabel(change)} ${change.allowed} -> ${change.actual}`,
      );
    }
    lines.push("", `Baseline aktualisieren: ${designSystemDebtBaselineUpdateCommand}`);
  }
  return lines.join("\n");
}

export function summarizeDesignSystemDebt(manifest) {
  let controls = 0;
  let legacyClasses = 0;
  for (const debt of Object.values(manifest.files)) {
    controls += Object.values(debt.controls || {}).reduce((sum, count) => sum + count, 0);
    legacyClasses += Object.values(debt.legacyClasses || {}).reduce((sum, count) => sum + count, 0);
  }
  return { files: Object.keys(manifest.files).length, controls, legacyClasses };
}
