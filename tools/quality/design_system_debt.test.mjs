import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import {
  analyzeDesignSystemDebtSource,
  closeDesignSystemDebtParser,
  compareDesignSystemDebt,
  createDesignSystemDebtManifest,
  designSystemDebtBaselineUpdateCommand,
  designSystemDebtManifestViolations,
  designSystemDebtParserContract,
  discoverDesignSystemDebtFiles,
  formatDesignSystemDebtReport,
  parseDesignSystemDebtManifest,
  scanDesignSystemDebt,
  serializeDesignSystemDebtManifest,
} from "./design_system_debt.mjs";

const fixtureRoot = mkdtempSync(join(tmpdir(), "quiltor-design-system-debt-"));
const sourceRoot = resolve(fixtureRoot, "source-fixtures");
let fixtureSequence = 0;

after(() => {
  closeDesignSystemDebtParser();
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function write(path, source) {
  const file = resolve(fixtureRoot, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source, "utf8");
  return file;
}

function analyze(source, extension = ".tsx") {
  fixtureSequence += 1;
  const file = resolve(sourceRoot, `Fixture${fixtureSequence}${extension}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source, "utf8");
  return analyzeDesignSystemDebtSource({ file, source });
}

function manifest(files) {
  return createDesignSystemDebtManifest(files);
}

test("pins the shipped TypeScript AST parser used by the debt inventory", () => {
  assert.deepEqual(designSystemDebtParserContract, {
    package: "typescript",
    version: "7.0.2",
    api: "typescript/unstable/sync",
  });
});

test("counts intrinsic JSX controls through the TypeScript AST, not comments or string text", () => {
  const debt = analyze(`
    const example = "<button><input /></button>";
    // <select><textarea /></select>
    const Button = ({ children }) => <section>{children}</section>;
    export function Fixture() {
      return <>
        <button type="button">Save</button>
        <input />
        <select><option>One</option></select>
        <textarea />
        <Button><span>Custom component</span></Button>
      </>;
    }
  `);
  assert.deepEqual(debt, {
    controls: { button: 1, input: 1, select: 1, textarea: 1 },
  });
});

test("counts each direct legacy token once per className across literal expression shapes", () => {
  const debt = analyze(`
    const ignored = "primary field icon-button ui-button";
    export function Fixture({ active }) {
      return <>
        <div className="ui-button primary primary" />
        <div className={"icon-button field-note"} />
        <div className={\`field \${active ? "primary" : ""}\`} />
        <div className={cx("ui-button", { "icon-button": active })} />
        <div className={cx({ primary: active, field: active })} />
        <div className="primary-action custom-field" />
      </>;
    }
  `);
  assert.deepEqual(debt, {
    legacyClasses: { "ui-button": 2, "icon-button": 2, primary: 3, field: 2 },
  });
});

test("counts retired composition recipes that must be expressed by public design components", () => {
  const debt = analyze(`
    export function Fixture() {
      return <>
        <header className="context-bar panel-heading" />
        <div className={"context-tools tool-group"} />
        <aside className={\`inspector \${true ? "panel-body" : ""}\`} />
        <p className="empty-message muted" />
      </>;
    }
  `);
  assert.deepEqual(debt, {
    legacyClasses: {
      "empty-message": 1,
      inspector: 1,
      "panel-heading": 1,
      "panel-body": 1,
      "context-bar": 1,
      "context-tools": 1,
      "tool-group": 1,
    },
  });
});

test("fails closed when TypeScript cannot parse a source fixture", () => {
  assert.throws(() => analyze("export const Broken = () => <button>;"), /syntax errors/);
});

test("discovers productive TS and TSX files below app, modules and shared", () => {
  write("packages/client/src/app/App.tsx", "export const App = () => <button />;");
  write("packages/client/src/app/App.test.tsx", "export const Test = () => <button />;");
  write("packages/client/src/app/App.spec.ts", "export const spec = true;");
  write(
    "packages/client/src/modules/editor/Editor.testSupport.tsx",
    "export const Support = () => <input />;",
  );
  write(
    "packages/client/src/modules/editor/__tests__/Editor.tsx",
    "export const Test = () => <select />;",
  );
  write("packages/client/src/modules/editor/model.ts", "export const model = true;");
  write(
    "packages/client/src/modules/editor/Legacy.jsx",
    "export const Legacy = () => <textarea />;",
  );
  write("packages/client/src/shared/Outside.tsx", "export const Outside = () => <button />;");

  const files = discoverDesignSystemDebtFiles(fixtureRoot).map((file) =>
    file.replaceAll("\\", "/").replace(`${fixtureRoot.replaceAll("\\", "/")}/`, ""),
  );
  assert.deepEqual(files, [
    "packages/client/src/app/App.tsx",
    "packages/client/src/modules/editor/model.ts",
    "packages/client/src/shared/Outside.tsx",
  ]);
  assert.deepEqual(scanDesignSystemDebt(fixtureRoot).files, {
    "packages/client/src/app/App.tsx": { controls: { button: 1 } },
    "packages/client/src/shared/Outside.tsx": { controls: { button: 1 } },
  });
});

test("allows the exact checked-in per-file ceiling", () => {
  const baseline = manifest({
    "packages/client/src/app/App.tsx": {
      controls: { button: 2 },
      legacyClasses: { primary: 1 },
    },
  });
  assert.deepEqual(compareDesignSystemDebt({ baseline, current: structuredClone(baseline) }), {
    ok: true,
    increases: [],
    reductions: [],
  });
});

test("rejects increases and debt in files absent from the baseline by category", () => {
  const baseline = manifest({
    "packages/client/src/app/App.tsx": { controls: { button: 1 } },
  });
  const current = manifest({
    "packages/client/src/app/App.tsx": {
      controls: { button: 2 },
      legacyClasses: { primary: 1 },
    },
    "packages/client/src/modules/new/NewPanel.tsx": {
      controls: { input: 1 },
      legacyClasses: { field: 1 },
    },
  });
  const result = compareDesignSystemDebt({ baseline, current });
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.increases.map(({ file, category, name, allowed, actual, newFile }) => ({
      file,
      category,
      name,
      allowed,
      actual,
      newFile,
    })),
    [
      {
        file: "packages/client/src/app/App.tsx",
        category: "controls",
        name: "button",
        allowed: 1,
        actual: 2,
        newFile: false,
      },
      {
        file: "packages/client/src/app/App.tsx",
        category: "legacyClasses",
        name: "primary",
        allowed: 0,
        actual: 1,
        newFile: false,
      },
      {
        file: "packages/client/src/modules/new/NewPanel.tsx",
        category: "controls",
        name: "input",
        allowed: 0,
        actual: 1,
        newFile: true,
      },
      {
        file: "packages/client/src/modules/new/NewPanel.tsx",
        category: "legacyClasses",
        name: "field",
        allowed: 0,
        actual: 1,
        newFile: true,
      },
    ],
  );
});

test("requires a baseline update for reductions so removed debt cannot grow back", () => {
  const baseline = manifest({
    "packages/client/src/modules/editor/Panel.tsx": {
      controls: { button: 2 },
      legacyClasses: { primary: 1 },
    },
  });
  const current = manifest({
    "packages/client/src/modules/editor/Panel.tsx": { controls: { button: 1 } },
  });
  const result = compareDesignSystemDebt({ baseline, current });
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.reductions.map(({ category, name, allowed, actual }) => ({
      category,
      name,
      allowed,
      actual,
    })),
    [
      { category: "controls", name: "button", allowed: 2, actual: 1 },
      { category: "legacyClasses", name: "primary", allowed: 1, actual: 0 },
    ],
  );
  const report = formatDesignSystemDebtReport(result);
  assert.match(report, /\[Baseline aktualisieren\]/);
  assert.match(report, new RegExp(designSystemDebtBaselineUpdateCommand.replaceAll(".", "\\.")));
});

test("treats a removed debt file as a baseline reduction", () => {
  const baseline = manifest({
    "packages/client/src/modules/editor/OldPanel.tsx": { controls: { textarea: 1 } },
  });
  const result = compareDesignSystemDebt({ baseline, current: manifest({}) });
  assert.deepEqual(result.reductions, [
    {
      file: "packages/client/src/modules/editor/OldPanel.tsx",
      category: "controls",
      name: "textarea",
      allowed: 1,
      actual: 0,
      newFile: false,
    },
  ]);
});

test("normalizes manifest order, removes zero allowances, and validates malformed debt", () => {
  const normalized = manifest({
    "packages/client/src/modules/z/Z.tsx": {
      controls: { button: 0, textarea: 1 },
    },
    "packages/client/src/app/A.tsx": { legacyClasses: { field: 1 } },
    "packages/client/src/app/Clean.tsx": { controls: { button: 0 } },
  });
  assert.deepEqual(Object.keys(normalized.files), [
    "packages/client/src/app/A.tsx",
    "packages/client/src/modules/z/Z.tsx",
  ]);
  const invalid = structuredClone(normalized);
  invalid.files["packages/client/src/modules/z/Z.tsx"].controls.button = 0;
  invalid.files["packages/client/src/modules/z/Z.tsx"].legacyClasses = { invented: 1 };
  const violations = designSystemDebtManifestViolations(invalid).join("\n");
  assert.match(violations, /controls\.button must be a positive integer/);
  assert.match(violations, /unknown legacyClasses item invented/);
});

test("serializes a deterministic, Biome-compatible manifest that round-trips", () => {
  const current = manifest({
    "packages/client/src/app/App.tsx": {
      controls: { button: 1 },
      legacyClasses: { primary: 1 },
    },
  });
  const serialized = serializeDesignSystemDebtManifest(current);
  assert.match(
    serialized,
    /"roots": \[\s*"packages\/client\/src\/app",\s*"packages\/client\/src\/modules",\s*"packages\/client\/src\/shared"\s*\]/,
  );
  assert.deepEqual(JSON.parse(serialized), current);
  assert.equal(serialized.endsWith("\n"), true);
});

test("keeps the checked-in baseline in its canonical generated representation", () => {
  const path = resolve(process.cwd(), "tools", "quality", "design-system-debt-baseline.json");
  const source = readFileSync(path, "utf8");
  assert.equal(serializeDesignSystemDebtManifest(parseDesignSystemDebtManifest(source)), source);
});
