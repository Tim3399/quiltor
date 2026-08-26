import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import {
  analyzeDesignPublicFolder,
  analyzeDesignPublicIndex,
  checkDesignPublicApi,
  closeDesignPublicApiParser,
  designLooseComponentStyleViolations,
  designProductImportViolations,
  designPublicApiParserContract,
  designPublicFolderSetViolations,
  designPublicFolderViolations,
  designRetiredLegacyViolations,
  discoverDesignPublicApiProductFiles,
} from "./design_public_api.mjs";

const fixtureRoot = mkdtempSync(join(tmpdir(), "quiltor-design-public-api-"));
const clientRoot = resolve(fixtureRoot, "packages/client/src");
const designRoot = resolve(clientRoot, "design");
let sequence = 0;

after(() => {
  closeDesignPublicApiParser();
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function write(path, source = "") {
  const file = resolve(fixtureRoot, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source, "utf8");
  return file;
}

function productViolations(source) {
  sequence += 1;
  const file = write(`packages/client/src/modules/fixture/Fixture${sequence}.tsx`, source);
  return designProductImportViolations({ file, source, clientRoot });
}

function createCompleteFolder(path, component = "Component") {
  write(`${path}/index.ts`, `export * from "./${component}";`);
  write(
    `${path}/${component}.tsx`,
    `import "./${component}.css";\nexport function ${component}() { return null; }\n`,
  );
  write(`${path}/${component}.css`, `.${component} { display: block; }\n`);
  write(
    `${path}/${component}.test.tsx`,
    `import { test } from "vitest";\ntest("renders", () => {});\n`,
  );
  write(`${path}/${component}.story.tsx`, "export function Default() { return null; }\n");
}

test("pins the shipped TypeScript AST parser used by the Public-API contract", () => {
  assert.deepEqual(designPublicApiParserContract, {
    package: "typescript",
    version: "7.0.2",
    api: "typescript/unstable/sync",
  });
});

test("allows product imports from the public design barrel", () => {
  assert.deepEqual(
    productViolations(`
      import { Button } from "../../design";
      import type { ButtonProps } from "../../design/";
      export const Fixture = Button;
    `),
    [],
  );
});

test("rejects static, dynamic, type and CommonJS deep imports into design", () => {
  const failures = productViolations(`
    import { Button } from "../../design/primitives/Button";
    export { IconButton } from "../../design/primitives/IconButton";
    type Props = import("../../design/primitives/Field").FieldProps;
    const area = import("../../design/primitives/TextArea");
    const text = require("../../design/primitives/TextField");
    const alias = import("@/design/internal/private-helper");
    void Button; void area; void text; void alias;
  `);
  assert.equal(failures.length, 6);
  for (const name of ["Button", "IconButton", "Field", "TextArea", "TextField"]) {
    assert.match(failures.join("\n"), new RegExp(`design/primitives/${name}`));
  }
  assert.match(failures.join("\n"), /@\/design\/internal\/private-helper/);
});

test("rejects every shared/ui dependency without utility exceptions", () => {
  const failures = productViolations(`
    import { useShortcut } from "../../shared/ui/shortcuts";
    import type { ShortcutDefinition } from "@/shared/ui/shortcuts";
    import { Dialog } from "../../shared/ui";
    export { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
    type Item = import("../../shared/ui/CommandPalette").CommandPaletteItem;
    const menu = import("@/shared/ui/SelectionMenu");
    const sheet = require("@/shared/ui/Sheet");
    void useShortcut; void Dialog; void menu; void sheet;
  `);
  assert.equal(failures.length, 7);
  assert.match(failures.join("\n"), /shared\/ui\/shortcuts.*retired shared\/ui/);
  assert.match(failures.join("\n"), /shared\/ui\/ConfirmDialog.*retired shared\/ui/);
});

test("ignores comments, ordinary strings and dependencies outside design", () => {
  assert.deepEqual(
    productViolations(`
      // import { Button } from "../../design/primitives/Button";
      const example = "../../design/primitives/Field";
      import { helper } from "../helper";
      export { helper, example };
    `),
    [],
  );
});

test("fails closed when a product source cannot be parsed", () => {
  assert.match(
    productViolations("export const Broken = <Button>;").join("\n"),
    /could not be parsed/,
  );
});

test("discovers productive app/module/shared TS sources and excludes tests", () => {
  const root = resolve(fixtureRoot, "discovery/packages/client/src");
  write("discovery/packages/client/src/app/App.tsx", "export const App = true;");
  write("discovery/packages/client/src/app/App.test.tsx", "export const App = false;");
  write("discovery/packages/client/src/modules/editor/model.ts", "export const model = true;");
  write(
    "discovery/packages/client/src/modules/editor/Editor.testSupport.tsx",
    "export const x = true;",
  );
  write(
    "discovery/packages/client/src/modules/editor/__tests__/Editor.tsx",
    "export const x = true;",
  );
  write("discovery/packages/client/src/shared/Outside.tsx", "export const x = true;");
  assert.deepEqual(
    discoverDesignPublicApiProductFiles(root).map((file) =>
      file.replaceAll("\\", "/").replace(`${root.replaceAll("\\", "/")}/`, ""),
    ),
    ["app/App.tsx", "modules/editor/model.ts", "shared/Outside.tsx"],
  );
});

test("extracts explicit public folders and rejects collector, deep and duplicate exports", () => {
  const source = `
    import type { ReactNode } from "react";
    export * from "./primitives/Button";
    export { Button } from "./primitives/Button";
    export * from "./components";
    export * from "./patterns/Dialog/Dialog";
    export * from "./internal/private";
    // export * from "./primitives/Commented";
    export type { ReactNode };
  `;
  const file = write("packages/client/src/design/index.ts", source);
  const result = analyzeDesignPublicIndex({
    file,
    designRoot,
    source,
  });
  assert.deepEqual(
    result.exports.map(({ layer, name }) => ({ layer, name })),
    [{ layer: "primitives", name: "Button" }],
  );
  const failures = result.violations.join("\n");
  assert.match(failures, /exports primitives\/Button more than once/);
  assert.match(failures, /\.\/components.*explicit/);
  assert.match(failures, /\.\/patterns\/Dialog\/Dialog.*explicit/);
  assert.match(failures, /\.\/internal\/private.*not a public/);
});

test("accepts a public folder with exact implementation, stylesheet, barrel, test and story", () => {
  const directory = resolve(designRoot, "primitives", "Complete");
  createCompleteFolder("packages/client/src/design/primitives/Complete", "Complete");
  const analysis = analyzeDesignPublicFolder(directory);
  assert.deepEqual(analysis.violations, []);
  assert.deepEqual(analysis.publicRuntimeExports, ["Complete"]);
});

test("rejects syntactically present placeholder contract files", () => {
  const path = "packages/client/src/design/components/Placeholder";
  const directory = resolve(designRoot, "components", "Placeholder");
  write(`${path}/index.ts`, "export {};\n");
  write(`${path}/Placeholder.tsx`, "export {};\n");
  write(`${path}/Placeholder.css`, "/* placeholder */\n");
  write(
    `${path}/Placeholder.test.tsx`,
    'import { test } from "vitest";\ntest.todo("write this later");\n',
  );
  write(`${path}/Placeholder.story.tsx`, "export const metadata = {};\n");

  const failures = designPublicFolderViolations(directory).join("\n");
  assert.match(failures, /Placeholder\.css.*neither a CSS declaration/);
  assert.match(failures, /Placeholder\.tsx must import.*Placeholder\.css/);
  assert.match(failures, /Placeholder\.tsx exports no runtime implementation/);
  assert.match(failures, /index\.ts must re-export.*\.\/Placeholder/);
  assert.match(failures, /Placeholder\.test\.tsx must contain an it\/test case/);
  assert.match(failures, /Placeholder\.story\.tsx must export.*callable gallery story/);
});

test("rejects every blank required contract file", () => {
  const path = "packages/client/src/design/components/Blank";
  const directory = resolve(designRoot, "components", "Blank");
  for (const name of ["index.ts", "Blank.tsx", "Blank.css", "Blank.test.tsx", "Blank.story.tsx"]) {
    write(`${path}/${name}`, "");
  }

  const failures = designPublicFolderViolations(directory);
  assert.equal(failures.filter((failure) => /required .* is empty/.test(failure)).length, 5);
});

test("allows explicitly documented CSS inheritance without accepting placeholder comments", () => {
  const path = "packages/client/src/design/primitives/Inherited";
  const directory = resolve(designRoot, "primitives", "Inherited");
  createCompleteFolder(path, "Inherited");
  write(
    `${path}/Inherited.css`,
    "/* Inherited intentionally inherits its control styling from Field. */\n",
  );
  assert.deepEqual(designPublicFolderViolations(directory), []);
});

test("requires the folder barrel to preserve all implementation runtime exports", () => {
  const path = "packages/client/src/design/patterns/RuntimeSurface";
  const directory = resolve(designRoot, "patterns", "RuntimeSurface");
  createCompleteFolder(path, "RuntimeSurface");
  write(
    `${path}/RuntimeSurface.tsx`,
    'import "./RuntimeSurface.css";\nexport function RuntimeSurface() { return null; }\nexport const RUNTIME_LIMIT = 4;\n',
  );
  write(`${path}/index.ts`, 'export { RuntimeSurface } from "./RuntimeSurface";\n');

  const analysis = analyzeDesignPublicFolder(directory);
  assert.deepEqual(analysis.publicRuntimeExports, ["RuntimeSurface"]);
  assert.match(analysis.violations.join("\n"), /index\.ts omits runtime export RUNTIME_LIMIT/);
});

test("accepts aliased vitest cases and callable const stories", () => {
  const path = "packages/client/src/design/patterns/AliasedContract";
  const directory = resolve(designRoot, "patterns", "AliasedContract");
  createCompleteFolder(path, "AliasedContract");
  write(
    `${path}/AliasedContract.test.tsx`,
    'import { test as scenario } from "vitest";\nscenario("works", () => {});\n',
  );
  write(`${path}/AliasedContract.story.tsx`, "export const Default = () => null;\n");
  assert.deepEqual(designPublicFolderViolations(directory), []);
});

test("keeps the physical public folder set equal to the root barrel set", () => {
  const root = resolve(fixtureRoot, "folder-set/design");
  for (const layer of ["primitives", "components", "patterns"]) {
    mkdirSync(resolve(root, layer), { recursive: true });
  }
  mkdirSync(resolve(root, "components", "Exported"), { recursive: true });
  mkdirSync(resolve(root, "components", "Orphan"), { recursive: true });

  const failures = designPublicFolderSetViolations(root, [
    { layer: "components", name: "Exported" },
  ]);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /components\/Orphan.*absent from.*design\/index\.ts/);
});

test("reports every missing colocated public-folder contract", () => {
  const directory = resolve(designRoot, "components", "Incomplete");
  mkdirSync(directory, { recursive: true });
  write("packages/client/src/design/components/Incomplete/notes.md", "not an implementation");
  const failures = designPublicFolderViolations(directory).join("\n");
  assert.match(failures, /missing required Incomplete\.tsx/);
  assert.match(failures, /missing required Incomplete\.css/);
  assert.match(failures, /missing required Incomplete\.test\.tsx/);
  assert.match(failures, /missing required Incomplete\.story\.tsx/);
  assert.match(failures, /missing required index\.ts/);
});

test("requires contract files to match the public folder name", () => {
  const directory = resolve(designRoot, "patterns", "NamedPattern");
  createCompleteFolder("packages/client/src/design/patterns/NamedPattern", "WrongName");
  const failures = designPublicFolderViolations(directory).join("\n");
  for (const suffix of [".tsx", ".css", ".test.tsx", ".story.tsx"]) {
    assert.match(
      failures,
      new RegExp(`missing required NamedPattern${suffix.replaceAll(".", "\\.")}`),
    );
  }
  assert.doesNotMatch(failures, /missing required index\.ts/);
});

test("rejects loose component styles and ignores colocated component styles", () => {
  const loose = write("packages/client/src/design/components/legacy.css", ".legacy {}\n");
  write(
    "packages/client/src/design/components/Colocated/Colocated.css",
    ".Colocated { display: block; }\n",
  );
  const failures = designLooseComponentStyleViolations(designRoot);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /components\/legacy\.css.*owning component folder/);
  rmSync(loose);
});

