import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Etwas in der laufenden Anwendung nachmessen, ohne dafuer eine Datei anzulegen.
 *
 *   npm run probe -- "document.querySelectorAll('.story-node').length"
 *   npm run probe -- --orte "[...document.querySelectorAll('.react-flow__node')].length"
 *   npm run probe -- --storyboard --breit "getComputedStyle(document.body).fontSize"
 *
 * Der Ausdruck laeuft in der Seite, das Ergebnis kommt als JSON zurueck. Die Welt ist
 * vorbereitet: Figuren, ein Ort, eine aufgeklappte Karte mit einem Ort darauf, ein
 * Storyboard mit Gruppe, zwei Karten und einer Verbindung.
 *
 * Der Umweg ueber Playwright ist Absicht. Im eingebetteten Browser-Fenster wird nicht
 * gezeichnet, solange es ausgeblendet ist; dort feuert kein ResizeObserver, React Flow misst
 * nichts, und die Uebersichtskarte ist leer. Das sieht aus wie ein Befund und ist keiner --
 * genau darauf bin ich einmal hereingefallen.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const WORKSPACES = {
  "--text": "Text",
  "--figuren": "Figuren",
  "--timeline": "Timeline",
  "--orte": "Orte",
  "--storyboard": "Storyboard",
};
const ANSICHTEN = { "--breit": "wide", "--mittel": "regular", "--schmal": "compact" };

const argumente = process.argv.slice(2);
let workspace = "";
let projekt = "wide";
let warten = "2000";
const rest = [];

for (let stelle = 0; stelle < argumente.length; stelle += 1) {
  const wort = argumente[stelle];
  if (WORKSPACES[wort]) workspace = WORKSPACES[wort];
  else if (ANSICHTEN[wort]) projekt = ANSICHTEN[wort];
  else if (wort === "--warten") warten = argumente[(stelle += 1)];
  else rest.push(wort);
}

const ausdruck = rest.join(" ").trim();
if (!ausdruck) {
  console.error('Aufruf: npm run probe -- [--orte] [--schmal] "<javascript-ausdruck>"');
  console.error("Der Ausdruck wird in der Seite ausgewertet; sein Wert kommt als JSON zurück.");
  process.exit(2);
}

const lauf = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["playwright", "test", "tests/e2e/probe.spec.ts", `--project=${projekt}`, "--reporter=line"],
  {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      QUILTOR_PROBE: ausdruck,
      QUILTOR_PROBE_WORKSPACE: workspace,
      QUILTOR_PROBE_WAIT: warten,
      PLAYWRIGHT_BASE_URL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173",
    },
  },
);

const ausgabe = `${lauf.stdout ?? ""}${lauf.stderr ?? ""}`;
const treffer = ausgabe.match(/^SONDE (.*)$/mu);

if (treffer) {
  console.log(treffer[1]);
  process.exit(0);
}

console.error("Die Sonde hat nichts gemeldet. Läuft `npm start`?\n");
console.error(ausgabe.trim().split("\n").slice(-20).join("\n"));
process.exit(1);
