import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Die Gegenprobe zu einem Test: dreht die Korrektur zurueck und sieht nach, ob er es merkt.
 *
 * Ein Test, der nach einer Korrektur gruen ist, beweist nichts -- er koennte auch gruen
 * gewesen sein, bevor irgendetwas stimmte. Genau das ist in diesem Baum schon passiert: ein
 * Geometrie-Test lief durch, waehrend der Fehler wieder drin war, weil die geprüfte Spalte
 * gar nicht eingeblendet war.
 *
 *   node tools/dev/mutate.mjs <datei> --von "<text>" --nach "<text>" -- <befehl ...>
 *
 * Erfolg heisst hier: der Befehl schlaegt fehl. Die Datei wird danach wiederhergestellt,
 * auch wenn der Befehl abstuerzt oder jemand abbricht.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function fehler(text) {
  console.error(text);
  process.exit(2);
}

const argumente = process.argv.slice(2);
const trenner = argumente.indexOf("--");
if (trenner < 0) fehler("Es fehlt das -- vor dem Befehl.");

const [datei, ...rest] = argumente.slice(0, trenner);
const befehl = argumente.slice(trenner + 1);
if (!datei || !befehl.length) fehler("Aufruf: mutate.mjs <datei> --von X --nach Y -- <befehl>");

const wert = (name) => {
  const stelle = rest.indexOf(name);
  return stelle < 0 ? undefined : rest[stelle + 1];
};
const von = wert("--von");
const nach = wert("--nach") ?? "";
if (von === undefined) fehler("--von fehlt: ohne den zu ersetzenden Text gibt es nichts zu tun.");

const pfad = resolve(ROOT, datei);
const original = readFileSync(pfad, "utf8");
if (!original.includes(von)) fehler(`Nicht gefunden in ${datei}: ${von.slice(0, 60)}`);

const treffer = original.split(von).length - 1;
console.log(`${datei}: ${treffer}× "${von.slice(0, 50)}" -> "${nach.slice(0, 50)}"`);

let wiederhergestellt = false;
function zurueck() {
  if (wiederhergestellt) return;
  wiederhergestellt = true;
  writeFileSync(pfad, original);
  console.log(`${datei} wiederhergestellt.`);
}
process.on("exit", zurueck);
process.on("SIGINT", () => process.exit(130));

writeFileSync(pfad, original.split(von).join(nach));

const lauf = spawnSync(befehl[0], befehl.slice(1), {
  cwd: ROOT,
  stdio: "inherit",
  shell: process.platform === "win32",
});
zurueck();

console.log("");
if (lauf.status === 0) {
  console.log("Der Befehl lief durch, obwohl die Änderung zurückgedreht war.");
  console.log("Der Test prüft also nicht, was er zu prüfen vorgibt.");
  process.exitCode = 1;
} else {
  console.log(`Der Befehl schlug fehl (Code ${lauf.status}) -- der Test greift.`);
  process.exitCode = 0;
}
