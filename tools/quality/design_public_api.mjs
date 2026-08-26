import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { version as typescriptVersion } from "typescript";
import { SyntaxKind } from "typescript/unstable/ast";
import {
  isArrayBindingPattern,
  isArrowFunction,
  isCallExpression,
  isClassDeclaration,
  isEnumDeclaration,
  isExportAssignment,
  isExportDeclaration,
  isExternalModuleReference,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isImportSpecifier,
  isImportTypeNode,
  isLiteralTypeNode,
  isMetaProperty,
  isNamedExports,
  isNamedImports,
  isNamespaceImport,
  isNoSubstitutionTemplateLiteral,
  isObjectBindingPattern,
  isPropertyAccessExpression,
  isStringLiteral,
  isVariableStatement,
} from "typescript/unstable/ast/is";
import { API } from "typescript/unstable/sync";

export const designPublicLayers = Object.freeze(["primitives", "components", "patterns"]);
export const designPublicApiParserContract = Object.freeze({
  package: "typescript",
  version: typescriptVersion,
  api: "typescript/unstable/sync",
});

const productExtensions = Object.freeze([".ts", ".tsx"]);
const compiler = new API({ cwd: process.cwd() });
let compilerSnapshot;
const openFiles = new Set();

function normalizedPath(path) {
  return path.split(sep).join("/");
}

function isWithin(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
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
    throw new Error(`TypeScript did not parse the current design Public-API source ${absolute}`);
  }
  if (project.program.getSyntacticDiagnostics(absolute).length) {
    throw new Error(`TypeScript reported syntax errors in design Public-API source ${absolute}`);
  }
  return sourceFile;
}

function literalValue(node) {
  return node && (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null;
}

function hasModifier(node, kind) {
  return node.modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function bindingNames(name, names = []) {
  if (isIdentifier(name)) {
    names.push(name.text);
  } else if (isObjectBindingPattern(name) || isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (element.name) bindingNames(element.name, names);
    }
  }
  return names;
}

/** Runtime names exported directly by an implementation module. */
function runtimeExportNames(sourceFile) {
  const localRuntime = new Set();
  for (const statement of sourceFile.statements) {
    if (
      (isFunctionDeclaration(statement) ||
        isClassDeclaration(statement) ||
        isEnumDeclaration(statement)) &&
      statement.name
    ) {
      localRuntime.add(statement.name.text);
    } else if (isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(declaration.name)) localRuntime.add(name);
      }
    }
  }

  const exported = new Set();
  for (const statement of sourceFile.statements) {
    if (isExportAssignment(statement) && !statement.isExportEquals) {
      exported.add("default");
      continue;
    }
    if (
      (isFunctionDeclaration(statement) ||
        isClassDeclaration(statement) ||
        isEnumDeclaration(statement)) &&
      hasModifier(statement, SyntaxKind.ExportKeyword)
    ) {
      if (hasModifier(statement, SyntaxKind.DefaultKeyword)) exported.add("default");
      else if (statement.name) exported.add(statement.name.text);
      continue;
    }
    if (isVariableStatement(statement) && hasModifier(statement, SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(declaration.name)) exported.add(name);
      }
      continue;
    }
    if (
      isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      !statement.isTypeOnly &&
      statement.exportClause &&
      isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;
        const localName = element.propertyName?.text ?? element.name.text;
        if (localRuntime.has(localName)) exported.add(element.name.text);
      }
    }
  }
  return [...exported].sort();
}

/** Callable named exports are the only values the gallery can safely mount as stories. */
function callableStoryExportNames(sourceFile) {
  const names = [];
  for (const statement of sourceFile.statements) {
    if (
      isFunctionDeclaration(statement) &&
      statement.name &&
      hasModifier(statement, SyntaxKind.ExportKeyword) &&
      !hasModifier(statement, SyntaxKind.DefaultKeyword)
    ) {
      names.push(statement.name.text);
    } else if (isVariableStatement(statement) && hasModifier(statement, SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          isIdentifier(declaration.name) &&
          declaration.initializer &&
          (isArrowFunction(declaration.initializer) ||
            isFunctionExpression(declaration.initializer))
        ) {
          names.push(declaration.name.text);
        }
      }
    }
  }
  return names.sort();
}

