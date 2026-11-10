// The frozen picture of the test world: world.lock.json.
//
// The world may grow, it may not change (CLAUDE.md, "The test world grows, it does not
// change"). The lock holds every entry of the world -- an element, a chapter, a card, a
// month -- with its language-independent structure, and every text in both languages.
// world.test.mjs compares the world against it: an entry the lock knows must be unchanged,
// an entry it does not know needs `npm run world:update`. A change to what exists is
// therefore always a visible diff of this file, next to the tests it had to take along.
//
// Each text also records which German text its English one was translated from. German
// leads; when the German text changes and the English one does not, the translation is
// stale until someone updates it or confirms it is still right
// (`npm run world:update -- --confirm-translation <key>`).

import { createHash } from "node:crypto";
import { buildExampleWorld, DICTIONARIES, PARTS } from "./index.mjs";

export const LOCK_FILE = "tests/world/world.lock.json";

const sha = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** The id an array element is known by: its id, a binned chapter's id, or its position. */
function entryName(item, index) {
  if (item && typeof item === "object") {
    if (typeof item.id === "string") return item.id;
    if (typeof item.chapter?.id === "string") return item.chapter.id;
  }
  return `#${index}`;
}

/** Every entry of the structure: array elements one by one, other values by their path. */
function flatten(value, path, out) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      out[`${path}[${entryName(item, index)}]`] = item;
    });
    return out;
  }
  const rest = {};
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item) || (item && typeof item === "object")) {
      flatten(item, `${path}.${key}`, out);
    } else {
      rest[key] = item;
    }
  }
  if (Object.keys(rest).length) out[path] = rest;
  return out;
}

/** The structure of the whole world with every text replaced by its key. */
function lockStructure() {
  return flatten(buildExampleWorld("de", { include: PARTS, probe: true }), "world", {});
}

/**
 * The lock as it should be now. `previous` is the lock on disk; it decides which German text
 * an unchanged English text was translated from. `confirmed` names keys whose translation a
 * person confirmed is still right.
 */
export function renderLock(previous = null, confirmed = new Set()) {
  const texts = {};
  for (const key of Object.keys(DICTIONARIES.de).sort()) {
    const de = DICTIONARIES.de[key];
    const en = DICTIONARIES.en[key];
    const before = previous?.texts?.[key];
    const translated = !before || before.en !== en || confirmed.has(key);
    texts[key] = { de, en, translatedFrom: translated ? sha(de) : before.translatedFrom };
  }
  return { structure: lockStructure(), texts };
}

/** What differs between the lock on disk and the world: changed, removed and new entries. */
export function lockDifferences(lock) {
  const changed = [];
  const added = [];
  const stale = [];
  const now = renderLock(lock);
  for (const section of ["structure", "texts"]) {
    const before = lock[section] ?? {};
    const after = now[section];
    for (const [key, value] of Object.entries(before)) {
      if (!(key in after)) {
        changed.push(`${key} was removed`);
        continue;
      }
      const left = section === "texts" ? { de: value.de, en: value.en } : value;
      const right = section === "texts" ? { de: after[key].de, en: after[key].en } : after[key];
      if (canonicalJson(left) !== canonicalJson(right)) changed.push(`${key} changed`);
    }
    for (const key of Object.keys(after)) if (!(key in before)) added.push(key);
  }
  for (const [key, value] of Object.entries(lock.texts ?? {})) {
    const de = DICTIONARIES.de[key];
    if (typeof de === "string" && value.translatedFrom !== sha(de) && value.de === de) {
      stale.push(key);
    }
  }
  return { changed, added, stale };
}

/** The same value with every object's keys sorted, as one line of JSON. */
function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}

/** The lock file's bytes. */
export function lockBytes(lock) {
  return Buffer.from(`${JSON.stringify(sortKeys(lock), null, 2)}\n`, "utf8");
}
