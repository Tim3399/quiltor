import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyzeLayoutGeometry,
  BREAKPOINT_EXCEPTIONS,
  BREAKPOINTS,
  calcExpressions,
} from "./layout_geometry.mjs";

test("lets every edge of the ladder through", () => {
  for (const value of BREAKPOINTS) {
    assert.deepEqual(
      analyzeLayoutGeometry(`@media (max-width: ${value}px) { .a { top: 0; } }`),
      [],
    );
  }
});

test("reports an edge nobody decided on", () => {
  const violations = analyzeLayoutGeometry("@media (max-width: 733px) { .a { top: 0; } }");

  assert.equal(violations.length, 1);
  assert.match(violations[0], /733px is not on the breakpoint ladder/);
});

test("stays silent on an exception that has a reason", () => {
  const [value] = Object.keys(BREAKPOINT_EXCEPTIONS);

  assert.deepEqual(analyzeLayoutGeometry(`@media (max-width: ${value}px) { .a { top: 0; } }`), []);
});

test("checks min-width and multi-part queries too", () => {
  const violations = analyzeLayoutGeometry(
    "@media (min-width: 733px) and (max-height: 520px) { .a { top: 0; } }",
  );

  assert.equal(violations.length, 1);
  assert.match(violations[0], /^min-width: 733px/);
});

test("reads nested calc parentheses in full", () => {
  assert.deepEqual(calcExpressions("width: calc(min(100vw, 40px) - var(--a));"), [
    "calc(min(100vw, 40px) - var(--a))",
  ]);
});

test("reports a half-named calculation", () => {
  const violations = analyzeLayoutGeometry(".a { max-height: calc(100vh - var(--bar) - 56px); }");

  assert.equal(violations.length, 1);
  assert.match(violations[0], /mixes named and unnamed geometry \(56px\)/);
});

test("leaves optical hairlines and pure calculations alone", () => {
  assert.deepEqual(
    analyzeLayoutGeometry(
      ".a { inset: calc(var(--bar) - 2px); width: calc(100% - 64px); height: calc(var(--a) - var(--b)); }",
    ),
    [],
  );
});
