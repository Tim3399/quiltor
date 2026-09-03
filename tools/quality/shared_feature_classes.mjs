import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

const NEWLINE = String.fromCharCode(10);

const MODULES = "packages/client/src/modules";

/**
 * CSS-Klassen, die ueber Feature-Grenzen hinweg benutzt werden -- und warum.
 *
 * Teilen ist nicht verboten; das Modul `graph` existiert genau dafuer. Nur unbemerkt teilen
 * ist teuer: `.figure-layout` heisst nach den Figuren, traegt aber auch die Ortsansicht, und
 * eine dritte Rasterspalte fuer die eine hat die andere zerlegt. Dieser Eintrag ist die
 * Stelle, an der jemand das gesehen hat. Neue geteilte Klassen fallen auf, bis sie hier
 * stehen -- und Eintraege, die nichts mehr teilen, fallen ebenso auf.
 */
export const SHARED_FEATURE_CLASSES = Object.freeze({
  "figure-layout":
    "Rasterrahmen von Figuren UND Orten. Spaltenzahl nur unter .figure-workspace aendern -- siehe StoryGraphLayout.test.ts.",
  "layout-without-inspector": "Derselbe Rahmen ohne Steuerspalte, in beiden Ansichten.",
  "has-selection": "Auswahlzustand des Inspectors in Figuren und Orten.",
  "is-connecting": "Verbindungsmodus der Leinwand, in Figuren und Orten.",
  "importance-mark": "Der Stern auf einer Karte, in Figuren und Orten derselbe.",
  "story-world-toast": "Meldungsflaeche der Weltansichten, in Figuren und Orten derselbe Ort.",
  "graph-viewport-surface": "Leinwandhuelle aus dem graph-Modul; Weltgraph und Storyboard.",
  "has-minimap": "Zustand derselben Huelle; steuert die Freihalteflaechen am unteren Rand.",
  "graph-edge-surface": "Kantenflaeche aus dem graph-Modul; Weltgraph und Storyboard.",
  "graph-edge-inspector-panel": "Kanten-Inspector aus dem graph-Modul; Weltgraph und Storyboard.",
  "graph-edge-appearance-select": "Gemeinsame Huelle der drei Kanten-Auswahlfelder.",
  "graph-edge-appearance-select__label": "Teil derselben Huelle.",
  "graph-edge-appearance-select__control": "Teil derselben Huelle.",
  "directed-handle": "Verbindungspunkt aus dem Figurenboard; das Storyboard benutzt denselben.",
  "neutral-handle": "Ungerichteter Verbindungspunkt, ebenfalls aus dem Figurenboard.",
  "storyboard-layout": "Rasterrahmen, den Timeline und Storyboard teilen.",
  "focus-side-toggle": "In FocusPanels.css beschrieben, von WorkspaceLayout gerendert.",
  "focus-helper-toggle": "Zweiter Reiter derselben Fokusleiste, gleiche Aufteilung.",
  "writing-data-state": "Ergebnisdarstellung der Schreibhilfe, von Nachschlagen und Pruefen.",
  "writing-values": "Liste der Treffer in derselben Ergebnisdarstellung.",
  "writing-value": "Einzelner Treffer in derselben Ergebnisdarstellung.",
  "writing-attribution": "Quellenangabe unter derselben Ergebnisdarstellung.",
  "is-visible": "Zustand im Kapitelbaum, von Baum und Zeilen gesetzt.",
  "is-active": "Aktiver Eintrag im Kapitelbaum, von Baum und Zeilen gesetzt.",
  selected:
    "Allgemeines Zustandswort, das mehrere Stylesheets fuer sich definieren. Keine gemeinsame Entscheidung -- eher ein Kandidat zum Entflechten.",
  active:
    "Ebenfalls ein allgemeines Zustandswort mit mehreren Definitionen -- dieselbe offene Flanke.",
});

function normalized(path) {
  return path.split(sep).join("/");
}

function files(repositoryRoot) {
  const found = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else found.push(path);
    }
  };
  const root = resolve(repositoryRoot, MODULES);
  if (existsSync(root)) visit(root);
  return found;
}

/** `story-world/figures` rather than the file: features are folders, not modules. */
export function featureOf(path, repositoryRoot) {
  const relativePath = normalized(path).replace(
    `${normalized(resolve(repositoryRoot, MODULES))}/`,
    "",
  );
  const parts = relativePath.split("/");
  return parts.length > 1 ? `${parts[0]}/${parts[1].replace(/\.\w+$/u, "")}` : parts[0];
}

/** Class names a stylesheet defines. */
export function definedClasses(source) {
  return new Set([...source.matchAll(/\.([a-z][\w-]*)/gu)].map((match) => match[1]));
}

/**
 * Class names a component puts into `className`.
 *
 * Reading the attribute rather than the whole file matters: a bare word like "dashed" appears
 * in plenty of sources as an enum value, and counting those made the first version of this
 * check report noise while missing `.figure-layout`, which hides inside a template literal.
 */
