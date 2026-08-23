import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { after, test } from "node:test";
import {
  analyzeCssDesignDebtSource,
  compareCssDesignDebt,
  createCssDesignDebtManifest,
  cssDesignDebtBaselineUpdateCommand,
  cssDesignDebtManifestViolations,
  discoverCssDesignDebtFiles,
  formatCssDesignDebtReport,
  parseCssDesignDebtManifest,
  scanCssDesignDebt,
  serializeCssDesignDebtManifest,
} from "./css_design_debt.mjs";

const fixtureRoot = mkdtempSync(resolve(tmpdir(), "quiltor-css-design-debt-"));

after(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function write(path, source) {
  const file = resolve(fixtureRoot, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source, "utf8");
  return file;
}

function analyze(source) {
  return analyzeCssDesignDebtSource({ file: "Fixture.css", source });
}

function manifest(files) {
  return createCssDesignDebtManifest(files);
}

test("counts exact native types and owner classes once per selector branch", () => {
  const debt = analyze(String.raw`
    button button.ui-button,
    svg|input,
    *|select,
    button|*,
    button||textarea,
    \62 utton,
    .ui\2d button,
    .icon-button.icon-button,
    .ui-field {
      color: red;
    }

    BUTTON, .UI-BUTTON, .button, #input, [class~="icon-button"], [type="button"] {
      content: "button .ui-button";
    }
    /* textarea, .ui-field { color: red; } */
  `);

  assert.deepEqual(debt, {
    nativeTypeSelectors: { button: 4, input: 1, select: 1, textarea: 1 },
    designOwnerOverrides: { "ui-button": 2, "icon-button": 1, "ui-field": 1 },
  });
});

test("attributes BEM element and modifier selectors to their design owner", () => {
  const debt = analyze(`
    .ui-button--primary .ui-button__label,
    .ui-checkbox__control,
    .ui-toolbar-button.is-active,
    .selection-card--selected .selection-card__title {
      color: red;
    }
  `);

  assert.deepEqual(debt, {
    designOwnerOverrides: {
      "ui-button": 1,
      "ui-checkbox": 1,
      "ui-toolbar-button": 1,
      "selection-card": 1,
    },
  });
});

test("understands selector-list pseudos without treating arbitrary function arguments as selectors", () => {
  const debt = analyze(`
    :is(button, input).ui-button,
    .wrapper > textarea:not(.icon-button),
    select:lang(button),
    :where(.ui-field, button) {
      color: red;
    }
  `);

  assert.deepEqual(debt, {
    nativeTypeSelectors: { button: 2, input: 1, select: 1, textarea: 1 },
    designOwnerOverrides: { "ui-button": 1, "icon-button": 1, "ui-field": 1 },
  });
});

test("recurses through grouping at-rules but ignores at-rule preludes and keyframes", () => {
  const debt = analyze(`
    @supports selector(button) {
      @media (min-width: 1px) {
        .panel > button, .panel.ui-field { color: red; }
      }
    }
    @font-face { font-family: "input"; src: url("select.woff2"); }
    @page :left { margin: 1cm; }
    @keyframes button {
      from { content: ".icon-button"; }
      to { opacity: 1; }
    }
  `);

  assert.deepEqual(debt, {
    nativeTypeSelectors: { button: 1 },
    designOwnerOverrides: { "ui-field": 1 },
  });
});

test("handles nested CSS rules, nested media, @nest, and block-valued custom properties", () => {
  const debt = analyze(`
    .card {
      color /**/: red;
      --tokens: { button: ".ui-button"; };
      & > button, &:has(input) { color: blue; }
      @media (min-width: 1px) {
        & .ui-field { color: green; }
      }
      @nest & > select.icon-button { color: purple; }
    }
  `);

  assert.deepEqual(debt, {
    nativeTypeSelectors: { button: 1, input: 1, select: 1 },
    designOwnerOverrides: { "icon-button": 1, "ui-field": 1 },
  });
});

test("fails closed on malformed or unsupported CSS instead of returning a partial inventory", () => {
  const fixtures = [
    ["unterminated comment", "button { color: red; /*"],
    ["unterminated string", 'button { content: "input; }'],
    ["unterminated style block", "button { color: red;"],
    ["unterminated (", ":is(button, input { color: red; }"],
    ["empty selector", "button, /**/ { color: red; }"],
    ["unsupported block at-rule", "@unknown button { .icon-button { color: red; } }"],
    ["style-block statement is not a declaration", ".card { definitely-not-a-declaration; }"],
  ];
  for (const [message, source] of fixtures) {
    assert.throws(() => analyze(source), new RegExp(message.replace(/[()]/gu, "\\$&")));
  }
});

test("discovers productive CSS below app, modules and shared", () => {
  write("packages/client/src/app/App.css", "button { color: red; }");
  write("packages/client/src/app/App.test.css", "input { color: red; }");
  write("packages/client/src/app/App.story.css", "select { color: red; }");
  write("packages/client/src/modules/editor/Editor.css", ".ui-button { color: red; }");
  write("packages/client/src/modules/editor/Editor.spec.css", "textarea { color: red; }");
  write("packages/client/src/modules/editor/__tests__/Fixture.css", "button { color: red; }");
  write("packages/client/src/modules/editor/model.ts", "export const model = true;");
  write("packages/client/src/shared/ui/Shared.css", ".selection-card__title { color: red; }");
  write("packages/client/src/design/Outside.css", "button { color: red; }");

  const files = discoverCssDesignDebtFiles(fixtureRoot).map((file) =>
    file.replaceAll("\\", "/").replace(`${fixtureRoot.replaceAll("\\", "/")}/`, ""),
  );
  assert.deepEqual(files, [
    "packages/client/src/app/App.css",
    "packages/client/src/modules/editor/Editor.css",
    "packages/client/src/shared/ui/Shared.css",
  ]);
  assert.deepEqual(scanCssDesignDebt(fixtureRoot).files, {
    "packages/client/src/app/App.css": { nativeTypeSelectors: { button: 1 } },
    "packages/client/src/modules/editor/Editor.css": {
      designOwnerOverrides: { "ui-button": 1 },
    },
    "packages/client/src/shared/ui/Shared.css": {
      designOwnerOverrides: { "selection-card": 1 },
    },
  });
});

test("allows only the exact checked-in per-file CSS ceiling", () => {
  const baseline = manifest({
    "packages/client/src/app/App.css": {
      nativeTypeSelectors: { button: 2 },
      designOwnerOverrides: { "ui-button": 1 },
    },
  });
  assert.deepEqual(compareCssDesignDebt({ baseline, current: structuredClone(baseline) }), {
    ok: true,
    increases: [],
    reductions: [],
  });
});

test("rejects increases and debt in files absent from the CSS baseline", () => {
  const baseline = manifest({
    "packages/client/src/app/App.css": { nativeTypeSelectors: { button: 1 } },
  });
  const current = manifest({
    "packages/client/src/app/App.css": {
      nativeTypeSelectors: { button: 2 },
      designOwnerOverrides: { "ui-button": 1 },
    },
    "packages/client/src/modules/new/NewPanel.css": {
      nativeTypeSelectors: { input: 1 },
      designOwnerOverrides: { "ui-field": 1 },
    },
  });

  const result = compareCssDesignDebt({ baseline, current });
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
        file: "packages/client/src/app/App.css",
        category: "nativeTypeSelectors",
        name: "button",
        allowed: 1,
        actual: 2,
        newFile: false,
      },
      {
        file: "packages/client/src/app/App.css",
        category: "designOwnerOverrides",
        name: "ui-button",
        allowed: 0,
        actual: 1,
        newFile: false,
      },
      {
        file: "packages/client/src/modules/new/NewPanel.css",
        category: "nativeTypeSelectors",
        name: "input",
        allowed: 0,
        actual: 1,
        newFile: true,
      },
      {
        file: "packages/client/src/modules/new/NewPanel.css",
        category: "designOwnerOverrides",
        name: "ui-field",
        allowed: 0,
        actual: 1,
        newFile: true,
      },
    ],
  );
});

