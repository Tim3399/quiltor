// The generator of the large part's chapters (T-339): readable German prose of a chosen
// length, drawn with a fixed seed from a closed segment of the sentence bank.
//
// Determinism: everything follows from the seeds and the German bank. The sequence of
// sentences, the names put into them and the paragraph and scene breaks are chosen once,
// against the German words, and every language fills the same sequence with its own texts.
// The two languages are therefore one structure, and the length of a chapter is always the
// German length (plan D-T-339-1, F-339-6).
//
// Coverage: before drawing freely, the book walks once through every sentence of its
// segment in seeded order, so every sentence is used at least once whatever the seed (F-339-4).

import { createHash } from "node:crypto";

/** A small, well-known 32-bit generator: the same seed gives the same numbers everywhere. */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Words as the budget tests and the importers count them: runs of non-space. */
export function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

const SCENE_BREAK = "***";
const PLACEHOLDER = /\{(figur|ort)\}/g;

/** A seeded permutation of 0..n-1. */
function permutation(n, random) {
  const order = Array.from({ length: n }, (_, index) => index);
  for (let index = n - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [order[index], order[other]] = [order[other], order[index]];
  }
  return order;
}

/**
 * Plans every chapter of a book.
 *
 * `bank` is the segment: its keys in order and the German text of each. `people` and
 * `places` are the German names the placeholders can take, by index. Each chapter names its
 * `seed` and its target `words`; a chapter ends with the first sentence that reaches the
 * target. The result is, per chapter, a list of tokens: a sentence `{ key, fill }` with the
 * index of the person or place for each placeholder, a paragraph break, or a scene break.
 */
export function planBook({ seed, bank, people, places, chapters }) {
  const cover = permutation(bank.length, mulberry32(seed));
  let next = 0;
  return chapters.map((chapter) => {
    const random = mulberry32(chapter.seed);
    const pick = (count) => Math.floor(random() * count);
    const cast = Array.from({ length: 5 }, () => pick(people.length));
    const setting = Array.from({ length: 3 }, () => pick(places.length));
    const tokens = [];
    let words = 0;
    let paragraphs = 0;
    let sceneEvery = 5 + pick(5);
    let previous = -1;
    while (words < chapter.words) {
      const length = 3 + pick(5);
      for (let sentence = 0; sentence < length && words < chapter.words; sentence += 1) {
        let index = next < cover.length ? cover[next++] : pick(bank.length);
        // No sentence twice in a row (F-339-13).
        while (index === previous) index = pick(bank.length);
        previous = index;
        const { key, de } = bank[index];
        const fill = [...de.matchAll(PLACEHOLDER)].map(([, kind]) =>
          kind === "figur" ? cast[pick(cast.length)] : setting[pick(setting.length)],
        );
        tokens.push({ key, fill });
        words += wordCount(render(de, fill, people, places));
      }
      paragraphs += 1;
      if (words >= chapter.words) break;
      if (paragraphs % sceneEvery === 0) {
        tokens.push({ scene: true });
        // The scene break is a word to every counter that splits at spaces.
        words += wordCount(SCENE_BREAK);
        sceneEvery = 5 + pick(5);
      } else {
        tokens.push({ paragraph: true });
      }
    }
    return { id: chapter.id, tokens, words };
  });
}

/** One sentence with its placeholders filled, in the order they stand. */
function render(text, fill, people, places) {
  let at = 0;
  return text.replace(PLACEHOLDER, (_, kind) => {
    const index = fill[at++];
    return kind === "figur" ? people[index] : places[index];
  });
}

/** A chapter's text in one language: `textOf(key)` gives that language's sentence. */
export function renderChapter(tokens, textOf, people, places) {
  let body = "";
  let paragraph = [];
  const close = () => {
    if (paragraph.length) body += (body ? "\n\n" : "") + paragraph.join(" ");
    paragraph = [];
  };
  for (const token of tokens) {
    if (token.paragraph) close();
    else if (token.scene) {
      close();
      body += `\n\n${SCENE_BREAK}`;
    } else paragraph.push(render(textOf(token.key), token.fill, people, places));
  }
  close();
  return body;
}

/** A short, language-independent fingerprint of a chapter's plan, for the lock. */
export function planDigest(tokens) {
  const line = tokens
    .map((token) =>
      token.paragraph ? "|" : token.scene ? "#" : `${token.key}:${token.fill.join(",")}`,
    )
    .join(" ");
  return createHash("sha256").update(line).digest("hex").slice(0, 16);
}

/**
 * Where a placeholder may stand in a German sentence: where the form of the name does not
 * depend on the case (texts/large.de.mjs). Returns the offending sentences.
 */
export function misplacedPlaceholders(sentences) {
  const allowed = [
    /^\{(figur|ort)\}/, // at the start
    /(sagte|fragte|rief|antwortete|flüsterte) \{figur\}/, // after a speech verb
    /, \{figur\}[.!?]/, // an address before the closing punctuation
    /(in|nach|aus|von) \{ort\}/, // a place after a preposition that takes no article
  ];
  return sentences.filter((sentence) => {
    let rest = sentence;
    for (const pattern of allowed) rest = rest.replace(new RegExp(pattern, "g"), "");
    return /\{(figur|ort)\}/.test(rest);
  });
}
