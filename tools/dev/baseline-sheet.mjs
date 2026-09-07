import { createServer } from "node:http";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * A contact sheet for the pixel baselines that does its own arithmetic.
 *
 * Two measures I discarded before one stayed: density inside the bounding rectangle says a
 * lot in a narrow view simply because little of it is empty. And the share of long runs of
 * difference -- the idea was to tell blocks apart from glyph edges -- reports every rule
 * that rasterises one pixel differently, across the full width. Both mostly found
 * themselves.
 *
 * What carries is the question of a shift: can the difference be explained by the same
 * content sitting a few rows higher or lower? If so, it is a line break that falls
 * elsewhere on the other platform. If not, something is left over that somebody should
 * look at.
 *
 * The Linux and macOS sets came from --update-snapshots=missing: a runner photographed
 * whatever was there and declared it the reference. Nobody looked. If one of those images
 * holds a layout fault, the comparison defends it from then on, quietly, because it is
 * "as expected".
 *
 * Windows is the yardstick here -- those images came about during development and were
 * seen by someone.
 *
 * The images travel over http rather than file://, because Chrome treats a canvas holding a
 * file:// image as tainted and refuses to read it back. No read, no comparison.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SNAPSHOTS = resolve(ROOT, "tests/e2e/visual-baseline.spec.ts-snapshots");
const PLATFORMS = ["win32", "linux", "darwin"];
const NAMES = { win32: "Windows", linux: "Linux", darwin: "macOS" };
const PORT = Number(process.env.QUILTOR_SHEET_PORT ?? 4180);

const subjects = new Map();
for (const name of readdirSync(SNAPSHOTS)) {
  const match = name.match(/^(.*)-(win32|linux|darwin)\.png$/u);
  if (!match) continue;
  const [, subject, platform] = match;
  if (!subjects.has(subject)) subjects.set(subject, {});
  subjects.get(subject)[platform] = {
    file: name,
    kb: Math.round(statSync(resolve(SNAPSHOTS, name)).size / 1024),
  };
}

const data = [...subjects.entries()]
  .map(([subject, images]) => ({ subject, images }))
  .sort((left, right) => left.subject.localeCompare(right.subject));