test("requires an explicit baseline update for reductions and removed CSS debt files", () => {
  const baseline = manifest({
    "packages/client/src/modules/editor/Panel.css": {
      nativeTypeSelectors: { textarea: 2 },
      designOwnerOverrides: { "icon-button": 1 },
    },
  });
  const result = compareCssDesignDebt({ baseline, current: manifest({}) });
  assert.deepEqual(
    result.reductions.map(({ category, name, allowed, actual }) => ({
      category,
      name,
      allowed,
      actual,
    })),
    [
      { category: "nativeTypeSelectors", name: "textarea", allowed: 2, actual: 0 },
      { category: "designOwnerOverrides", name: "icon-button", allowed: 1, actual: 0 },
    ],
  );
  const report = formatCssDesignDebtReport(result);
  assert.match(report, /\[Baseline aktualisieren\]/u);
  assert.match(report, new RegExp(cssDesignDebtBaselineUpdateCommand.replaceAll(".", "\\.")));
});

test("normalizes and strictly validates the deterministic CSS manifest", () => {
  const normalized = manifest({
    "packages/client/src/modules/z/Z.css": {
      nativeTypeSelectors: { button: 0, textarea: 1 },
    },
    "packages/client/src/app/A.css": { designOwnerOverrides: { "ui-field": 1 } },
    "packages/client/src/app/Clean.css": { nativeTypeSelectors: { button: 0 } },
  });
  assert.deepEqual(Object.keys(normalized.files), [
    "packages/client/src/app/A.css",
    "packages/client/src/modules/z/Z.css",
  ]);
  const invalid = structuredClone(normalized);
  invalid.files["packages/client/src/modules/z/Z.css"].nativeTypeSelectors.button = 0;
  invalid.files["packages/client/src/modules/z/Z.css"].designOwnerOverrides = { invented: 1 };
  const violations = cssDesignDebtManifestViolations(invalid).join("\n");
  assert.match(violations, /nativeTypeSelectors\.button must be a positive integer/u);
  assert.match(violations, /unknown designOwnerOverrides item invented/u);

  const serialized = serializeCssDesignDebtManifest(normalized);
  assert.match(
    serialized,
    /"roots": \[\s*"packages\/client\/src\/app",\s*"packages\/client\/src\/modules",\s*"packages\/client\/src\/shared"\s*\]/u,
  );
  assert.deepEqual(JSON.parse(serialized), normalized);
  assert.equal(serialized.endsWith("\n"), true);
});

test("keeps the checked-in CSS baseline in its canonical generated representation", () => {
  const path = resolve(process.cwd(), "tools", "quality", "css-design-debt-baseline.json");
  const source = readFileSync(path, "utf8");
  assert.equal(serializeCssDesignDebtManifest(parseCssDesignDebtManifest(source)), source);
});
