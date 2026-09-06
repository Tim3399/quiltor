import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classNamesInSource,
  definedClasses,
  missingGeometryNotes,
  scanSharedFeatureClasses,
  SHARED_FEATURE_CLASSES,
} from "./shared_feature_classes.mjs";

test("liest Klassen aus einem einfachen className", () => {
  const used = classNamesInSource('<div className="figure-layout has-selection" />');

  assert.ok(used.has("figure-layout"));
  assert.ok(used.has("has-selection"));
});

test("findet auch die Klasse in einem Template-Literal", () => {
  const source = "<div className={`figure-layout ${offen ? 'is-open' : ''}`} />";

  assert.ok(classNamesInSource(source).has("figure-layout"));
});

test("zaehlt Woerter ausserhalb von className nicht mit", () => {
  const source = 'const stil = "dashed";' + String.fromCharCode(10) + '<div className="kante" />';
  const used = classNamesInSource(source);

  assert.ok(used.has("kante"));
  assert.ok(!used.has("dashed"));
});

test("nimmt jede Klasse eines Stylesheets auf", () => {
  const found = definedClasses(".figure-layout > .side-panel:hover { top: 0; }");

  assert.deepEqual([...found].sort(), ["figure-layout", "side-panel"]);
});

test("das Verzeichnis erklaert jede Klasse in einem Satz", () => {
  for (const [name, reason] of Object.entries(SHARED_FEATURE_CLASSES)) {
    assert.ok(reason.length > 20, `${name} braucht einen Grund, keinen Platzhalter`);
  }
});

test("der Baum teilt nichts Unangemeldetes", () => {
  assert.deepEqual(scanSharedFeatureClasses(process.cwd()), []);
});

test("verlangt einen Hinweis ueber geteilter Geometrie", () => {
  const source = ".figure-layout {\n  grid-template-columns: 1fr 340px;\n}";

  assert.deepEqual(missingGeometryNotes(source, "figure-layout"), [1]);
});

test("schweigt, sobald der Hinweis darueber steht", () => {
  const source = "/* Figuren und Orte teilen sich das. */\n.figure-layout {\n  width: 100%;\n}";

  assert.deepEqual(missingGeometryNotes(source, "figure-layout"), []);
});

test("laesst Farbe und Schrift ohne Hinweis durch", () => {
  const source = ".importance-mark {\n  color: var(--ink);\n}";

  assert.deepEqual(missingGeometryNotes(source, "importance-mark"), []);
});

test("prueft nur den unqualifizierten Selektor", () => {
  const source = ".figure-workspace .figure-layout {\n  grid-template-columns: 232px 1fr;\n}";

  assert.deepEqual(missingGeometryNotes(source, "figure-layout"), []);
});
