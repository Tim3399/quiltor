import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { version as typescriptVersion } from "typescript";
// TypeScript 7 intentionally exports only version metadata at its package root.
// Its compiler Program/AST client is currently exposed by this explicit package
// export; frontend_boundaries.test.mjs pins that dependency until TS publishes a
// stable replacement. The visitor itself uses the compiler AST, not text matching.
import { API } from "typescript/unstable/sync";
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

const compiler = new API({ cwd: process.cwd() });
let compilerSnapshot;
const openFiles = new Set();

export const frontendSourceExtensions = Object.freeze([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
]);

export const frontendBoundaryParserContract = Object.freeze({
  package: "typescript",
  version: typescriptVersion,
  api: "typescript/unstable/sync",
});

export function closeFrontendBoundaryParser() {
  compilerSnapshot?.dispose();
  compilerSnapshot = undefined;
  compiler.close();
}

function isWithin(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

function parsedDependencies(file, source) {
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
    throw new Error(`TypeScript did not parse the current source for ${absolute}`);
  }
  if (project.program.getSyntacticDiagnostics(absolute).length) {
    throw new Error(`TypeScript reported syntax errors in ${absolute}`);
  }
  const dependencies = [];

  function literalValue(node) {
    return node && (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node))
      ? node.text
      : null;
  }

  function visit(node) {
    if (isImportDeclaration(node)) {
      const specifier = literalValue(node.moduleSpecifier);
      if (specifier) dependencies.push({ kind: "import", specifier, nonLiteral: false });
    } else if (isExportDeclaration(node)) {
      const specifier = literalValue(node.moduleSpecifier);
      if (specifier) dependencies.push({ kind: "import", specifier, nonLiteral: false });
    } else if (isImportEqualsDeclaration(node) && isExternalModuleReference(node.moduleReference)) {
      const specifier = literalValue(node.moduleReference.expression);
      if (specifier) dependencies.push({ kind: "import", specifier, nonLiteral: false });
    } else if (isImportTypeNode(node)) {
      const specifier = isLiteralTypeNode(node.argument)
        ? literalValue(node.argument.literal)
        : null;
      dependencies.push({
        kind: "import",
        specifier,
        nonLiteral: specifier === null,
      });
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
        const specifier =
          importMetaGlob || node.arguments.length === 1 ? literalValue(node.arguments[0]) : null;
        dependencies.push({
          kind: dynamicImport
            ? "import"
            : requireCall
              ? "require"
              : `import.meta.${node.expression.name.text}`,
          specifier,
          nonLiteral: specifier === null,
          compositionOnly: importMetaGlob,
        });
      }
    }
    node.forEachChild(visit);
  }

  visit(sourceFile);
  return dependencies.filter(
    (item, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.kind === item.kind &&
          candidate.specifier === item.specifier &&
          candidate.nonLiteral === item.nonLiteral &&
          candidate.compositionOnly === item.compositionOnly,
      ) === index,
  );
}

/** Static imports, re-exports, literal import() calls and CommonJS require() calls. */
export function importedSpecifiers(file, source) {
  return parsedDependencies(file, source).flatMap((item) =>
    item.specifier ? [item.specifier] : [],
  );
}

/** Enforce module/public-host boundaries for one parsed frontend source file. */
export function frontendImportViolations({ file, source, clientRoot, modulesRoot, webHostRoot }) {
  const violations = [];
  const sourceInModules = isWithin(modulesRoot, file);
  const sourceModule = sourceInModules ? relative(modulesRoot, file).split(sep)[0] : null;
  const appRoot = resolve(clientRoot, "app");
  const platformRoot = resolve(clientRoot, "platform");
  const sourceInExecutableWebHost = webHostRoot ? file === resolve(webHostRoot, "main.tsx") : false;
  const sourceInPlatformGatewayComposer =
    file === resolve(platformRoot, "createPlatformGateway.ts");
  const sourceInCompositionRoot = sourceInPlatformGatewayComposer || sourceInExecutableWebHost;
  const concreteAdapterRoots = ["http", "desktop", "browser"].map((name) =>
    resolve(platformRoot, name),
  );
  const sourceAdapterRoot = concreteAdapterRoots.find((adapterRoot) => isWithin(adapterRoot, file));
  const httpAdapterRoot = resolve(platformRoot, "http");

  let dependencies;
  try {
    dependencies = parsedDependencies(file, source);
  } catch (error) {
    return [`source could not be parsed for architecture boundaries: ${error}`];
  }

  for (const dependency of dependencies) {
    if (dependency.compositionOnly && !sourceInCompositionRoot) {
      violations.push(`${dependency.kind} dependency discovery is restricted to composition roots`);
      continue;
    }
    if (dependency.nonLiteral) {
      violations.push(`non-literal ${dependency.kind} dependencies are forbidden`);
      continue;
    }
    const specifier = dependency.specifier;
    if (!specifier) continue;
    if (!specifier.startsWith(".")) continue;
    const importedPath = resolve(dirname(file), specifier);

    if (isWithin(modulesRoot, importedPath)) {
      const importedModule = relative(modulesRoot, importedPath).split(sep)[0];
      if (
        importedModule !== sourceModule &&
        importedPath !== resolve(modulesRoot, importedModule)
      ) {
        violations.push(
          `imports private internals from module ${importedModule}; use its root public API`,
        );
      }
    }

    if (sourceInModules && isWithin(appRoot, importedPath)) {
      violations.push("product modules may not depend on app composition internals");
    }

    if (sourceInModules && isWithin(platformRoot, importedPath) && importedPath !== platformRoot) {
      violations.push("product modules must consume the public platform root API");
    }

    const importedAdapterRoot = concreteAdapterRoots.find((adapterRoot) =>
      isWithin(adapterRoot, importedPath),
    );
    if (
      importedAdapterRoot &&
      importedAdapterRoot !== sourceAdapterRoot &&
      !sourceInPlatformGatewayComposer &&
      !sourceInExecutableWebHost
    ) {
      violations.push(
        "concrete platform adapters may only be composed by a registered executable or gateway composition root",
      );
    }

    if (
      !isWithin(httpAdapterRoot, file) &&
      isWithin(httpAdapterRoot, importedPath) &&
      importedPath !== httpAdapterRoot
    ) {
      violations.push("HTTP adapter internals are private; compose its root public API");
    }
  }

  return [...new Set(violations)];
}
