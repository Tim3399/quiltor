/**
 * Spelling guard for German interface text.
 *
 * `FORBIDDEN_SPELLINGS` is the list; `findForbiddenSpellings` applies it to one piece of text.
 * `check_i18n.mjs` feeds it every string in `locales/de/*.ts` and every string literal or JSX
 * text node in the client sources. A match fails `npm run check`.
 *
 * Extending the list: add a row, with a comment saying where the wrong spelling comes from.
 * `pattern` must not match the correct spelling, and `use` is the replacement shown to the
 * developer. Keep patterns narrow: a rule that fires on legitimate German is worse than none,
 * and there is no per-line escape hatch on purpose -- narrow the pattern or drop the row.
 */

export const FORBIDDEN_SPELLINGS = [
  // --- ss instead of ß (a Swiss or keyboard habit; the product writes standard German) ---
  // The map scale was spelled "Massstab" in a menu once. Covers Massstabsleiste, Massstab-Popover.
  { pattern: /ma(?:ss|s)stab/i, use: "Maßstab" },
  // "Grösse", "Groesse", "Grösser": size and comparative.
  { pattern: /gr(?:ö|oe)ss/i, use: "Größ…" },
  // "Fussnote", "Fusszeile": the ß is long-vowel, so ss is wrong in standard German.
  { pattern: /fuss(?=note|zeile|leiste)/i, use: "Fuß…" },
  // schliessen, anschliessend, einschliesslich, Schliessen.
  { pattern: /schliess/i, use: "schließ…" },
  // "ausserdem", "ausserhalb", "Aussenrand", "aussen".
  { pattern: /\bauss(?:er|en)/i, use: "außer…/außen…" },
  // "Fliesstext": the running-text term.
  { pattern: /fliess/i, use: "fließ…" },
  // "Massnahme".
  { pattern: /massnahme/i, use: "Maßnahme" },
  // Lower-case "gross", "grosse", "grossen": big. Capitalised "Gross" is a surname and stays legal.
  { pattern: /\bgross(?:e[nmrs]?)?\b/, use: "groß…" },
  // "weiss" (white, knows). Lower-case only, "Weiss" can be a name.
  { pattern: /\bweiss\b/, use: "weiß" },

  // --- ae/oe/ue instead of an umlaut (ASCII transliteration from a keyboard without umlauts) ---
  // Whole words only: "neue", "Quelle" and "Konsequenz" contain the letter pairs legitimately.
  { pattern: /\b(?:fuer|ueber|zurueck)\w*/i, use: "für / über / zurück" },
  {
    pattern: /\b\w*(?:pruef|loesch|waehl|oeffn|hinzufuegen|einfuegen)\w*/i,
    use: "prüf… / lösch… / wähl… / öffn… / …fügen",
  },
  {
    pattern: /\b(?:aender|aenderung|laenge|faehig|koenn|moecht)\w*/i,
    use: "änder… / Länge / fähig / könn… / möcht…",
  },

  // --- Hyphen and compound variants of the product's own terms ---
  // "Storyboard" is one word, so is "Figurenboard"; the spaced and hyphenated forms drifted in drafts.
  { pattern: /\bStory[- ]Boards?\b/i, use: "Storyboard" },
  { pattern: /\bFiguren[- ]Boards?\b/i, use: "Figurenboard" },
  // "E-Reader" (EPUB reader): with hyphen, capital R.
  { pattern: /\b(?:E ?-?reader|Ereader|E-reader)\b/, use: "E-Reader" },
  // "E-Mail": with hyphen, capital M.
  { pattern: /\b(?:Email|E-mail|e-?mail)\b/, use: "E-Mail" },
  // Cloud backup is hyphenated everywhere ("Cloud-Backup", "Cloud-Konto"); the variants break the pattern.
  {
    pattern: /\bCloud(?:backup|konto|speicher|ziel| Backup| Konto| Speicher| Ziel)\b/,
    use: "Cloud-Backup / Cloud-Konto / Cloud-Speicher / Cloud-Ziel",
  },
  // The product name as the first part of a compound is "Quiltor-" (capital Q). The file extension
  // ".quiltor-Projekt" is legitimate and not matched because of the leading dot.
  { pattern: /(?<![.\w])quiltor-(?=[A-ZÄÖÜ])/, use: "Quiltor-…" },
  { pattern: /\bQuiltor (?=Projekt|Version|Roman)/, use: "Quiltor-…" },
  // "Backup" is one word without hyphen in this product ("Cloud-Backup", "Backup-Endpunkt").
  { pattern: /\bBack-up\b/i, use: "Backup" },

  // --- Terms of the world (one word per concept; the interface says Figur, Ort, Timeline) ---
  // The timeline view is called "Timeline" in every button and heading; "Zeitleiste" and "Zeitstrahl"
  // appeared once in a hint and made the same object look like two.
  { pattern: /\b(?:Zeitleiste|Zeitstrahl|Time-line|Time Line)\w*/, use: "Timeline" },
  // A place is an "Ort"; "Schauplatz" and the English "Location" name the same node differently.
  { pattern: /\b(?:Schauplatz|Schauplätze\w*|Locations?)\b/, use: "Ort / Orte" },
  // English node names in German text: "Character(s)" for Figur(en).
  { pattern: /\bCharacters?\b/, use: "Figur / Figuren" },
  // The inspector is spelled "Inspector" ("Figuren-Inspector"), not the German "Inspektor".
  { pattern: /\bInspektor\w*/, use: "Inspector" },
];

/**
 * Matches of the forbidden list in one piece of text.
 * @param {string} text
 * @returns {{ found: string, use: string, index: number }[]}
 */
export function findForbiddenSpellings(text) {
  const hits = [];
  for (const { pattern, use } of FORBIDDEN_SPELLINGS) {
    const global = new RegExp(
      pattern.source,
      pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
    );
    for (const match of text.matchAll(global)) {
      hits.push({ found: match[0], use, index: match.index ?? 0 });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

const doubleQuoted = /"(?:\\.|[^"\\\n])*"/g;
const singleQuoted = /'(?:\\.|[^'\\\n])*'/g;
const template = /`(?:\\.|[^`\\])*`/g;
const jsxText = />([^<>{}\n]+)</g;

/**
 * Strings in a source file whose spelling must be right: string literals and JSX text.
 * Comments and identifiers are developer-facing and skipped on purpose; a comment line is
 * dropped before matching so a quoted German string in an English comment is not a finding.
 * @param {string} source
 * @returns {{ text: string, line: number }[]}
 */
export function stringsInSource(source) {
  const strings = [];
  source.split("\n").forEach((rawLine, index) => {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    const line = rawLine.replace(/\s\/\/.*$/, "");
    for (const re of [doubleQuoted, singleQuoted, template]) {
      for (const match of line.matchAll(re))
        strings.push({ text: match[0].slice(1, -1), line: index + 1 });
    }
    for (const match of line.matchAll(jsxText)) strings.push({ text: match[1], line: index + 1 });
  });
  return strings;
}