test("rejects the retired global legacy stylesheet and owner directory", () => {
  const legacyFile = write("packages/client/src/design/internal/legacy.css", ".legacy {}\n");
  const legacyOwner = write(
    "packages/client/src/design/internal/legacy/actions.css",
    ".secondary-action {}\n",
  );
  const failures = designRetiredLegacyViolations(designRoot);
  assert.equal(failures.length, 2);
  assert.match(failures.join("\n"), /internal\/legacy\.css.*forbidden/);
  assert.match(failures.join("\n"), /internal\/legacy.*forbidden/);
  rmSync(legacyOwner);
  rmSync(legacyFile);
  rmSync(resolve(designRoot, "internal", "legacy"), { recursive: true });
});

test("requires the root barrel to preserve every public folder runtime export", () => {
  const root = resolve(fixtureRoot, "runtime-integration");
  for (const path of [
    "packages/client/src/app",
    "packages/client/src/modules",
    "packages/client/src/shared",
    "packages/client/src/design/primitives",
    "packages/client/src/design/patterns",
  ]) {
    mkdirSync(resolve(root, path), { recursive: true });
  }
  write(
    "runtime-integration/packages/client/src/design/index.ts",
    'export { RuntimeSurface } from "./components/RuntimeSurface";\n',
  );
  createCompleteFolder(
    "runtime-integration/packages/client/src/design/components/RuntimeSurface",
    "RuntimeSurface",
  );
  write(
    "runtime-integration/packages/client/src/design/components/RuntimeSurface/RuntimeSurface.tsx",
    'import "./RuntimeSurface.css";\nexport function RuntimeSurface() { return null; }\nexport const RUNTIME_LIMIT = 4;\n',
  );

  const result = checkDesignPublicApi(root);
  assert.equal(result.violations.length, 1);
  assert.match(
    result.violations[0],
    /design\/index\.ts: \.\/components\/RuntimeSurface omits public runtime export RUNTIME_LIMIT/,
  );
});

test("checks product imports, loose styles and all exported folders together", () => {
  const root = resolve(fixtureRoot, "integration");
  mkdirSync(resolve(root, "packages/client/src/shared"), { recursive: true });
  mkdirSync(resolve(root, "packages/client/src/design/patterns"), { recursive: true });
  write(
    "integration/packages/client/src/design/index.ts",
    'export * from "./primitives/Button";\n',
  );
  createCompleteFolder("integration/packages/client/src/design/primitives/Button", "Button");
  write("integration/packages/client/src/design/components/legacy.css", ".legacy {}\n");
  write(
    "integration/packages/client/src/app/App.tsx",
    'import { Button } from "../design"; void Button;',
  );
  write(
    "integration/packages/client/src/modules/editor/Editor.tsx",
    'import { Button } from "../../design/primitives/Button"; void Button;',
  );
  const result = checkDesignPublicApi(root);
  assert.equal(result.productFiles, 2);
  assert.equal(result.exportedFolders, 1);
  assert.equal(result.violations.length, 2);
  assert.match(result.violations.join("\n"), /Editor\.tsx.*deep-imports design internals/);
  assert.match(result.violations.join("\n"), /components\/legacy\.css.*owning component folder/);
});
