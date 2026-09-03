import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyzeLayoutGeometry,
  BREAKPOINT_EXCEPTIONS,
  BREAKPOINTS,
  calcExpressions,
} from "./layout_geometry.mjs";

test("laesst jede Kante der Leiter durch", () => {
  for (const value of BREAKPOINTS) {
    assert.deepEqual(
      analyzeLayoutGeometry(`@media (max-width: ${value}px) { .a { top: 0; } }`),
      [],
    );
  }
});

test("meldet eine Kante, die niemand beschlossen hat", () => {
  const violations = analyzeLayoutGeometry("@media (max-width: 733px) { .a { top: 0; } }");

  assert.equal(violations.length, 1);
  assert.match(violations[0], /733px steht nicht auf der Breakpoint-Leiter/);
});

test("schweigt bei einer begruendeten Ausnahme", () => {
  const [value] = Object.keys(BREAKPOINT_EXCEPTIONS);

  assert.deepEqual(analyzeLayoutGeometry(`@media (max-width: ${value}px) { .a { top: 0; } }`), []);
});

test("prueft auch min-width und mehrteilige Queries", () => {
  const violations = analyzeLayoutGeometry(
    "@media (min-width: 733px) and (max-height: 520px) { .a { top: 0; } }",
  );

  assert.equal(violations.length, 1);
  assert.match(violations[0], /^min-width: 733px/);
});

test("liest verschachtelte calc-Klammern vollstaendig", () => {
  assert.deepEqual(calcExpressions("width: calc(min(100vw, 40px) - var(--a));"), [
    "calc(min(100vw, 40px) - var(--a))",
  ]);
});

test("meldet eine halb benannte Rechnung", () => {
  const violations = analyzeLayoutGeometry(".a { max-height: calc(100vh - var(--bar) - 56px); }");

  assert.equal(violations.length, 1);
  assert.match(violations[0], /mischt benannte und unbenannte Geometrie \(56px\)/);
});

test("laesst optische Kleinstwerte und reine Rechnungen in Ruhe", () => {
  assert.deepEqual(
    analyzeLayoutGeometry(
      ".a { inset: calc(var(--bar) - 2px); width: calc(100% - 64px); height: calc(var(--a) - var(--b)); }",
    ),
    [],
  );
});
