import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import {
  closeFrontendBoundaryParser,
  frontendBoundaryParserContract,
  frontendImportViolations,
  frontendSourceExtensions,
  importedSpecifiers,
} from "./frontend_boundaries.mjs";

const fixtureRoot = mkdtempSync(join(tmpdir(), "quiltor-frontend-boundaries-"));
const clientRoot = resolve(fixtureRoot, "packages/client/src");
const modulesRoot = resolve(clientRoot, "modules");
const webHostRoot = resolve(fixtureRoot, "apps/web");

after(() => {
  closeFrontendBoundaryParser();
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function scan(path, source) {
  const file = resolve(clientRoot, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source, "utf8");
  return frontendImportViolations({ file, source, clientRoot, modulesRoot, webHostRoot });
}

function scanWorkspace(path, source) {
  const file = resolve(fixtureRoot, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source, "utf8");
  return frontendImportViolations({ file, source, clientRoot, modulesRoot, webHostRoot });
}

function specifiers(path, source) {
  const file = resolve(clientRoot, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source, "utf8");
  return importedSpecifiers(file, source);
}

test("the release gate pins the shipped TypeScript 7 compiler AST client", () => {
  assert.deepEqual(frontendBoundaryParserContract, {
    package: "typescript",
    version: "7.0.2",
    api: "typescript/unstable/sync",
  });
});

test("the workspace scanner covers every frontend module extension", () => {
  assert.deepEqual(frontendSourceExtensions, [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mts",
    ".cts",
    ".mjs",
    ".cjs",
  ]);
  for (const extension of frontendSourceExtensions) {
    assert.match(
      scan(`shared/adapter${extension}`, 'import "../platform/http/request";').join("\n"),
      /concrete platform adapters may only be composed/,
      extension,
    );
  }
});

test("the retired global application stylesheet cannot return under a generic root name", () => {
  const repositoryRoot = resolve(process.cwd());
  const designRoot = resolve(repositoryRoot, "packages/client/src/design");
  const allowed = [
    "base.css",
    "colors.css",
    "index.css",
    "materials.css",
    "motion.css",
    "tokens.css",
    "typography.css",
  ];
  assert.equal(existsSync(resolve(designRoot, "application.css")), false);
  assert.deepEqual(
    readdirSync(designRoot)
      .filter((name) => name.endsWith(".css"))
      .sort(),
    allowed,
  );
  assert.doesNotMatch(
    readFileSync(resolve(repositoryRoot, "apps/web/main.tsx"), "utf8"),
    /design\/(?:application|app|styles)\.css/,
  );
});

test("AppShell may import a module root but not a private module file", () => {
  assert.deepEqual(scan("app/AppShellAllowed.tsx", 'import "../modules/assistant";'), []);
  assert.match(
    scan("app/AppShellPrivate.tsx", 'import "../modules/assistant/AssistantDrawer";').join("\n"),
    /private internals/,
  );
});

test("dynamic cross-module imports use the same public API rule", () => {
  assert.match(
    scan("modules/search/SearchDynamic.tsx", 'const drawer = import("../assistant/ui");').join(
      "\n",
    ),
    /private internals/,
  );
});

test("non-literal dynamic dependencies fail closed in every source layer", () => {
  for (const [path, source, workspace] of [
    ["modules/search/SearchNonLiteral.tsx", "const dependency = import(moduleName);", false],
    ["app/AppShellDynamic.tsx", "const dependency = import(moduleName);", false],
    ["shared/lazy.ts", "const dependency = import(moduleName);", false],
    ["i18n/load.ts", "const dependency = require(localeModule);", false],
    ["platform/dynamic.ts", "const dependency = import(moduleName);", false],
    ["apps/web/dynamic.ts", "const dependency = import(moduleName);", true],
    ["apps/mobile/main.tsx", "const dependency = import(moduleName);", true],
  ]) {
    const violations = workspace ? scanWorkspace(path, source) : scan(path, source);
    assert.match(violations.join("\n"), /non-literal (?:import|require) dependencies/, path);
  }
});

test("import.meta glob dependency discovery is composition-only", () => {
  for (const [path, source] of [
    ["app/AppGlob.tsx", 'const files = import.meta.glob("../platform/http/*.ts");'],
    ["shared/eager.ts", 'const files = import.meta.globEager("../platform/desktop/*.ts");'],
  ]) {
    assert.match(
      scan(path, source).join("\n"),
      /import\.meta\.(?:glob|globEager) dependency discovery is restricted/,
      path,
    );
  }
});

test("commented imports are comments, not architecture dependencies", () => {
  const source = [
    '// import "../assistant/ui";',
    '// require("../assistant/ui");',
    "export const search = true;",
  ].join("\n");
  assert.deepEqual(specifiers("modules/search/SearchCommented.tsx", source), []);
  assert.deepEqual(scan("modules/search/SearchCommented.tsx", source), []);
});

test("CommonJS require calls cannot bypass module boundaries", () => {
  assert.match(
    scan("modules/search/SearchRequire.tsx", 'const assistant = require("../assistant/ui");').join(
      "\n",
    ),
    /private internals/,
  );
  assert.match(
    scan("app/AppShellRequire.tsx", "const dependency = require(moduleName);").join("\n"),
    /non-literal require dependencies/,
  );
});

test("modules cannot depend on app internals", () => {
  assert.match(
    scan("modules/search/SearchApp.tsx", 'import "../../app/hooks/useTheme";').join("\n"),
    /app composition internals/,
  );
});

test("modules cannot bypass the public platform API for desktop or browser adapters", () => {
  const violations = scan(
    "modules/search/SearchPlatform.tsx",
    [
      'import "../../platform/desktop/desktopFileGateway";',
      'import "../../platform/browser/browserPlatformGateway";',
    ].join("\n"),
  );
  assert.equal(violations.filter((item) => /public platform root/.test(item)).length, 1);
});

test("app, shared and i18n code cannot compose concrete platform adapters", () => {
  for (const [path, source] of [
    ["app/AppPlatform.tsx", 'import "../platform/http/request";'],
    ["shared/file.ts", 'import "../platform/desktop/desktopFileGateway";'],
    ["i18n/locale.ts", 'import "../platform/browser/browserPlatformGateway";'],
  ]) {
    assert.match(
      scan(path, source).join("\n"),
      /concrete platform adapters may only be composed/,
      path,
    );
  }
});

test("only the explicit platform gateway composer may combine browser and desktop adapters", () => {
  assert.deepEqual(
    scan(
      "platform/createPlatformGateway.ts",
      'import "./browser/browserPlatformGateway"; import "./desktop/desktopFileGateway";',
    ),
    [],
  );
  for (const [path, source] of [
    ["platform/application/escape.ts", 'import "../desktop/desktopFileGateway";'],
    ["platform/contracts/escape.ts", 'import "../http";'],
    ["platform/helper.ts", 'import "./browser/browserPlatformGateway";'],
  ]) {
    assert.match(
      scan(path, source).join("\n"),
      /concrete platform adapters may only be composed/,
      path,
    );
  }
});

test("outside platform internals only the executable web host may compose adapters", () => {
  const source = [
    'import "../../packages/client/src/platform/http";',
    'const files = import.meta.glob("./parts/*.ts");',
  ].join("\n");
  assert.deepEqual(scanWorkspace("apps/web/main.tsx", source), []);
  for (const path of ["apps/web/helper.tsx", "apps/mobile/adapter.tsx"]) {
    assert.match(
      scanWorkspace(path, source).join("\n"),
      /concrete platform adapters may only be composed/,
      path,
    );
  }
});

test("HTTP adapter consumers cannot bypass its root composition API", () => {
  const privateSource =
    'import "../../packages/client/src/platform/http/createHttpApplicationGateway";';
  assert.match(
    scanWorkspace("apps/web/private.tsx", privateSource).join("\n"),
    /HTTP adapter internals are private/,
  );
  assert.match(
    scan("platform/httpConsumer.ts", 'import "./http/request";').join("\n"),
    /HTTP adapter internals are private/,
  );
});

test("static re-exports and TypeScript type imports are scanned", () => {
  assert.deepEqual(specifiers("index-export.ts", 'export { x } from "./x";'), ["./x"]);
  assert.deepEqual(specifiers("index-type.ts", 'import type { X } from "./x";'), ["./x"]);
  assert.deepEqual(specifiers("index-require.ts", 'const x = require("./x");'), ["./x"]);
});
