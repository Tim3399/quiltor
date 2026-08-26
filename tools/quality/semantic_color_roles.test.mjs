import assert from "node:assert/strict";
import test from "node:test";
import {
  directPaletteRoleAllowlist,
  scanSemanticColorRoleSource,
  scanSemanticColorRoles,
} from "./semantic_color_roles.mjs";

test("accepts semantic component, status, selection and focus roles", () => {
  const source = `
    .selected { border-color: var(--selection-border); }
    .warning { background: var(--warning-bg); color: var(--warning-text); }
    .control:focus-visible { outline: 2px solid var(--focus-ring); }
  `;

  assert.deepEqual(
    scanSemanticColorRoleSource("packages/client/src/modules/example.css", source),
    [],
  );
});

test("rejects direct palette families and legacy focus aliases in product CSS", () => {
  const source = `
    .selected { border-color: var(--gold-border); }
    .error { color: var(--rose-text); }
    .warning { background: var(--copper-soft); }
    .control:focus-visible { outline-color: var(--focus); }
  `;
  const violations = scanSemanticColorRoleSource("packages/client/src/modules/example.css", source);

  assert.deepEqual(
    violations.map(({ variable }) => variable),
    ["--gold-border", "--rose-text", "--copper-soft", "--focus"],
  );
});

test("also rejects direct palette variables in inline TypeScript styles", () => {
  const source = `const style = { color: "var(--gold)" };`;
  const violations = scanSemanticColorRoleSource("packages/client/src/modules/example.tsx", source);

  assert.equal(violations.length, 1);
  assert.equal(violations[0].variable, "--gold");
});

test("keeps visualization exceptions selector- and token-specific", () => {
  const allowed = directPaletteRoleAllowlist[0];
  const accepted = `${allowed.selector} { border-color: var(${allowed.variables[0]}); }`;
  const rejectedSelector = `.selected { border-color: var(${allowed.variables[0]}); }`;
  const rejectedToken = `${allowed.selector} { border-color: var(--moss); }`;

  assert.deepEqual(scanSemanticColorRoleSource(allowed.path, accepted), []);
  assert.equal(scanSemanticColorRoleSource(allowed.path, rejectedSelector).length, 1);
  assert.equal(scanSemanticColorRoleSource(allowed.path, rejectedToken).length, 1);
});

test("every visualization exception documents its narrow purpose", () => {
  for (const entry of directPaletteRoleAllowlist) {
    assert.match(entry.path, /\.css$/);
    assert.ok(entry.selector.length > 0);
    assert.ok(entry.variables.length > 0);
    assert.ok(entry.rationale.length > 0);
  }
});

test("the current product tree has no unapproved direct palette consumers", () => {
  assert.deepEqual(scanSemanticColorRoles(process.cwd()), []);
});
