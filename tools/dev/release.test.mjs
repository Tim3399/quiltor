import assert from "node:assert/strict";
import { test } from "node:test";
import { naechsteVersion, stellen } from "./release.mjs";

test("zaehlt die drei Stufen richtig hoch", () => {
  assert.equal(naechsteVersion("3.15.1", "patch"), "3.15.2");
  assert.equal(naechsteVersion("3.15.1", "minor"), "3.16.0");
  assert.equal(naechsteVersion("3.15.1", "major"), "4.0.0");
});

test("setzt bei minor und major die kleineren Stellen zurueck", () => {
  assert.equal(naechsteVersion("3.15.7", "minor"), "3.16.0");
  assert.equal(naechsteVersion("3.15.7", "major"), "4.0.0");
});

test("nimmt eine ausgeschriebene Nummer, wie sie ist", () => {
  assert.equal(naechsteVersion("3.15.1", "5.2.3"), "5.2.3");
});

test("kennt jede Stelle, an der die Nummer steht", () => {
  const dateien = stellen("3.15.1").map((eintrag) => eintrag.datei);

  // Der Vertrag gleicht sechs Vorkommen in diesen fuenf Dateien ab.
  assert.deepEqual(dateien.sort(), [
    "Cargo.lock",
    "Cargo.toml",
    "VERSION",
    "package-lock.json",
    "package.json",
  ]);
  assert.equal(
    stellen("3.15.1").reduce((summe, eintrag) => summe + eintrag.anzahl, 0),
    7,
  );
});

test("das Muster trifft die Nummer, nicht eine mit gleichen Ziffern", () => {
  const paket = stellen("3.15.1").find((eintrag) => eintrag.datei === "package.json");
  const text = '"version": "3.15.1",\n  "other": "13.15.10",';

  assert.equal((text.match(paket.muster) ?? []).length, 1);
});
