// The test world: one structure per part and one dictionary per part and language. Every
// suite, the README pictures and the shipped example world are built from it. See
// parts/<part>.mjs for what is fixed and texts/<part>.<lang>.mjs for what is spoken.
//
// The base world is the one that is photographed and shipped; further parts are appended
// after it and never ship.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describeWorld } from "./parts/base.mjs";
import { describeEdge } from "./parts/edge.mjs";
import { texts as baseDe } from "./texts/base.de.mjs";
import { texts as baseEn } from "./texts/base.en.mjs";
import { texts as edgeDe } from "./texts/edge.de.mjs";
import { texts as edgeEn } from "./texts/edge.en.mjs";

export const LANGUAGES = ["de", "en"];

/** The parts of the world in build order; `base` is always built first. */
export const PARTS = ["base", "edge"];

/** The dictionary of every part, per language. */
export const PART_DICTIONARIES = {
  base: { de: baseDe, en: baseEn },
  edge: { de: edgeDe, en: edgeEn },
};

/** What each part appends to the world built so far. */
const DESCRIBE = { edge: describeEdge };

/** Every text of a language, all parts together. A key that two parts share is an error. */
function dictionary(lang, parts) {
  const merged = {};
  for (const part of parts) {
    const texts = PART_DICTIONARIES[part]?.[lang];
    if (!texts) throw new Error(`The ${part} part has no ${lang} texts.`);
    for (const [key, text] of Object.entries(texts)) {
      if (key in merged) throw new Error(`The text "${key}" is defined by two parts.`);
      merged[key] = text;
    }
  }
  return merged;
}

/** Every text of every part, per language. */
export const DICTIONARIES = Object.fromEntries(
  LANGUAGES.map((lang) => [lang, dictionary(lang, PARTS)]),
);

/** The picture behind the city level. Upload it first; its id is the SHA-256 of the file. */
export const HARBOUR_MAP_FILE = join(dirname(fileURLToPath(import.meta.url)), "harbour-map.png");

export function harbourMapId() {
  return createHash("sha256").update(readFileSync(HARBOUR_MAP_FILE)).digest("hex");
}

/**
 * Builds the world for one language.
 *
 * `include` names the parts to build; `base` is always among them. With `probe` every text
 * is replaced by its key and every reference by an empty span, so that two languages can be
 * compared for everything that is not language. `used` collects the keys the structure
 * asked for.
 */
export function buildExampleWorld(
  lang,
  { include = ["base"], probe = false, used = new Set() } = {},
) {
  if (!LANGUAGES.includes(lang)) throw new Error(`Unknown example world language "${lang}".`);
  for (const part of include) {
    if (!PARTS.includes(part)) throw new Error(`Unknown part of the test world "${part}".`);
  }
  const parts = PARTS.filter((part) => part === "base" || include.includes(part));
  const texts = dictionary(lang, parts);

  const t = (key) => {
    used.add(key);
    if (probe) return `⟦${key}⟧`;
    const text = texts[key];
    if (typeof text !== "string") throw new Error(`The ${lang} texts have no "${key}".`);
    return text;
  };

  /** Where `surfaceKey`'s text stands in `text`, in UTF-16 units like every offset in Quiltor. */
  const locate = (text, surfaceKey) => {
    const surface = t(surfaceKey);
    if (probe) return { from: 0, to: surface.length, surface };
    const from = text.indexOf(surface);
    if (from < 0) {
      throw new Error(`"${surface}" (${surfaceKey}) does not occur in the ${lang} text.`);
    }
    return { from, to: from + surface.length, surface };
  };

  const api = {
    lang,
    t,
    reference: (text, id, target, surfaceKey) => ({
      id,
      target,
      ...pick(locate(text, surfaceKey), ["from", "to", "surface"]),
    }),
    mention: (text, id, elementId, surfaceKey) => ({
      id,
      elementId,
      ...pick(locate(text, surfaceKey), ["from", "to", "surface"]),
      source: "deterministic",
      confidence: 1,
    }),
    mark: (text, surfaceKey, kind) => {
      const { from, to } = locate(text, surfaceKey);
      return { from, to, kind };
    },
    /** Headings and paragraphs as one note text; headings become marks at their own offsets. */
    noteDoc: (sections) => {
      let text = "";
      const marks = [];
      for (const section of sections) {
        if (text) text += "\n\n";
        const heading = t(section.heading);
        marks.push({
          from: text.length,
          to: text.length + heading.length,
          kind: "heading",
          level: section.level,
        });
        text += `${heading}\n${t(section.body)}`;
      }
      return { text, marks };
    },
  };

  const world = describeWorld(api, harbourMapId());
  for (const part of parts) if (part !== "base") DESCRIBE[part](api, world);
  return world;
}

/** The name the world is created under; it is spoken, not part of the structure. */
export function exampleWorldTitle(lang) {
  const title = DICTIONARIES[lang]?.["world.title"];
  if (typeof title !== "string" || !title)
    throw new Error(`The ${lang} texts have no world title.`);
  return title;
}

/** The dictionary keys the world uses: the structure's and the world title. */
export function structureKeys(include = PARTS) {
  const used = new Set(["world.title"]);
  buildExampleWorld("de", { include, probe: true, used });
  return used;
}

function pick(source, keys) {
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}
