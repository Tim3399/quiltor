// The example world of the README screenshots, built from one structure and one dictionary
// per language. See structure.mjs for what is fixed and texts.<lang>.mjs for what is spoken.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describeWorld } from "./structure.mjs";
import { texts as de } from "./texts.de.mjs";
import { texts as en } from "./texts.en.mjs";

export const LANGUAGES = ["de", "en"];
export const DICTIONARIES = { de, en };

/** The picture behind the city level. Upload it first; its id is the SHA-256 of the file. */
export const HARBOUR_MAP_FILE = join(dirname(fileURLToPath(import.meta.url)), "harbour-map.png");

export function harbourMapId() {
  return createHash("sha256").update(readFileSync(HARBOUR_MAP_FILE)).digest("hex");
}

/**
 * Builds the world for one language.
 *
 * With `probe` every text is replaced by its key and every reference by an empty span, so that
 * two languages can be compared for everything that is not language. `used` collects the keys
 * the structure asked for.
 */
export function buildExampleWorld(lang, { probe = false, used = new Set() } = {}) {
  const dictionary = DICTIONARIES[lang];
  if (!dictionary) throw new Error(`Unknown example world language "${lang}".`);

  const t = (key) => {
    used.add(key);
    if (probe) return `⟦${key}⟧`;
    const text = dictionary[key];
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

  return describeWorld(api, harbourMapId());
}

/** The name the world is created under; it is spoken, not part of the structure. */
export function exampleWorldTitle(lang) {
  const title = DICTIONARIES[lang]?.["world.title"];
  if (typeof title !== "string" || !title)
    throw new Error(`The ${lang} texts have no world title.`);
  return title;
}

/** The dictionary keys the world uses: the structure's and the world title. */
export function structureKeys() {
  const used = new Set(["world.title"]);
  buildExampleWorld("de", { probe: true, used });
  return used;
}

function pick(source, keys) {
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}