const html = `<!doctype html>
<meta charset="utf-8">
<title>Baseline-Kontaktbogen</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 24px; font: 14px/1.55 system-ui, sans-serif; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  p.intro { max-width: 74ch; color: #666; margin: 0 0 20px; }
  #status { padding: 12px 16px; margin: 0 0 24px; max-width: 74ch;
           border-left: 4px solid #6b7280; background: #f3f4f6; color: #374151; }
  .subject { margin: 0 0 34px; }
  .subject h2 { font-size: 15px; margin: 0 0 6px; font-family: ui-monospace, monospace; }
  .numbers { font-size: 12px; color: #666; margin: 0 0 8px; }
  .numbers b { color: #b45309; }
  .row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; align-items: start; }
  figure { margin: 0; }
  figcaption { font-size: 12px; color: #666; margin: 0 0 4px; }
  img { width: 100%; height: auto; border: 1px solid #d4d4d4; background: #fff; display: block; }
</style>
<h1>Baseline-Kontaktbogen</h1>
<p class="intro">
  Dieselben ${data.length} Motive auf drei Plattformen, verglichen gegen Windows. Zwischen
  ihnen darf sich nur die Schriftrasterung unterscheiden, und ein Umbruch, der anderswo
  fällt, verschiebt den Inhalt um ganze Zeilen. Was auch nach der besten Verschiebung übrig
  bleibt, ist etwas anderes -- und wäre ohne diesen Blick zur Referenz geworden.
</p>
<div id="status">Wird verglichen …</div>
<div id="sheet"></div>
<script>
const DATA = ${JSON.stringify(data)};
const NAMES = ${JSON.stringify(NAMES)};
const FOLDER = "";

function load(file) {
  return new Promise((done, failed) => {
    const image = new Image();
    image.onload = () => done(image);
    image.onerror = () => failed(new Error(file));
    image.src = FOLDER + file;
  });
}

function pixels(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/*
 * How much differs -- and how much of that is left once a shift is allowed.
 */
function compare(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { sizesDiffer: true };
  const distance = (i, j) =>
    Math.abs(a.data[i] - b.data[j]) +
    Math.abs(a.data[i + 1] - b.data[j + 1]) +
    Math.abs(a.data[i + 2] - b.data[j + 2]);
  // Every third column is enough: this looks for an order of magnitude, not a decimal.
  const mismatch = (d) => {
    let different = 0;
    let counted = 0;
    for (let y = 0; y < a.height; y += 1) {
      const yb = y + d;
      if (yb < 0 || yb >= a.height) continue;
      for (let x = 0; x < a.width; x += 3) {
        counted += 1;
        if (distance((y * a.width + x) * 4, (yb * a.width + x) * 4) > 24) different += 1;
      }
    }
    return counted ? different / counted : 0;
  };
  const unshifted = mismatch(0);
  let best = { shift: 0, value: unshifted };
  for (let d = -24; d <= 24; d += 1) {
    if (!d) continue;
    const value = mismatch(d);
    if (value < best.value) best = { shift: d, value };
  }
  return { share: unshifted, shift: best.shift, remainder: best.value };
}

(async () => {
  const results = [];
  for (const entry of DATA) {
    const images = {};
    for (const platform of Object.keys(entry.images)) {
      images[platform] = await load(entry.images[platform].file);
    }
    const reference = pixels(images.win32);
    const against = {};
    for (const platform of ["linux", "darwin"]) {
      if (images[platform]) against[platform] = compare(reference, pixels(images[platform]));
    }
    results.push({ subject: entry.subject, images: entry.images, against });
  }

  // Sorted by what a shift does not explain.
  const worst = (entry) =>
    Math.max(...Object.values(entry.against).map((w) => w.remainder ?? 1), 0);
  results.sort((a, b) => worst(b) - worst(a));
  window.results = results.map((e) => ({
    subject: e.subject,
    linux: e.against.linux,
    darwin: e.against.darwin,
  }));

  const percent = (value) => (value * 100).toFixed(1) + "%";
  document.getElementById("sheet").innerHTML = results
    .map((entry) => {
      const numbers = ["linux", "darwin"]
        .filter((p) => entry.against[p])
        .map((p) => {
          const w = entry.against[p];
          if (w.sizesDiffer) return NAMES[p] + ": <b>Maße weichen ab</b>";
          const notable = w.remainder > 0.12;
          const shifted = w.shift
            ? " (" + w.shift + " Zeilen verschoben, dann " + percent(w.remainder) + ")"
            : "";
          const text = NAMES[p] + ": " + percent(w.share) + " abweichend" + shifted;
          return notable ? "<b>" + text + "</b>" : text;
        })
        .join(" &nbsp;·&nbsp; ");
      const columns = ["win32", "linux", "darwin"]
        .map((p) => {
          const image = entry.images[p];
          if (!image) return "<div>" + NAMES[p] + ": fehlt</div>";
          return (
            '<figure><figcaption>' + NAMES[p] + " — " + image.kb + " kB</figcaption>" +
            '<img loading="lazy" src="' + image.file + '" alt=""></figure>'
          );
        })
        .join("");
      return (
        '<section class="subject"><h2>' + entry.subject + "</h2>" +
        '<p class="numbers">' + numbers + "</p>" +
        '<div class="row">' + columns + "</div></section>"
      );
    })
    .join("");

  const open = results.filter((e) => worst(e) > 0.12);
  document.getElementById("status").textContent = open.length
    ? open.length +
      " Motive weichen mehr ab, als eine Verschiebung erklärt. Sie stehen oben."
    : "Bei jedem Motiv bleibt unter 12% übrig, sobald eine Verschiebung zugelassen wird.";
})();
</script>
`;

// The page stays in memory: the baseline folder belongs to Playwright, and a foreign file
// in it shows up as an unexplained change in the working tree.

const TYPES = { ".html": "text/html; charset=utf-8", ".png": "image/png" };
const server = createServer((request, response) => {
  const file = decodeURIComponent((request.url ?? "/").split("?")[0]).replace(/^\//u, "");
  if (!file) {
    response.writeHead(200, { "content-type": TYPES[".html"] });
    response.end(html);
    return;
  }
  const path = resolve(SNAPSHOTS, file);
  // From the baseline folder only, nothing above it.
  if (!path.startsWith(SNAPSHOTS)) {
    response.writeHead(403).end();
    return;
  }
  try {
    response.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    response.end(readFileSync(path));
  } catch {
    response.writeHead(404).end();
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`${data.length} Motive, ${data.length * PLATFORMS.length} Bilder.`);
  console.log(`\n  http://127.0.0.1:${PORT}/\n`);
  console.log("Beenden mit Strg+C.");
});
