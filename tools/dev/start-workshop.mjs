import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Die Werkstatt lokal starten -- beide Haelften, in einem Befehl.
 *
 * Vite allein reicht nicht: es liefert nur den Client aus und leitet /api an den
 * Python-Server auf 8000 weiter. Fehlt der, laedt die Seite und sagt "Quiltor ist
 * voruebergehend nicht erreichbar" -- was aussieht wie ein Fehler in der Anwendung und
 * keiner ist. Genau deshalb gibt es dieses Skript: wer es startet, bekommt beide Haelften
 * oder eine Erklaerung, warum nicht.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLIENT_PORT = Number(process.env.QUILTOR_DEV_PORT ?? 5173);
const API_PORT = Number(process.env.QUILTOR_API_PORT ?? 8000);
const WINDOWS = process.platform === "win32";

/**
 * Ein Python, das wirklich startet.
 *
 * Nicht nur eines, das im Launcher steht: ein Release-Lauf kann sein Python aus einem
 * Temp-Verzeichnis als Systemversion eintragen, und wenn das Verzeichnis spaeter aufgeraeumt
 * wird, bleibt ein Eintrag zurueck, der beim Aufruf abbricht. Deshalb wird jeder Kandidat
 * einmal ausgefuehrt, statt ihm zu glauben.
 */
function findePython() {
  // Neueste zuerst: 3.14 ist der Interpreter, mit dem gebaut und geprueft wird. Darunter
  // laeuft es weiterhin, bis hinunter zu der Grenze, die pyproject.toml zusagt -- das
  // ausgelieferte Web-Image bringt 3.12 mit, also ist 3.12 die Grenze.
  const kandidaten = WINDOWS
    ? [
        ["py", ["-3.14"]],
        ["py", ["-3.13"]],
        ["py", ["-3.12"]],
        ["python", []],
      ]
    : [
        ["python3.14", []],
        ["python3.13", []],
        ["python3.12", []],
        ["python3", []],
      ];

  const abgelehnt = [];
  for (const [befehl, vorgabe] of kandidaten) {
    const probe = spawnSync(
      befehl,
      [...vorgabe, "-c", "import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)"],
      { encoding: "utf8" },
    );
    if (probe.status === 0) return [befehl, vorgabe];
    const grund =
      probe.error?.code === "ENOENT"
        ? "nicht vorhanden"
        : probe.status === 1
          ? "aelter als 3.12"
          : (probe.stderr || "").split("\n")[0] || "startet nicht";
    abgelehnt.push(`  ${[befehl, ...vorgabe].join(" ")}: ${grund}`);
  }

  console.error("Kein brauchbares Python gefunden. Das Projekt braucht 3.12 oder neuer.");
  console.error(abgelehnt.join("\n"));
  process.exit(1);
}

function starte(name, befehl, argumente, umgebung) {
  const kind = spawn(befehl, argumente, {
    cwd: ROOT,
    env: { ...process.env, ...umgebung },
    stdio: ["ignore", "pipe", "pipe"],
    shell: WINDOWS,
  });
  const zeigen = (daten) => {
    for (const zeile of String(daten).split("\n")) {
      if (zeile.trim()) console.log(`[${name}] ${zeile.trimEnd()}`);
    }
  };
  kind.stdout.on("data", zeigen);
  kind.stderr.on("data", zeigen);
  kind.on("exit", (code) => {
    if (!beendet) {
      console.error(`\n[${name}] hat sich mit Code ${code} beendet. Alles wird gestoppt.`);
      aufraeumen(1);
    }
  });
  return kind;
}

async function wartetAuf(url, name, sekunden = 60) {
  for (let versuch = 0; versuch < sekunden; versuch += 1) {
    try {
      const antwort = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (antwort.ok) return true;
    } catch {
      // Noch nicht da; gleich noch einmal.
    }
    await new Promise((weiter) => setTimeout(weiter, 1000));
  }
  console.error(`${name} antwortet nach ${sekunden}s nicht auf ${url}.`);
  return false;
}

const kinder = [];
let beendet = false;

function aufraeumen(code) {
  if (beendet) return;
  beendet = true;
  for (const kind of kinder) {
    if (kind.exitCode !== null || kind.pid === undefined) continue;
    // Vite und der Server starten ihrerseits Prozesse; unter Windows braucht es den Baum,
    // sonst bleibt der Port belegt und der naechste Start scheitert an --strictPort.
    if (WINDOWS) spawnSync("taskkill", ["/pid", String(kind.pid), "/T", "/F"], { stdio: "ignore" });
    else kind.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => aufraeumen(0));
process.on("SIGTERM", () => aufraeumen(0));

const server = resolve(ROOT, "apps/web/server.py");
if (!existsSync(server)) {
  console.error(`Nicht gefunden: ${server}. Läuft das Skript im richtigen Verzeichnis?`);
  process.exit(1);
}

const [python, vorgabe] = findePython();
console.log(`Python: ${[python, ...vorgabe].join(" ")}`);

kinder.push(
  starte(
    "api",
    python,
    [...vorgabe, "apps/web/server.py", String(API_PORT), "--no-open"],
    // Ohne src im Pfad findet der Server das Paket nicht, solange es nicht installiert ist.
    { PYTHONPATH: "src", PYTHONIOENCODING: "utf-8" },
  ),
);

if (!(await wartetAuf(`http://127.0.0.1:${API_PORT}/api/version`, "Der API-Server"))) {
  aufraeumen(1);
}
console.log(`API bereit auf http://127.0.0.1:${API_PORT}`);

kinder.push(
  starte("web", WINDOWS ? "npx.cmd" : "npx", [
    "vite",
    "--port",
    String(CLIENT_PORT),
    "--strictPort",
    "--host",
    "127.0.0.1",
  ]),
);

if (!(await wartetAuf(`http://127.0.0.1:${CLIENT_PORT}/`, "Vite"))) aufraeumen(1);

console.log("");
console.log(`  Die Werkstatt läuft: http://127.0.0.1:${CLIENT_PORT}`);
console.log("  Beenden mit Strg+C.");
console.log("");
