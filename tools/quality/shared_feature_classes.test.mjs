import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classNamesInSource,
  definedClasses,
  missingGeometryNotes,
  scanSharedFeatureClasses,
  SHARED_FEATURE_CLASSES,
} from "./shared_feature_classes.mjs";

test("reads classes out of a plain className", () => {
  const used = classNamesInSource('<div className="figure-layout has-selection" />');

  assert.ok(used.has("figure-layout"));
  assert.ok(used.has("has-selection"));
});

test("finds the class in a template literal too", () => {
  const source = "<div className={`figure-layout ${offen ? 'is-open' : ''}`} />";

  assert.ok(classNamesInSource(source).has("figure-layout"));
});

test("does not count words outside className", () => {
  const source = 'const style = "dashed";' + String.fromCharCode(10) + '<div className="edge" />';
  const used = classNamesInSource(source);

  assert.ok(used.has("edge"));
  assert.ok(!used.has("dashed"));
});

test("picks up every class of a stylesheet", () => {
  const found = definedClasses(".figure-layout > .side-panel:hover { top: 0; }");

  assert.deepEqual([...found].sort(), ["figure-layout", "side-panel"]);
});

test("the register explains every class in one sentence", () => {
  for (const [name, reason] of Object.entries(SHARED_FEATURE_CLASSES)) {
    assert.ok(reason.length > 20, `${name} needs a reason, not a placeholder`);
  }
});

test("the tree shares nothing unregistered", () => {
  assert.deepEqual(scanSharedFeatureClasses(process.cwd()), []);
});

test("demands a note above shared geometry", () => {
  const source = ".figure-layout {\n  grid-template-columns: 1fr 340px;\n}";

  assert.deepEqual(missingGeometryNotes(source, "figure-layout"), [1]);
});

test("stays silent once the note is above it", () => {
  const source = "/* Figures and places share this. */\n.figure-layout {\n  width: 100%;\n}";

  assert.deepEqual(missingGeometryNotes(source, "figure-layout"), []);
});

test("lets colour and type through without a note", () => {
  const source = ".importance-mark {\n  color: var(--ink);\n}";

  assert.deepEqual(missingGeometryNotes(source, "importance-mark"), []);
});

test("checks only the unqualified selector", () => {
  const source = ".figure-workspace .figure-layout {\n  grid-template-columns: 232px 1fr;\n}";

  assert.deepEqual(missingGeometryNotes(source, "figure-layout"), []);
});
