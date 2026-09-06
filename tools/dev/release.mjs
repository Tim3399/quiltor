import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/*
 * Eine Version setzen, an allen Stellen, an denen sie steht.
 *
 * Es sind sechs, verteilt auf fuenf Dateien, und `profile_contract.py` bricht den Release ab,
 * sobald eine davon abweicht -- zu Recht, denn ein Wheel mit einer anderen Nummer als das
 * Cargo-Paket ist nicht mehr nachvollziehbar. Von Hand ist das jedes Mal dieselbe Sucherei;
 * hier steht sie einmal.
 *
 *   node tools/dev/release.mjs minor        setzt und taggt
 *   node tools/dev/release.mjs 4.0.0        eine bestimmte Nummer
 *   node tools/dev/release.mjs minor --dry  zeigt nur, was geschehen wuerde
 *
 * Der Tag wird erst gesetzt, wenn der Versionsabgleich des Vertrags durchlaeuft. Gepusht
 * wird nichts: das bleibt eine bewusste Handlung.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/u;

function lies(datei) {
  return readFileSync(resolve(ROOT, datei), "utf8");
}

function schreibe(datei, inhalt) {
  writeFileSync(resolve(ROOT, datei), inhalt);
}

function fehler(text) {
  console.error(text);
  process.exit(1);
}

export function naechsteVersion(jetzt, wunsch) {
  if (SEMVER.test(wunsch)) return wunsch;
  const [, major, minor, patch] = SEMVER.exec(jetzt) ?? [];
  if (!major) fehler(`VERSION ist keine major.minor.patch-Nummer: ${jetzt}`);
  const zahlen = { major: Number(major), minor: Number(minor), patch: Number(patch) };
  if (wunsch === "major") return `${zahlen.major + 1}.0.0`;
  if (wunsch === "minor") return `${zahlen.major}.${zahlen.minor + 1}.0`;
  if (wunsch === "patch") return `${zahlen.major}.${zahlen.minor}.${zahlen.patch + 1}`;
  fehler(`Unbekannt: ${wunsch}. Erlaubt sind major, minor, patch oder eine Nummer wie 4.0.0.`);
}

/**
 * Jede Stelle einzeln benannt, mit der Anzahl, die dort stehen muss.
 *
 * Ein blindes Ersetzen ueber die ganze Datei traefe in package-lock.json auch die Versionen
 * der Abhaengigkeiten. Die Zahl daneben ist die Probe: findet sich eine andere Menge, hat
 * sich das Format geaendert und das Skript soll abbrechen, statt zu raten.
 */
export function stellen(alt) {
  const zitiert = alt.replaceAll(".", "\\.");
  return [
    { datei: "VERSION", muster: new RegExp(`^${zitiert}\\s*$`, "u"), anzahl: 1 },
    {
      datei: "package.json",
      muster: new RegExp(`("version":\\s*)"${zitiert}"`, "gu"),
      anzahl: 1,
    },
    {
      datei: "package-lock.json",
      muster: new RegExp(`("version":\\s*)"${zitiert}"`, "gu"),
      anzahl: 2,
    },
    {
      datei: "Cargo.toml",
      muster: new RegExp(`^(version = )"${zitiert}"$`, "gmu"),
      anzahl: 1,
    },
    {
      datei: "Cargo.lock",
      muster: new RegExp(`^(version = )"${zitiert}"$`, "gmu"),
      anzahl: 2,
    },
  ];
}

function main() {
  const [wunsch = "patch", ...rest] = process.argv.slice(2);
  const nurZeigen = rest.includes("--dry");

  const jetzt = lies("VERSION").trim();
  const neu = naechsteVersion(jetzt, wunsch);
  if (neu === jetzt) fehler(`${neu} steht bereits in VERSION.`);

  const sauber = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
  if (sauber.stdout.trim() && !nurZeigen) {
    fehler(
      "Das Arbeitsverzeichnis ist nicht sauber. Eine Version wird auf einen fertigen Stand\n" +
        "gesetzt, sonst taggt sie etwas anderes als das, was gemeint war:\n" +
        sauber.stdout.trimEnd(),
    );
  }

  console.log(`${jetzt} -> ${neu}${nurZeigen ? "  (nur gezeigt)" : ""}`);

  for (const { datei, muster, anzahl } of stellen(jetzt)) {
    const inhalt = lies(datei);
    const treffer = inhalt.match(muster) ?? [];
    if (treffer.length !== anzahl) {
      fehler(
        `${datei}: ${treffer.length} Vorkommen von ${jetzt} gefunden, erwartet ${anzahl}. ` +
          "Das Format hat sich geaendert -- bitte von Hand nachsehen.",
      );
    }
    console.log(`  ${datei} (${anzahl})`);
    if (nurZeigen) continue;
    const ersetzt =
      datei === "VERSION"
        ? `${neu}\n`
        : inhalt.replace(muster, (_treffer, davor) => `${davor}"${neu}"`);
    schreibe(datei, ersetzt);
  }
  if (nurZeigen) return;

  // Der Vertrag ist die eigentliche Probe: er kennt alle Stellen, nicht nur die hier.
  const abgleich = spawnSync(
    process.platform === "win32" ? "py" : "python3",
    [
      ...(process.platform === "win32" ? ["-3.12"] : []),
      "-c",
      "import sys; sys.path.insert(0, 'distribution/tooling'); import profile_contract as p; " +
        "print(p.validate_version_alignment())",
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (abgleich.status !== 0) {
    fehler(`Der Versionsabgleich des Vertrags scheitert:\n${abgleich.stderr || abgleich.stdout}`);
  }
  console.log(`Vertrag: ${abgleich.stdout.trim()}`);

  for (const argumente of [
    ["add", "VERSION", "package.json", "package-lock.json", "Cargo.toml", "Cargo.lock"],
    [
      "commit",
      "-m",
      `chore: release v${neu}`,
      "-m",
      "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>",
    ],
    ["tag", "-a", `v${neu}`, "-m", `v${neu}`],
  ]) {
    const lauf = spawnSync("git", argumente, { cwd: ROOT, encoding: "utf8" });
    if (lauf.status !== 0) fehler(`git ${argumente[0]} scheitert:\n${lauf.stderr}`);
  }

  console.log("");
  console.log(`  v${neu} ist gesetzt und getaggt.`);
  console.log(`  Zum Veröffentlichen: git push && git push origin v${neu}`);
  console.log("");
}

/*
 * Nur beim direkten Aufruf.
 *
 * Ein Import zum Testen darf nichts setzen und nichts taggen. Ein process.exit() an dieser
 * Stelle reichte dafuer nicht: es beendete den Testlauf gleich mit, und uebrig blieb ein
 * einziger bestandener Fall, der so aussah, als sei alles in Ordnung.
 */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