function containsVitestCase(sourceFile) {
  const testBindings = new Set();
  const namespaceBindings = new Set();
  for (const statement of sourceFile.statements) {
    if (!isImportDeclaration(statement) || literalValue(statement.moduleSpecifier) !== "vitest") {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings && isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (!isImportSpecifier(element)) continue;
        const imported = element.propertyName?.text ?? element.name.text;
        if (["it", "test"].includes(imported)) testBindings.add(element.name.text);
      }
    } else if (bindings && isNamespaceImport(bindings)) {
      namespaceBindings.add(bindings.name.text);
    }
  }

  let found = false;
  function visit(node) {
    if (found) return;
    if (isCallExpression(node)) {
      if (isIdentifier(node.expression) && testBindings.has(node.expression.text)) {
        found = true;
        return;
      }
      if (isPropertyAccessExpression(node.expression)) {
        const owner = node.expression.expression;
        if (
          (isIdentifier(owner) &&
            testBindings.has(owner.text) &&
            ["each", "concurrent", "fails"].includes(node.expression.name.text)) ||
          (isIdentifier(owner) &&
            namespaceBindings.has(owner.text) &&
            ["it", "test"].includes(node.expression.name.text))
        ) {
          found = true;
          return;
        }
      }
    }
    node.forEachChild(visit);
  }
  visit(sourceFile);
  return found;
}

function forwardedExports(sourceFile, expectedSpecifier) {
  let all = false;
  const named = new Map();
  for (const statement of sourceFile.statements) {
    if (
      !isExportDeclaration(statement) ||
      literalValue(statement.moduleSpecifier) !== expectedSpecifier
    ) {
      continue;
    }
    if (!statement.exportClause) {
      if (!statement.isTypeOnly) all = true;
      continue;
    }
    if (statement.isTypeOnly || !isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      if (element.isTypeOnly) continue;
      named.set(element.propertyName?.text ?? element.name.text, element.name.text);
    }
  }
  return { all, named };
}

function hasMeaningfulCss(source) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  const hasDeclaration = /(?:^|[;{])\s*(?:--|-)?[a-zA-Z_][\w-]*\s*:\s*[^;{}]+[;}]/m.test(
    withoutComments,
  );
  const documentsIntentionalInheritance =
    /\/\*[\s\S]*\bintentionally\s+inherits?\b[\s\S]*\*\//i.test(source);
  return hasDeclaration || documentsIntentionalInheritance;
}

function importedSpecifiers(sourceFile) {
  const specifiers = [];
  function visit(node) {
    if (isImportDeclaration(node) || isExportDeclaration(node)) {
      const specifier = literalValue(node.moduleSpecifier);
      if (specifier) specifiers.push(specifier);
    } else if (isImportEqualsDeclaration(node) && isExternalModuleReference(node.moduleReference)) {
      const specifier = literalValue(node.moduleReference.expression);
      if (specifier) specifiers.push(specifier);
    } else if (isImportTypeNode(node)) {
      const specifier = isLiteralTypeNode(node.argument)
        ? literalValue(node.argument.literal)
        : null;
      if (specifier) specifiers.push(specifier);
    } else if (isCallExpression(node)) {
      const dynamicImport = node.expression.kind === SyntaxKind.ImportKeyword;
      const requireCall = isIdentifier(node.expression) && node.expression.text === "require";
      const importMetaGlob =
        isPropertyAccessExpression(node.expression) &&
        isMetaProperty(node.expression.expression) &&
        node.expression.expression.keywordToken === SyntaxKind.ImportKeyword &&
        node.expression.expression.name.text === "meta" &&
        ["glob", "globEager"].includes(node.expression.name.text);
      if (dynamicImport || requireCall || importMetaGlob) {
        const specifier = node.arguments.length === 1 ? literalValue(node.arguments[0]) : null;
        if (specifier) specifiers.push(specifier);
      }
    }
    node.forEachChild(visit);
  }
  visit(sourceFile);
  return [...new Set(specifiers)];
}

export function closeDesignPublicApiParser() {
  compilerSnapshot?.dispose();
  compilerSnapshot = undefined;
  openFiles.clear();
  compiler.close();
}

/** Product sources are TS/TSX below app/modules/shared, excluding tests and support files. */
export function isDesignPublicApiProductSourceFile(file) {
  const path = normalizedPath(file);
  if (!productExtensions.includes(extname(path).toLowerCase())) return false;
  const segments = path.split("/");
  if (segments.some((segment) => ["test", "tests", "__tests__"].includes(segment.toLowerCase()))) {
    return false;
  }
  return !/\.(?:test|spec|testSupport)\.(?:ts|tsx)$/i.test(segments.at(-1));
}

