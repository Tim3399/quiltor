import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Was der Release-Preflight erwartet, und was hier steht.
 *
 * `release_preflight.py` verlangt exakt die Laufzeiten aus distribution/toolchains.json --
 * dieselben wie die Release-CI, damit ein Versionswechsel nicht mit anderen Werkzeugen
 * gebaut wird als der Release selbst. Es meldet aber immer nur die erste Abweichung und
 * bricht ab. Wer drei davon hat, sucht dreimal.
 *
 * Dieses Skript zeigt alle auf einmal, mit der Zeile zum Nachinstallieren daneben. Es
 * aendert nichts: Laufzeiten zu installieren ist ein Eingriff ins System und bleibt eine
 * Sache, die jemand bewusst tut.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WINDOWS = process.platform === "win32";

const { releaseToolchains } = JSON.parse(
  readFileSync(resolve(ROOT, "distribution/toolchains.json"), "utf8"),
);

/** Wie man die Version erfragt, und wie man sie nachinstalliert. */
const LAUFZEITEN = [
  {
    name: "python",
    // Der Preflight prueft den Interpreter, der ihn ausfuehrt -- nicht den im Pfad.
    frage: WINDOWS
      ? ["py", ["-3.14", "-c", "import platform;print(platform.python_version())"]]
      : ["python3.14", ["-c", "import platform;print(platform.python_version())"]],
    hinweis: (soll) =>
      WINDOWS
        ? `winget install Python.Python.3.14 --version ${soll}`
        : `pyenv install ${soll}   (oder das Paket der Distribution)`,
  },
  {
    name: "node",
    frage: ["node", ["--version"]],
    saeubern: (text) => text.replace(/^v/u, ""),
    hinweis: (soll) => `nvm install ${soll}   (oder volta pin node@${soll})`,
  },
  {
    name: "npm",
    frage: [WINDOWS ? "npm.cmd" : "npm", ["--version"]],
    hinweis: (soll) => `npm install --global npm@${soll}`,
  },
  {
    name: "rust",
    frage: ["cargo", ["--version"]],
    saeubern: (text) => text.match(/cargo\s+([0-9.]+)/u)?.[1] ?? text,
    hinweis: (soll) => `rustup toolchain install ${soll} && rustup default ${soll}`,
  },
];

function gemessen({ frage: [befehl, argumente], saeubern }) {
  const lauf = spawnSync(befehl, argumente, { encoding: "utf8", shell: WINDOWS });
  if (lauf.status !== 0) {
    const grund = lauf.error?.code === "ENOENT" ? "nicht gefunden" : "startet nicht";
    return { fehlt: true, text: grund };
  }
  const roh = (lauf.stdout || lauf.stderr).trim().split("\n").pop().trim();
  return { fehlt: false, text: saeubern ? saeubern(roh) : roh };
}

const zeilen = [];
let abweichungen = 0;

for (const laufzeit of LAUFZEITEN) {
  const soll = releaseToolchains[laufzeit.name];
  const ist = gemessen(laufzeit);
  const passt = !ist.fehlt && ist.text === soll;
  if (!passt) abweichungen += 1;
  zeilen.push({
    zeichen: passt ? "  ok " : "  -- ",
    name: laufzeit.name.padEnd(7),
    soll: soll.padEnd(9),
    ist: ist.text,
    hinweis: passt ? "" : laufzeit.hinweis(soll),
  });
}

console.log("Laufzeiten für den Release-Preflight (distribution/toolchains.json):\n");
for (const zeile of zeilen) {
  console.log(`${zeile.zeichen}${zeile.name} soll ${zeile.soll} ist ${zeile.ist}`);
  if (zeile.hinweis) console.log(`         ${zeile.hinweis}`);
}

console.log("");
if (abweichungen === 0) {
  console.log("Alle vier passen. `npm run set-version` kann laufen.");
} else {
  console.log(
    `${abweichungen} von ${LAUFZEITEN.length} weichen ab. Solange das so ist, lehnt ` +
      "`npm run set-version` den Versionswechsel ab -- und zwar zu Recht: ein Release, das " +
      "lokal mit anderen Werkzeugen gebaut wird als in der CI, ist nicht nachvollziehbar.",
  );
  console.log("Der Alltag -- npm start, npm test, die check-Gates -- läuft davon unberührt.");
}

process.exitCode = abweichungen === 0 ? 0 : 1;