export function classNamesInSource(source) {
  const used = new Set();
  const attribute =
    /className\s*=\s*(?:"([^"]*)"|\{([\s\S]{0,400}?)\}\s*(?:\n|\/?>|[a-zA-Z-]+=))/gu;
  for (const match of source.matchAll(attribute)) {
    for (const word of (match[1] ?? match[2] ?? "").matchAll(/[a-z][\w-]{2,}/gu)) {
      used.add(word[0]);
    }
  }
  return used;
}

/**
 * Eigenschaften, bei denen eine Aenderung die Nachbaransicht verschiebt.
 *
 * Farbe oder Schriftschnitt einer geteilten Klasse aendert hoechstens den Eindruck. Eine
 * Rasterspalte aendert, wo alles andere liegt -- das war der Fehler, den die Ortsansicht
 * abbekommen hat, als die Figuren eine dritte Spalte brauchten.
 */
const LAYOUT_PROPERTIES =
  /grid-template|grid-column|grid-row|position\s*:|inset|top\s*:|left\s*:|right\s*:|bottom\s*:|width\s*:|height\s*:|flex\s*:/u;

/**
 * Base rules of `.name` that set geometry and carry no note above them.
 *
 * Only the unqualified selector counts: that is the shared default every view inherits.
 * A qualified rule like `.figure-workspace .figure-layout` belongs to one view alone.
 */
export function missingGeometryNotes(source, name) {
  return baseRules(source, name)
    .filter((rule) => LAYOUT_PROPERTIES.test(rule.block) && !rule.above.endsWith("*/"))
    .map((rule) => rule.index + 1);
}

function baseRules(source, name) {
  const lines = source.split(NEWLINE);
  const found = [];
  lines.forEach((line, index) => {
    if (line.trimEnd() !== `.${name} {`) return;
    const closing = lines.slice(index).findIndex((entry) => entry.trim() === "}");
    found.push({
      index,
      block: lines.slice(index, index + closing + 1).join(NEWLINE),
      above: (lines[index - 1] ?? "").trim(),
    });
  });
  return found;
}

export function scanSharedFeatureClasses(repositoryRoot) {
  const sources = files(repositoryRoot);
  const stylesheets = sources.filter((path) => path.endsWith(".css"));
  const owners = new Map();
  for (const file of stylesheets) {
    for (const name of definedClasses(readFileSync(file, "utf8"))) {
      if (!owners.has(name)) owners.set(name, featureOf(file, repositoryRoot));
    }
  }

  const users = new Map();
  for (const file of sources.filter(
    (path) => /\.tsx$/u.test(path) && !/\.(?:test|story)\./u.test(path),
  )) {
    const feature = featureOf(file, repositoryRoot);
    for (const name of classNamesInSource(readFileSync(file, "utf8"))) {
      if (!owners.has(name)) continue;
      if (!users.has(name)) users.set(name, new Set());
      users.get(name).add(feature);
    }
  }

  const violations = [];
  const shared = new Set();
  for (const [name, features] of users) {
    if (features.size < 2) continue;
    shared.add(name);
    if (Object.hasOwn(SHARED_FEATURE_CLASSES, name)) continue;
    violations.push(
      `.${name} (aus ${owners.get(name)}) wird von ${[...features].sort().join(" und ")} ` +
        "benutzt, steht aber nicht in SHARED_FEATURE_CLASSES. Eintragen und in einem Satz " +
        "sagen, wer sich hier worauf verlaesst.",
    );
  }

  for (const name of Object.keys(SHARED_FEATURE_CLASSES)) {
    if (!shared.has(name)) {
      violations.push(
        `.${name} steht in SHARED_FEATURE_CLASSES, wird aber nur noch von einer Stelle ` +
          "benutzt. Eintrag entfernen, damit die Liste weiter etwas bedeutet.",
      );
    }
  }

  // Das Verzeichnis liegt in tools/, geaendert wird im Stylesheet. Wer eine Rasterspalte
  // anfasst, soll dort lesen, wer noch daran haengt -- und nicht hier.
  for (const name of Object.keys(SHARED_FEATURE_CLASSES)) {
    for (const file of stylesheets) {
      for (const line of missingGeometryNotes(readFileSync(file, "utf8"), name)) {
        violations.push(
          `${normalized(file).split("/modules/")[1]}: .${name} legt geteilte Geometrie fest, ` +
            `aber ueber Zeile ${line} steht kein Hinweis darauf, welche Ansichten sie noch ` +
            "tragen. Einen Satz darueber setzen.",
        );
      }
    }
  }

  return violations.sort();
}

export function formatSharedFeatureClassReport(violations) {
  return violations.length
    ? ["Geteilte Feature-Klassen:", ...violations.map((line) => `- ${line}`)].join(NEWLINE)
    : "Geteilte Feature-Klassen sind angemeldet.";
}