export function discoverDesignPublicApiProductFiles(clientRoot) {
  const files = [];
  function visit(root, directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(root, path);
      else if (entry.isFile() && isDesignPublicApiProductSourceFile(relative(root, path))) {
        files.push(path);
      }
    }
  }
  for (const name of ["app", "modules", "shared"]) {
    const root = resolve(clientRoot, name);
    if (!existsSync(root)) throw new Error(`Design Public-API product root is missing: ${name}`);
    visit(root, root);
  }
  return files.sort((left, right) => normalizedPath(left).localeCompare(normalizedPath(right)));
}

/**
 * Forbid every product dependency below design/ while allowing the design/ barrel itself.
 * The retired shared/ui layer has no public surface: components belong to design and utilities to
 * their app, module or shared owner.
 */
export function designProductImportViolations({ file, source, clientRoot }) {
  let sourceFile;
  try {
    sourceFile = parseCurrentSource(file, source);
  } catch (error) {
    return [`source could not be parsed for the design Public-API boundary: ${error}`];
  }
  const designRoot = resolve(clientRoot, "design");
  const sharedUiRoot = resolve(clientRoot, "shared", "ui");
  const violations = [];
  for (const specifier of importedSpecifiers(sourceFile)) {
    if (!specifier.startsWith(".") && !isAbsolute(specifier)) {
      if (/(?:^|\/)design\/.+/.test(specifier)) {
        violations.push(
          `${JSON.stringify(specifier)} deep-imports design internals; import from the public design barrel`,
        );
      }
      if (/(?:^|\/)shared\/ui(?:\/|$)/.test(specifier)) {
        violations.push(
          `${JSON.stringify(specifier)} imports retired shared/ui; import components from the public design barrel and utilities from their owning layer`,
        );
      }
      continue;
    }
    const target = resolve(dirname(file), specifier);
    if (isWithin(designRoot, target) && target !== designRoot) {
      violations.push(
        `${JSON.stringify(specifier)} deep-imports design internals; import from the public design barrel`,
      );
    }
    if (isWithin(sharedUiRoot, target)) {
      violations.push(
        `${JSON.stringify(specifier)} imports retired shared/ui; import components from the public design barrel and utilities from their owning layer`,
      );
    }
  }
  return violations;
}

/** Parse explicit public folder re-exports from packages/client/src/design/index.ts. */
export function analyzeDesignPublicIndex({ file, source, designRoot }) {
  let sourceFile;
  try {
    sourceFile = parseCurrentSource(file, source);
  } catch (error) {
    return { exports: [], violations: [`index could not be parsed: ${error}`] };
  }
  const exports = [];
  const violations = [];
  const seen = new Set();
  for (const statement of sourceFile.statements) {
    if (!isExportDeclaration(statement)) continue;
    const specifier = literalValue(statement.moduleSpecifier);
    if (!specifier) continue;
    const layerPrefix = new RegExp(`^\\./(${designPublicLayers.join("|")})(?:/|$)`).exec(specifier);
    if (!layerPrefix) {
      if (specifier.startsWith(".")) {
        violations.push(
          `${JSON.stringify(specifier)} is not a public primitive/component/pattern folder barrel`,
        );
      }
      continue;
    }
    const match = new RegExp(`^\\./(${designPublicLayers.join("|")})/([^/]+)/?$`).exec(specifier);
    if (!match || [".", ".."].includes(match[2])) {
      violations.push(
        `${JSON.stringify(specifier)} must export one explicit primitive/component/pattern folder barrel`,
      );
      continue;
    }
    const [, layer, name] = match;
    const key = `${layer}/${name}`;
    if (seen.has(key)) {
      violations.push(`${JSON.stringify(specifier)} exports ${key} more than once`);
      continue;
    }
    seen.add(key);
    const forwarding = forwardedExports(sourceFile, specifier);
    exports.push({
      layer,
      name,
      specifier,
      directory: resolve(designRoot, layer, name),
      forwardsAllRuntime: forwarding.all && !statement.isTypeOnly,
      forwardedRuntimeNames: [...forwarding.named.keys()].sort(),
    });
  }
  return { exports, violations };
}

/** Every immediate directory in a public layer is itself part of the public design contract. */
export function discoverDesignPublicFolders(designRoot) {
  const folders = [];
  for (const layer of designPublicLayers) {
    const layerRoot = resolve(designRoot, layer);
    if (!existsSync(layerRoot) || !statSync(layerRoot).isDirectory()) continue;
    for (const entry of readdirSync(layerRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        folders.push({
          layer,
          name: entry.name,
          directory: resolve(layerRoot, entry.name),
        });
      }
    }
  }
  return folders.sort((left, right) =>
    `${left.layer}/${left.name}`.localeCompare(`${right.layer}/${right.name}`),
  );
}

