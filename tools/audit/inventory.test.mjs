import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { buildInventory } from "./inventory.mjs";

const SRC = "packages/client/src";

function withFixture(files, run) {
  const root = mkdtempSync(join(tmpdir(), "inventory-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      const path = join(root, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Inventory of a single module `app/Probe.tsx` holding `body`. */
function inventoryOf(body) {
  return withFixture({ [`${SRC}/app/Probe.tsx`]: body }, (root) => buildInventory(root));
}

function patternsOf(body) {
  return inventoryOf(body).flatMap((item) => item.patterns);
}

for (const tag of [
  "Menu",
  "MenuItem",
  "MenuSubmenu",
  "DropdownMenu",
  "ContextMenu",
  "SelectionMenu",
  "Popover",
  "Sheet",
  "AdaptivePanel",
  "ListboxSelect",
  "CommandPalette",
  "ConfirmDialog",
  "SearchDialog",
  "Dialog",
]) {
  test(`finds JSX usage of <${tag}>`, () => {
    const items = inventoryOf(
      `export function Probe() { return <${tag} open onClose={close} />; }`,
    );
    assert.deepEqual(items, [
      { component: "Probe", file: `${SRC}/app/Probe.tsx`, patterns: [tag] },
    ]);
  });

  test(`finds <${tag}> with children and no attributes`, () => {
    assert.deepEqual(patternsOf(`export function Probe() { return <${tag}>x</${tag}>; }`), [tag]);
  });
}

test("finds createPortal calls, including the react-dom member form", () => {
  assert.deepEqual(
    patternsOf("export function A() { return createPortal(node, document.body); }"),
    ["createPortal"],
  );
  assert.deepEqual(
    patternsOf("export function A() { return ReactDOM.createPortal(node, host); }"),
    ["createPortal"],
  );
});

for (const role of ["menu", "listbox", "dialog"]) {
  test(`finds role="${role}" in JSX`, () => {
    assert.deepEqual(patternsOf(`export function A() { return <div role="${role}" />; }`), [
      `role=${role}`,
    ]);
  });
}

test("finds a role inside a JSX expression", () => {
  assert.deepEqual(
    patternsOf(`export function A() { return <div role={open ? "menu" : undefined} />; }`),
    ["role=menu"],
  );
});

test("ignores roles that are not menu, listbox or dialog", () => {
  assert.deepEqual(
    patternsOf(`export function A() { return <div role="button" role2="menu" />; }`),
    [],
  );
});

test("ignores a role in an object literal that is not a JSX attribute", () => {
  assert.deepEqual(patternsOf(`export const roles = { role: "menu" };`), []);
});

test("ignores popup words in comments and strings", () => {
  const source = [
    "// <ConfirmDialog /> is documented here",
    '/* <Popover> and createPortal( and role="menu" */',
    'const label = "<Sheet> opens a Dialog";',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source text that the scanner must read as a template literal
    "const text = `<MenuItem> ${1} createPortal(x)`;",
    "export function Quiet() { return <p>{label}</p>; }",
  ].join("\n");
  assert.deepEqual(inventoryOf(source), []);
});

test("still finds code inside a template substitution", () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source text that the scanner must read as a template literal
  const source = "export function A() { return `${createPortal(x, y)}`; }";
  assert.deepEqual(patternsOf(source), ["createPortal"]);
});

test("ignores type imports and type annotations", () => {
  const source = [
    'import type { ConfirmDialog, Popover } from "../design";',
    'import { DropdownMenu } from "../design";',
    "type Props = { dialog: ConfirmDialog; menu: Array<Popover> };",
    "export function Quiet() { const [d] = useState<SearchDialog>(); return <p>{String(d)}</p>; }",
  ].join("\n");
  assert.deepEqual(inventoryOf(source), []);
});

test("does not count a definition without a usage", () => {
  const source = [
    "export function Dialog(props) { return <section>{props.children}</section>; }",
    "export const Menu = forwardRef(function Menu(props, ref) { return <ul ref={ref} />; });",
  ].join("\n");
  assert.deepEqual(inventoryOf(source), []);
});

test("does not match look-alike tag names", () => {
  const source = [
    "export function A() {",
    "  return <><MenuBar /><Sheets /><PopoverArrow /><DialogHeading /><Dialogs /></>;",
    "}",
  ].join("\n");
  assert.deepEqual(inventoryOf(source), []);
});

test("an apostrophe in JSX text does not swallow the rest of the module", () => {
  const source = [
    "export function A() { return <p>Don't panic</p>; }",
    "export function B() { return <Popover />; }",
  ].join("\n");
  assert.deepEqual(inventoryOf(source), [
    { component: "B", file: `${SRC}/app/Probe.tsx`, patterns: ["Popover"] },
  ]);
});

test("reports one item per component when a file holds several", () => {
  const source = [
    "export function First() { return <DropdownMenu />; }",
    'export const Second = () => <div role="menu"><Popover /></div>;',
    "function Third() { return <p>plain</p>; }",
  ].join("\n");
  assert.deepEqual(inventoryOf(source), [
    { component: "First", file: `${SRC}/app/Probe.tsx`, patterns: ["DropdownMenu"] },
    { component: "Second", file: `${SRC}/app/Probe.tsx`, patterns: ["Popover", "role=menu"] },
  ]);
});

test("attributes a hit inside a nested helper to the enclosing top-level component", () => {
  const source = [
    "export function Outer() {",
    "  const renderRow = () => <ContextMenu />;",
    "  return <ul>{renderRow()}</ul>;",
    "}",
  ].join("\n");
  assert.deepEqual(inventoryOf(source), [
    { component: "Outer", file: `${SRC}/app/Probe.tsx`, patterns: ["ContextMenu"] },
  ]);
});

test("patterns are sorted and unique", () => {
  const source = [
    "export function A() {",
    '  return <div role="menu"><Popover /><Popover /><DropdownMenu />{createPortal(x, y)}</div>;',
    "}",
  ].join("\n");
  assert.deepEqual(inventoryOf(source)[0].patterns, [
    "DropdownMenu",
    "Popover",
    "createPortal",
    "role=menu",
  ]);
});

test("searches app, modules and shared only, and skips test, support and story files", () => {
  const usage = "export function X() { return <Popover />; }";
  const items = withFixture(
    {
      [`${SRC}/app/B.tsx`]: usage,
      [`${SRC}/modules/deep/nested/A.tsx`]: usage.replace("X", "Deep"),
      [`${SRC}/shared/C.ts`]: "export function Plain() { return createPortal(a, b); }",
      [`${SRC}/design/Own.tsx`]: usage,
      [`${SRC}/config/Own.tsx`]: usage,
      [`${SRC}/app/B.test.tsx`]: usage,
      [`${SRC}/app/B.testSupport.tsx`]: usage,
      [`${SRC}/app/B.stories.tsx`]: usage,
      [`${SRC}/app/readme.md`]: "<Popover />",
    },
    (root) => buildInventory(root),
  );
  assert.deepEqual(
    items.map((item) => `${item.file}#${item.component}`),
    [`${SRC}/app/B.tsx#X`, `${SRC}/modules/deep/nested/A.tsx#Deep`, `${SRC}/shared/C.ts#Plain`],
  );
});

test("sorts by file, then by component, deterministically", () => {
  const items = withFixture(
    {
      [`${SRC}/shared/z.tsx`]: "export function Z() { return <Popover />; }",
      [`${SRC}/app/b.tsx`]: [
        "export function Beta() { return <Sheet />; }",
        "export function Alpha() { return <Sheet />; }",
      ].join("\n"),
      [`${SRC}/app/a.tsx`]: "export function Only() { return <Sheet />; }",
    },
    (root) => buildInventory(root),
  );
  assert.deepEqual(
    items.map((item) => `${item.file}#${item.component}`),
    [
      `${SRC}/app/a.tsx#Only`,
      `${SRC}/app/b.tsx#Alpha`,
      `${SRC}/app/b.tsx#Beta`,
      `${SRC}/shared/z.tsx#Z`,
    ],
  );
});

test("a missing search root is not an error", () => {
  assert.deepEqual(
    withFixture({ [`${SRC}/app/Quiet.tsx`]: "export const a = 1;" }, (root) =>
      buildInventory(root),
    ),
    [],
  );
});
