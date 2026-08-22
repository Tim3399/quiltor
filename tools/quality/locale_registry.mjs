import { resolve } from "node:path";
import { API } from "typescript/unstable/sync";
import {
  isArrayLiteralExpression,
  isAsExpression,
  isIdentifier,
  isImportDeclaration,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPropertyAssignment,
  isSatisfiesExpression,
  isStringLiteral,
  isVariableStatement,
} from "typescript/unstable/ast/is";

const compiler = new API({ cwd: process.cwd() });
let compilerSnapshot;
const openFiles = new Set();

export function closeLocaleRegistryParser() {
  compilerSnapshot?.dispose();
  compilerSnapshot = undefined;
  compiler.close();
}

function unwrapExpression(node) {
  let current = node;
  while (
    current &&
    (isAsExpression(current) ||
      isSatisfiesExpression(current) ||
      isParenthesizedExpression(current))
  ) {
    current = current.expression;
  }
  return current;
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
    throw new Error(`TypeScript did not parse the current locale registry ${absolute}`);
  }
  if (project.program.getSyntacticDiagnostics(absolute).length) {
    throw new Error(`TypeScript reported syntax errors in locale registry ${absolute}`);
  }
  return sourceFile;
}

function propertyName(property) {
  return isIdentifier(property.name) || isStringLiteral(property.name) ? property.name.text : null;
}

/**
 * Parse the runtime registry itself and prove exact directory-to-registry parity.
 * Imports that are unused, commented-out text, duplicate entries, and mismatched
 * catalog/manifest pairs therefore cannot make a locale appear registered.
 */
export function analyzeLocaleRegistry({ file, source, expectedLocales }) {
  const violations = [];
  let sourceFile;
  try {
    sourceFile = parseCurrentSource(file, source);
  } catch (error) {
    return { locales: [], violations: [String(error)] };
  }

  const imports = new Map();
  let registryInitializer = null;
  for (const statement of sourceFile.statements) {
    if (isImportDeclaration(statement) && isStringLiteral(statement.moduleSpecifier)) {
      const local = statement.importClause?.name;
      if (local && isIdentifier(local)) imports.set(local.text, statement.moduleSpecifier.text);
    }
    if (!isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (isIdentifier(declaration.name) && declaration.name.text === "localePackages") {
        registryInitializer = unwrapExpression(declaration.initializer);
      }
    }
  }

  if (!registryInitializer || !isArrayLiteralExpression(registryInitializer)) {
    return {
      locales: [],
      violations: ["localePackages must be an explicit array literal"],
    };
  }

  const locales = [];
  for (const [index, element] of registryInitializer.elements.entries()) {
    const object = unwrapExpression(element);
    if (!object || !isObjectLiteralExpression(object)) {
      violations.push(`localePackages[${index}] must be an object literal`);
      continue;
    }
    const values = new Map();
    for (const property of object.properties) {
      if (!isPropertyAssignment(property)) continue;
      const name = propertyName(property);
      const value = unwrapExpression(property.initializer);
      if (name && value && isIdentifier(value)) values.set(name, imports.get(value.text));
    }
    const catalogModule = values.get("catalog");
    const manifestModule = values.get("manifest");
    const catalogMatch = typeof catalogModule === "string" && /^\.\/([^/]+)$/.exec(catalogModule);
    const manifestMatch =
      typeof manifestModule === "string" && /^\.\/([^/]+)\/manifest\.json$/.exec(manifestModule);
    if (!catalogMatch || !manifestMatch || catalogMatch[1] !== manifestMatch[1]) {
      violations.push(
        `localePackages[${index}] must pair default imports from ./<locale> and ./<locale>/manifest.json`,
      );
      continue;
    }
    locales.push(catalogMatch[1]);
  }

  const duplicates = locales.filter((locale, index) => locales.indexOf(locale) !== index);
  if (duplicates.length) {
    violations.push(`duplicate locale registrations: ${[...new Set(duplicates)].join(", ")}`);
  }
  const expected = [...expectedLocales].sort();
  const actual = [...new Set(locales)].sort();
  const missing = expected.filter((locale) => !actual.includes(locale));
  const extra = actual.filter((locale) => !expected.includes(locale));
  if (missing.length)
    violations.push(`missing runtime locale registrations: ${missing.join(", ")}`);
  if (extra.length) violations.push(`unexpected runtime locale registrations: ${extra.join(", ")}`);

  return { locales, violations };
}