export function designPublicFolderSetViolations(designRoot, exportedFolders) {
  const violations = [];
  for (const layer of designPublicLayers) {
    const layerRoot = resolve(designRoot, layer);
    if (!existsSync(layerRoot) || !statSync(layerRoot).isDirectory()) {
      violations.push(`${normalizedPath(layerRoot)}: public design layer is missing`);
    }
  }
  const exported = new Set(exportedFolders.map(({ layer, name }) => `${layer}/${name}`));
  for (const folder of discoverDesignPublicFolders(designRoot)) {
    const key = `${folder.layer}/${folder.name}`;
    if (!exported.has(key)) {
      violations.push(
        `${normalizedPath(folder.directory)}: public design folder is absent from packages/client/src/design/index.ts`,
      );
    }
  }
  return violations;
}

/** Require meaningful colocated implementation, stylesheet, test, story and folder barrel files. */
export function analyzeDesignPublicFolder(directory) {
  const display = normalizedPath(directory);
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    return {
      publicRuntimeExports: [],
      violations: [`${display}: exported design folder is missing`],
    };
  }
  const entries = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile());
  const names = entries.map((entry) => entry.name);
  const component = basename(directory);
  const violations = [];
  const files = {
    implementation: `${component}.tsx`,
    stylesheet: `${component}.css`,
    test: `${component}.test.tsx`,
    story: `${component}.story.tsx`,
    barrel: "index.ts",
  };
  for (const required of Object.values(files)) {
    if (!names.includes(required)) {
      violations.push(`${display}: missing required ${required}`);
    }
  }

  const source = {};
  for (const [role, name] of Object.entries(files)) {
    if (!names.includes(name)) continue;
    source[role] = readFileSync(resolve(directory, name), "utf8");
    if (!source[role].trim()) {
      violations.push(`${display}: required ${name} is empty`);
    }
  }

  if (source.stylesheet !== undefined && !hasMeaningfulCss(source.stylesheet)) {
    violations.push(
      `${display}: ${files.stylesheet} contains neither a CSS declaration nor documented intentional inheritance`,
    );
  }

  let implementationSourceFile;
  if (source.implementation !== undefined) {
    try {
      implementationSourceFile = parseCurrentSource(
        resolve(directory, files.implementation),
        source.implementation,
      );
    } catch (error) {
      violations.push(`${display}: ${files.implementation} could not be parsed: ${error}`);
    }
  }
  const implementationRuntimeExports = implementationSourceFile
    ? runtimeExportNames(implementationSourceFile)
    : [];
  if (implementationSourceFile) {
    const cssSpecifier = `./${files.stylesheet}`;
    const importsCss = implementationSourceFile.statements.some(
      (statement) =>
        isImportDeclaration(statement) && literalValue(statement.moduleSpecifier) === cssSpecifier,
    );
    if (!importsCss) {
      violations.push(
        `${display}: ${files.implementation} must import its colocated ${cssSpecifier}`,
      );
    }
    if (!implementationRuntimeExports.length) {
      violations.push(`${display}: ${files.implementation} exports no runtime implementation`);
    }
  }

  let barrelSourceFile;
  if (source.barrel !== undefined) {
    try {
      barrelSourceFile = parseCurrentSource(resolve(directory, files.barrel), source.barrel);
    } catch (error) {
      violations.push(`${display}: ${files.barrel} could not be parsed: ${error}`);
    }
  }
  const implementationSpecifier = `./${component}`;
  const barrelForwarding = barrelSourceFile
    ? forwardedExports(barrelSourceFile, implementationSpecifier)
    : { all: false, named: new Map() };
  if (barrelSourceFile && !barrelForwarding.all && !barrelForwarding.named.size) {
    violations.push(
      `${display}: ${files.barrel} must re-export the ${implementationSpecifier} implementation`,
    );
  }
  const missingRuntimeExports = barrelForwarding.all
    ? []
    : implementationRuntimeExports.filter((name) => !barrelForwarding.named.has(name));
  if (missingRuntimeExports.length) {
    violations.push(
      `${display}: ${files.barrel} omits runtime export${missingRuntimeExports.length === 1 ? "" : "s"} ${missingRuntimeExports.join(", ")} from ${implementationSpecifier}`,
    );
  }
  const publicRuntimeExports = barrelForwarding.all
    ? implementationRuntimeExports
    : implementationRuntimeExports
        .filter((name) => barrelForwarding.named.has(name))
        .map((name) => barrelForwarding.named.get(name))
        .sort();

  if (source.test !== undefined) {
    try {
      const testSourceFile = parseCurrentSource(resolve(directory, files.test), source.test);
      if (!containsVitestCase(testSourceFile)) {
        violations.push(
          `${display}: ${files.test} must contain an it/test case imported from vitest`,
        );
      }
    } catch (error) {
      violations.push(`${display}: ${files.test} could not be parsed: ${error}`);
    }
  }

  if (source.story !== undefined) {
    try {
      const storySourceFile = parseCurrentSource(resolve(directory, files.story), source.story);
      if (!callableStoryExportNames(storySourceFile).length) {
        violations.push(
          `${display}: ${files.story} must export at least one named callable gallery story`,
        );
      }
    } catch (error) {
      violations.push(`${display}: ${files.story} could not be parsed: ${error}`);
    }
  }

  return { publicRuntimeExports, violations };
}

