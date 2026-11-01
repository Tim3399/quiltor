import assert from "node:assert/strict";
import { test } from "node:test";
import { FORBIDDEN_SPELLINGS, findForbiddenSpellings, stringsInSource } from "./term_spelling.mjs";

// One row per rule: a wrong spelling that must be found and a correct one that must not.
const EXAMPLES = [
  ["Massstab von Karte", "Maßstab von Karte"],
  ["Massstabsleiste", "Maßstabsleiste"],
  ["Grösse ändern", "Größe ändern"],
  ["Groesse", "Schriftgröße"],
  ["Fussnoten", "Fußnoten"],
  ["Dialog schliessen", "Dialog schließen"],
  ["ausserdem", "außerdem"],
  ["Aussenrand", "Außenrand"],
  ["Fliesstext", "Fließtext"],
  ["Massnahme", "Maßnahme"],
  ["das gross Bild", "Gross ist ein Name, Kreuz groß"],
  ["er weiss es", "Weiss ist ein Name, ein weißes Blatt"],
  ["fuer dich", "für dich, neue Quelle, Konsequenz"],
  ["Dialog oeffnen", "Dialog öffnen"],
  ["Aenderung speichern", "Änderung speichern"],
  ["Story Board", "Storyboard"],
  ["Figuren-Board", "Figurenboard"],
  ["EPUB für Ereader", "EPUB für E-Reader"],
  ["Email senden", "E-Mail senden, Mailbox"],
  ["Cloud Backup", "Cloud-Backup"],
  ["Cloudkonto", "Cloud-Konto"],
  ["quiltor-Projekt öffnen", "Quiltor-Projekt öffnen, .quiltor-Projekt"],
  ["Quiltor Projekt", "Quiltor-Projekt"],
  ["Back-up anlegen", "Backup anlegen"],
  ["in der Zeitleiste", "in der Timeline"],
  ["Zeitstrahl", "Timeline"],
  ["Time-line", "Timeline"],
  ["Schauplatz anlegen", "Ort anlegen"],
  ["Location anlegen", "Ort anlegen"],
  ["Characters", "Figuren"],
  ["Inspektor", "Figuren-Inspector"],
];

test("every forbidden spelling is exercised by an example", () => {
  const exercised = FORBIDDEN_SPELLINGS.filter(({ pattern }) =>
    EXAMPLES.some(([wrong]) => new RegExp(pattern.source, pattern.flags).test(wrong)),
  );
  assert.equal(exercised.length, FORBIDDEN_SPELLINGS.length);
});

for (const [wrong, right] of EXAMPLES) {
  test(`flags "${wrong}" and accepts "${right}"`, () => {
    assert.ok(findForbiddenSpellings(wrong).length > 0, `"${wrong}" was not flagged`);
    assert.deepEqual(findForbiddenSpellings(right), [], `"${right}" was flagged`);
  });
}

test("reports the matched text and the replacement", () => {
  const [hit] = findForbiddenSpellings("Der Massstab fehlt");
  assert.equal(hit.found, "Massstab");
  assert.equal(hit.use, "Maßstab");
});

test("reads string literals and JSX text, not comments or identifiers", () => {
  const source = [
    "// Massstab in a comment",
    " * Massstab in a doc comment",
    'const massstabKey = "ok";',
    'const label = "Massstab";',
    "const other = 'Fussnote';",
    "const view = <p>Zeitleiste</p>;",
  ].join("\n");
  const found = stringsInSource(source).flatMap(({ text, line }) =>
    findForbiddenSpellings(text).map((hit) => `${line}:${hit.found}`),
  );
  assert.deepEqual(found, ["4:Massstab", "5:Fuss", "6:Zeitleiste"]);
});
