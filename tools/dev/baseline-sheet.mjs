import { createServer } from "node:http";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Ein Kontaktbogen für die Pixel-Baselines, der selbst rechnet.
 *
 * Zwei Maße, die ich verworfen habe, bevor eines blieb: die Dichte im umschliessenden
 * Rechteck sagt bei einer schmalen Ansicht schon deshalb viel, weil dort wenig Flaeche
 * leer ist. Und der Anteil langer Abweichungslaeufe -- der Gedanke war, Bloecke von
 * Glyphenkanten zu trennen -- meldet jede Trennlinie, die um ein Pixel anders gerastert
 * ist, ueber die volle Breite. Beide fanden vor allem sich selbst.
 *
 * Was traegt, ist die Frage nach einer Verschiebung: laesst sich die Abweichung dadurch
 * erklaeren, dass derselbe Inhalt ein paar Zeilen hoeher oder tiefer sitzt? Wenn ja, ist
 * es ein Umbruch, der auf der anderen Plattform anders faellt. Wenn nein, bleibt etwas
 * uebrig, das jemand ansehen sollte.
 *
 * Die Sätze für Linux und macOS sind mit --update-snapshots=missing entstanden: ein Runner
 * hat fotografiert, was da war, und es zur Referenz erklärt. Angesehen hat sie niemand.
 * Steckt in einem Bild ein Layoutfehler, verteidigt der Vergleich ihn ab jetzt still, denn
 * er ist ja "wie erwartet".
 *
 * Windows ist hier der Maßstab -- diese Bilder sind während der Entwicklung entstanden und
 * wurden gesehen.
 *
 * Die Bilder kommen über http und nicht über file://, weil Chrome eine Leinwand mit einem
 * file://-Bild als fremdbestückt ansieht und das Auslesen verweigert. Ohne Auslesen kein
 * Vergleich.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SNAPSHOTS = resolve(ROOT, "tests/e2e/visual-baseline.spec.ts-snapshots");
const PLATTFORMEN = ["win32", "linux", "darwin"];
const NAMEN = { win32: "Windows", linux: "Linux", darwin: "macOS" };
const PORT = Number(process.env.QUILTOR_SHEET_PORT ?? 4180);

const motive = new Map();
for (const name of readdirSync(SNAPSHOTS)) {
  const treffer = name.match(/^(.*)-(win32|linux|darwin)\.png$/u);
  if (!treffer) continue;
  const [, motiv, plattform] = treffer;
  if (!motive.has(motiv)) motive.set(motiv, {});
  motive.get(motiv)[plattform] = {
    datei: name,
    kb: Math.round(statSync(resolve(SNAPSHOTS, name)).size / 1024),
  };
}

const daten = [...motive.entries()]
  .map(([motiv, bilder]) => ({ motiv, bilder }))
  .sort((links, rechts) => links.motiv.localeCompare(rechts.motiv));