export function designPublicFolderViolations(directory) {
  return analyzeDesignPublicFolder(directory).violations;
}

/** Public component folders own styles; design/components itself must never become a CSS bucket. */
export function designLooseComponentStyleViolations(designRoot) {
  const componentsRoot = resolve(designRoot, "components");
  if (!existsSync(componentsRoot) || !statSync(componentsRoot).isDirectory()) return [];
  return readdirSync(componentsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".css"))
    .map(
      (entry) =>
        `${normalizedPath(resolve(componentsRoot, entry.name))}: loose component stylesheet must move to its owning component folder`,
    );
}

/** Retired global recipes must not return after product migration to public component owners. */
export function designRetiredLegacyViolations(designRoot) {
  return [resolve(designRoot, "internal", "legacy.css"), resolve(designRoot, "internal", "legacy")]
    .filter((path) => existsSync(path))
    .map(
      (path) =>
        `${normalizedPath(path)}: retired design legacy styles are forbidden; use a public component or a colocated feature owner`,
    );
}

export function checkDesignPublicApi(repositoryRoot) {
  const clientRoot = resolve(repositoryRoot, "packages", "client", "src");
  const designRoot = resolve(clientRoot, "design");
  const indexFile = resolve(designRoot, "index.ts");
  const violations = [];
  const productFiles = discoverDesignPublicApiProductFiles(clientRoot);
  for (const file of productFiles) {
    const failures = designProductImportViolations({
      file,
      source: readFileSync(file, "utf8"),
      clientRoot,
    });
    violations.push(
      ...failures.map((message) => `${normalizedPath(relative(repositoryRoot, file))}: ${message}`),
    );
  }
  violations.push(
    ...designLooseComponentStyleViolations(designRoot).map((message) => {
      const prefix = normalizedPath(resolve(repositoryRoot));
      return message.startsWith(`${prefix}/`) ? message.slice(prefix.length + 1) : message;
    }),
  );
  violations.push(
    ...designRetiredLegacyViolations(designRoot).map((message) => {
      const prefix = normalizedPath(resolve(repositoryRoot));
      return message.startsWith(`${prefix}/`) ? message.slice(prefix.length + 1) : message;
    }),
  );
  if (!existsSync(indexFile)) {
    violations.push("packages/client/src/design/index.ts: public design barrel is missing");
    return { exportedFolders: 0, productFiles: productFiles.length, violations };
  }
  const index = analyzeDesignPublicIndex({
    file: indexFile,
    source: readFileSync(indexFile, "utf8"),
    designRoot,
  });
  violations.push(
    ...index.violations.map((message) => `packages/client/src/design/index.ts: ${message}`),
  );
  violations.push(
    ...designPublicFolderSetViolations(designRoot, index.exports).map((message) => {
      const prefix = normalizedPath(resolve(repositoryRoot));
      return message.startsWith(`${prefix}/`) ? message.slice(prefix.length + 1) : message;
    }),
  );
  for (const entry of index.exports) {
    const folder = analyzeDesignPublicFolder(entry.directory);
    violations.push(
      ...folder.violations.map((message) => {
        const prefix = normalizedPath(resolve(repositoryRoot));
        return message.startsWith(`${prefix}/`) ? message.slice(prefix.length + 1) : message;
      }),
    );
    if (!entry.forwardsAllRuntime) {
      const forwarded = new Set(entry.forwardedRuntimeNames);
      const missing = folder.publicRuntimeExports.filter((name) => !forwarded.has(name));
      if (missing.length) {
        violations.push(
          `packages/client/src/design/index.ts: ${entry.specifier} omits public runtime export${missing.length === 1 ? "" : "s"} ${missing.join(", ")}`,
        );
      }
    }
  }
  return {
    exportedFolders: index.exports.length,
    productFiles: productFiles.length,
    violations,
  };
}
