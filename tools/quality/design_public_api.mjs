import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { version as typescriptVersion } from "typescript";
import { SyntaxKind } from "typescript/unstable/ast";
import {
  isCallExpression,
  isExportDeclaration,
  isExternalModuleReference,
  isIdentifier,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isImportTypeNode,
  isLiteralTypeNode,
  isMetaProperty,
  isNoSubstitutionTemplateLiteral,
  isPropertyAccessExpression,
  isStringLiteral,
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
    if (!layerPrefix) continue;
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
    exports.push({ layer, name, specifier, directory: resolve(designRoot, layer, name) });
  }
  return { exports, violations };
}

/** Require the exact colocated implementation, stylesheet, test, story and folder barrel. */
export function designPublicFolderViolations(directory) {
  const display = normalizedPath(directory);
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    return [`${display}: exported design folder is missing`];
  }
  const entries = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile());
  const names = entries.map((entry) => entry.name);
  const component = basename(directory);
  const violations = [];
  for (const required of [
    `${component}.tsx`,
    `${component}.css`,
    `${component}.test.tsx`,
    `${component}.story.tsx`,
    "index.ts",
  ]) {
    if (!names.includes(required)) {
      violations.push(`${display}: missing required ${required}`);
    }
  }
  return violations;
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
  for (const entry of index.exports) {
    violations.push(
      ...designPublicFolderViolations(entry.directory).map((message) => {
        const prefix = normalizedPath(resolve(repositoryRoot));
        return message.startsWith(`${prefix}/`) ? message.slice(prefix.length + 1) : message;
      }),
    );
  }
  return {
    exportedFolders: index.exports.length,
    productFiles: productFiles.length,
    violations,
  };
}