const html = `<!doctype html>
<meta charset="utf-8">
<title>Baseline-Kontaktbogen</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 24px; font: 14px/1.55 system-ui, sans-serif; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  p.hinweis { max-width: 74ch; color: #666; margin: 0 0 20px; }
  #stand { padding: 12px 16px; margin: 0 0 24px; max-width: 74ch;
           border-left: 4px solid #6b7280; background: #f3f4f6; color: #374151; }
  .motiv { margin: 0 0 34px; }
  .motiv h2 { font-size: 15px; margin: 0 0 6px; font-family: ui-monospace, monospace; }
  .zahlen { font-size: 12px; color: #666; margin: 0 0 8px; }
  .zahlen b { color: #b45309; }
  .reihe { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; align-items: start; }
  figure { margin: 0; }
  figcaption { font-size: 12px; color: #666; margin: 0 0 4px; }
  img { width: 100%; height: auto; border: 1px solid #d4d4d4; background: #fff; display: block; }
</style>
<h1>Baseline-Kontaktbogen</h1>
<p class="hinweis">
  Dieselben ${daten.length} Motive auf drei Plattformen, verglichen gegen Windows. Zwischen
  ihnen darf sich nur die Schriftrasterung unterscheiden, und ein Umbruch, der anderswo
  fällt, verschiebt den Inhalt um ganze Zeilen. Was auch nach der besten Verschiebung übrig
  bleibt, ist etwas anderes -- und wäre ohne diesen Blick zur Referenz geworden.
</p>
<div id="stand">Wird verglichen …</div>
<div id="bogen"></div>
<script>
const DATEN = ${JSON.stringify(daten)};
const NAMEN = ${JSON.stringify(NAMEN)};
const ORDNER = "";

function laden(datei) {
  return new Promise((fertig, schiefgegangen) => {
    const bild = new Image();
    bild.onload = () => fertig(bild);
    bild.onerror = () => schiefgegangen(new Error(datei));
    bild.src = ORDNER + datei;
  });
}

function pixel(bild) {
  const flaeche = document.createElement("canvas");
  flaeche.width = bild.naturalWidth;
  flaeche.height = bild.naturalHeight;
  const stift = flaeche.getContext("2d", { willReadFrequently: true });
  stift.drawImage(bild, 0, 0);
  return stift.getImageData(0, 0, flaeche.width, flaeche.height);
}

/*
 * Wie viel weicht ab -- und wie viel davon bleibt, wenn man eine Verschiebung zulaesst.
 */
function vergleich(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { masseUneinig: true };
  const abstand = (i, j) =>
    Math.abs(a.data[i] - b.data[j]) +
    Math.abs(a.data[i + 1] - b.data[j + 1]) +
    Math.abs(a.data[i + 2] - b.data[j + 2]);
  // Jede dritte Spalte genuegt: gesucht wird eine Groessenordnung, keine Nachkommastelle.
  const guete = (d) => {
    let anders = 0;
    let gezaehlt = 0;
    for (let y = 0; y < a.height; y += 1) {
      const yb = y + d;
      if (yb < 0 || yb >= a.height) continue;
      for (let x = 0; x < a.width; x += 3) {
        gezaehlt += 1;
        if (abstand((y * a.width + x) * 4, (yb * a.width + x) * 4) > 24) anders += 1;
      }
    }
    return gezaehlt ? anders / gezaehlt : 0;
  };
  const ohne = guete(0);
  let beste = { verschiebung: 0, wert: ohne };
  for (let d = -24; d <= 24; d += 1) {
    if (!d) continue;
    const wert = guete(d);
    if (wert < beste.wert) beste = { verschiebung: d, wert };
  }
  return { anteil: ohne, verschiebung: beste.verschiebung, rest: beste.wert };
}

(async () => {
  const ergebnisse = [];
  for (const eintrag of DATEN) {
    const bilder = {};
    for (const plattform of Object.keys(eintrag.bilder)) {
      bilder[plattform] = await laden(eintrag.bilder[plattform].datei);
    }
    const massstab = pixel(bilder.win32);
    const gegen = {};
    for (const plattform of ["linux", "darwin"]) {
      if (bilder[plattform]) gegen[plattform] = vergleich(massstab, pixel(bilder[plattform]));
    }
    ergebnisse.push({ motiv: eintrag.motiv, bilder: eintrag.bilder, gegen });
  }

  // Sortiert wird nach dem, was eine Verschiebung nicht erklaert.
  const schlimmste = (eintrag) =>
    Math.max(...Object.values(eintrag.gegen).map((w) => w.rest ?? 1), 0);
  ergebnisse.sort((a, b) => schlimmste(b) - schlimmste(a));
  window.ergebnisse = ergebnisse.map((e) => ({
    motiv: e.motiv,
    linux: e.gegen.linux,
    darwin: e.gegen.darwin,
  }));

  const prozent = (wert) => (wert * 100).toFixed(1) + "%";
  document.getElementById("bogen").innerHTML = ergebnisse
    .map((eintrag) => {
      const zahlen = ["linux", "darwin"]
        .filter((p) => eintrag.gegen[p])
        .map((p) => {
          const w = eintrag.gegen[p];
          if (w.masseUneinig) return NAMEN[p] + ": <b>Maße weichen ab</b>";
          const auffaellig = w.rest > 0.12;
          const verschoben = w.verschiebung
            ? " (" + w.verschiebung + " Zeilen verschoben, dann " + prozent(w.rest) + ")"
            : "";
          const text = NAMEN[p] + ": " + prozent(w.anteil) + " abweichend" + verschoben;
          return auffaellig ? "<b>" + text + "</b>" : text;
        })
        .join(" &nbsp;·&nbsp; ");
      const spalten = ["win32", "linux", "darwin"]
        .map((p) => {
          const bild = eintrag.bilder[p];
          if (!bild) return "<div>" + NAMEN[p] + ": fehlt</div>";
          return (
            '<figure><figcaption>' + NAMEN[p] + " — " + bild.kb + " kB</figcaption>" +
            '<img loading="lazy" src="' + bild.datei + '" alt=""></figure>'
          );
        })
        .join("");
      return (
        '<section class="motiv"><h2>' + eintrag.motiv + "</h2>" +
        '<p class="zahlen">' + zahlen + "</p>" +
        '<div class="reihe">' + spalten + "</div></section>"
      );
    })
    .join("");

  const offen = ergebnisse.filter((e) => schlimmste(e) > 0.12);
  document.getElementById("stand").textContent = offen.length
    ? offen.length +
      " Motive weichen mehr ab, als eine Verschiebung erklärt. Sie stehen oben."
    : "Bei jedem Motiv bleibt unter 12% übrig, sobald eine Verschiebung zugelassen wird.";
})();
</script>
`;

// Die Seite bleibt im Speicher: der Baseline-Ordner gehoert Playwright, und eine fremde
// Datei darin taucht als unverstandene Aenderung im Arbeitsverzeichnis auf.

const TYPEN = { ".html": "text/html; charset=utf-8", ".png": "image/png" };
const server = createServer((anfrage, antwort) => {
  const datei = decodeURIComponent((anfrage.url ?? "/").split("?")[0]).replace(/^\//u, "");
  if (!datei) {
    antwort.writeHead(200, { "content-type": TYPEN[".html"] });
    antwort.end(html);
    return;
  }
  const pfad = resolve(SNAPSHOTS, datei);
  // Nur aus dem Baseline-Ordner, nichts darüber hinaus.
  if (!pfad.startsWith(SNAPSHOTS)) {
    antwort.writeHead(403).end();
    return;
  }
  try {
    antwort.writeHead(200, { "content-type": TYPEN[extname(pfad)] ?? "application/octet-stream" });
    antwort.end(readFileSync(pfad));
  } catch {
    antwort.writeHead(404).end();
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`${daten.length} Motive, ${daten.length * PLATTFORMEN.length} Bilder.`);
  console.log(`\n  http://127.0.0.1:${PORT}/\n`);
  console.log("Beenden mit Strg+C.");
});
