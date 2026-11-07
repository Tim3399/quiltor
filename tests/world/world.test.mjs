import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildExampleWorld,
  DICTIONARIES,
  exampleWorldTitle,
  harbourMapId,
  LANGUAGES,
  structureKeys,
} from "./index.mjs";
import { renderShipFiles, SHIP_DIRECTORY, SHIP_FORMAT } from "./ship.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/*
 * Which fields of the world are language and which are identity.
 *
 * TEXT: spoken in the author's language; the two worlds may differ here, and only here. A
 *       person's or an animal's `name` is not in the list: Mara Venn stays Mara Venn.
 * OFFSET: positions inside a text; they follow the translation, and the "every span hits"
 *       test below checks that they land on what they name.
 * Everything else is IDENTITY: ids, kinds, positions, times, targets, counts. Any difference
 * there between two languages fails, including a field nobody has listed.
 */
const TEXT_FIELDS = new Set([
  "title",
  "body",
  "note",
  "notes",
  "label",
  "sub",
  "text",
  "surface",
  "value",
  "key",
  "alias",
  "w",
  "d",
  "shortName",
  "eraName",
  "eraAbbreviation",
  "displayFormat",
]);
const OFFSET_FIELDS = new Set(["from", "to"]);
const NAMED_IN_BOTH = new Set(["person", "tier"]);

function isTextField(key, parent, path) {
  if (TEXT_FIELDS.has(key)) return true;
  if (/activeSymbols\[\d+\]$/.test(path)) return true;
  if (key === "name") return !NAMED_IN_BOTH.has(parent.type);
  return false;
}

/** Walks two worlds side by side and collects every difference that is not language. */
function identityDifferences(a, b, path = "world", parent = {}) {
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) return [`${path}: type`];
  if (Array.isArray(a)) {
    if (a.length !== b.length) return [`${path}: ${a.length} items against ${b.length}`];
    return a.flatMap((item, index) =>
      typeof item === "string" && /activeSymbols$/.test(path)
        ? []
        : identityDifferences(item, b[index], `${path}[${index}]`, parent),
    );
  }
  if (a !== null && typeof a === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((key) => {
      if (!(key in a) || !(key in b)) return [`${path}.${key}: only in one language`];
      const here = `${path}.${key}`;
      if (typeof a[key] === "string" && typeof b[key] === "string") {
        if (OFFSET_FIELDS.has(key) || isTextField(key, a, here)) return [];
        return a[key] === b[key] ? [] : [`${here}: "${a[key]}" against "${b[key]}"`];
      }
      if (OFFSET_FIELDS.has(key)) return [];
      return identityDifferences(a[key], b[key], here, a);
    });
  }
  return a === b ? [] : [`${path}: ${a} against ${b}`];
}

function* everyString(value, path = "world") {
  if (typeof value === "string") yield [path, value];
  else if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) yield* everyString(item, `${path}[${index}]`);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) yield* everyString(item, `${path}.${key}`);
  }
}

test("both languages have exactly the keys the structure asks for", () => {
  const needed = structureKeys();
  for (const lang of LANGUAGES) {
    const keys = new Set(Object.keys(DICTIONARIES[lang]));
    assert.deepEqual(
      [...needed].filter((key) => !keys.has(key)),
      [],
      `${lang}: keys the structure uses but the texts lack`,
    );
    assert.deepEqual(
      [...keys].filter((key) => !needed.has(key)),
      [],
      `${lang}: keys in the texts that nothing uses`,
    );
  }
  assert.deepEqual(
    Object.keys(DICTIONARIES.de).sort(),
    Object.keys(DICTIONARIES.en).sort(),
    "the two dictionaries name different keys",
  );
});

test("no text of either language is empty", () => {
  for (const lang of LANGUAGES) {
    const empty = Object.entries(DICTIONARIES[lang])
      .filter(([, text]) => typeof text !== "string" || text.trim() === "")
      .map(([key]) => key);
    assert.deepEqual(empty, [], `${lang}: empty texts`);
  }
});

test("with every text replaced by its key the two worlds are identical", () => {
  const [first, second] = LANGUAGES.map((lang) => buildExampleWorld(lang, { probe: true }));
  assert.deepEqual(second, first);
});

test("the finished worlds differ in language only", () => {
  const [german, english] = LANGUAGES.map((lang) => buildExampleWorld(lang));
  assert.deepEqual(identityDifferences(german, english), []);
  assert.notEqual(german.manuscript.chapters[0].body, english.manuscript.chapters[0].body);
  assert.notEqual(exampleWorldTitle("de"), exampleWorldTitle("en"));
});

test("the language-independent comparison notices a changed identity field", () => {
  const [german, english] = LANGUAGES.map((lang) => buildExampleWorld(lang));
  english.figures.nodes[0].x += 1;
  english.figures.timeline[3].time += 1;
  english.figures.nodes.find((node) => node.id === "mara").name = "Mara Wenn";
  assert.equal(identityDifferences(german, english).length, 3);
});

test("every reference, mention and mark hits what it names, in both languages", () => {
  for (const lang of LANGUAGES) {
    const { manuscript, figures, storyboards } = buildExampleWorld(lang);
    const spans = [];
    for (const chapter of manuscript.chapters) {
      for (const mention of chapter.mentions ?? []) spans.push([chapter.body, mention]);
      for (const mark of chapter.marks ?? []) spans.push([chapter.body, mark]);
    }
    for (const node of figures.nodes) {
      const profile = node.profile;
      for (const reference of profile.noteReferences ?? []) spans.push([profile.notes, reference]);
      for (const mark of profile.noteMarks ?? []) spans.push([profile.notes, mark]);
    }
    for (const node of storyboards.nodes) {
      for (const reference of node.noteReferences ?? []) spans.push([node.text, reference]);
    }
    assert.ok(spans.length >= 10, `${lang}: only ${spans.length} spans were found`);
    for (const [text, span] of spans) {
      assert.ok(
        span.from >= 0 && span.from < span.to && span.to <= text.length,
        `${lang}: span ${span.from}-${span.to} leaves its text`,
      );
      if (span.surface !== undefined) {
        assert.equal(text.slice(span.from, span.to), span.surface, `${lang}: ${span.id}`);
      }
    }
    // Spans within one text keep to reading order and never overlap.
    for (const list of [
      ...figures.nodes.map((node) => node.profile.noteReferences ?? []),
      ...storyboards.nodes.map((node) => node.noteReferences ?? []),
    ]) {
      for (let index = 1; index < list.length; index += 1) {
        assert.ok(list[index].from >= list[index - 1].to, `${lang}: ${list[index].id} overlaps`);
      }
    }
  }
});

test("the world has the scope the screenshots rely on", () => {
  for (const lang of LANGUAGES) {
    const { manuscript, figures, storyboards } = buildExampleWorld(lang);
    const kinds = (type) => figures.nodes.filter((node) => node.type === type).length;
    assert.equal(manuscript.chapters.length, 8, lang);
    assert.equal(manuscript.trash.length, 1, lang);
    assert.equal(manuscript.structure.folders.length, 2, lang);
    assert.equal(manuscript.words.length, 5, lang);
    assert.ok(
      manuscript.chapters.every((chapter) => chapter.note.trim()),
      `${lang}: chapter notes`,
    );
    assert.equal(manuscript.chapters.filter((chapter) => chapter.storyTime).length, 6, lang);
    assert.equal(
      manuscript.chapters.filter((chapter) => chapter.body.includes("\n***\n")).length,
      2,
      lang,
    );
    assert.deepEqual(
      [kinds("person"), kinds("tier"), kinds("organisation"), kinds("objekt"), kinds("ort")],
      [6, 1, 2, 2, 5],
      lang,
    );
    assert.equal(figures.nodes.length, 16, lang);
    assert.equal(figures.nodes.filter((node) => node.important).length, 2, lang);
    assert.equal(figures.edges.length, 14, lang);
    assert.equal(figures.edges.filter((edge) => edge.versions).length, 3, lang);
    assert.equal(figures.timeline.length, 8, lang);
    assert.equal(figures.presence.length, 8, lang);
    assert.equal(figures.timeSystem.kind, "custom", lang);
    assert.equal(figures.nodes.filter((node) => node.diedMomentId === "t7").length, 1, lang);

    const city = figures.nodes.find((node) => node.id === "nordhafen");
    assert.equal(city.mapImageId, harbourMapId(), lang);
    assert.equal(figures.nodes.filter((node) => node.parentPlaceId === "nordhafen").length, 3);
    assert.equal(figures.nodes.filter((node) => node.mapImageId).length, 1, lang);

    const count = (kind) => storyboards.nodes.filter((node) => node.kind === kind).length;
    assert.deepEqual(
      [storyboards.boards.length, storyboards.nodes.length, storyboards.edges.length],
      [2, 14, 8],
      lang,
    );
    assert.deepEqual(
      [count("group"), count("note"), count("reference"), count("storyboard")],
      [2, 5, 5, 2],
      lang,
    );
    // T-177: a reference card has no text of its own, the note of its element is shown.
    for (const card of storyboards.nodes.filter((node) => node.kind === "reference")) {
      assert.equal("text" in card, false, `${lang}: ${card.id} carries its own text`);
    }
    for (const node of figures.nodes) {
      assert.ok(node.profile.notes.trim(), `${lang}: ${node.id} has no note`);
    }
  }
});

test("every id of the world is used once and every target exists", () => {
  const { manuscript, figures, storyboards } = buildExampleWorld("en");
  const ids = [
    ...manuscript.chapters.map((chapter) => chapter.id),
    ...figures.nodes.map((node) => node.id),
    ...figures.edges.map((edge) => edge.id),
    ...figures.timeline.map((moment) => moment.id),
  ];
  assert.equal(new Set(ids).size, ids.length);
  const nodeIds = new Set(figures.nodes.map((node) => node.id));
  const momentIds = new Set(figures.timeline.map((moment) => moment.id));
  for (const edge of figures.edges) {
    assert.ok(nodeIds.has(edge.from) && nodeIds.has(edge.to), edge.id);
    for (const version of edge.versions ?? []) assert.ok(momentIds.has(version.momentId), edge.id);
  }
  for (const entry of figures.presence) {
    assert.ok(nodeIds.has(entry.elementId) && nodeIds.has(entry.placeId), entry.id);
    assert.ok(momentIds.has(entry.momentId), entry.id);
  }
  const cardIds = new Set(storyboards.nodes.map((node) => node.id));
  for (const edge of storyboards.edges) {
    assert.ok(cardIds.has(edge.sourceNodeId) && cardIds.has(edge.targetNodeId), edge.id);
  }
  const strings = [...everyString({ manuscript, figures, storyboards })];
  assert.ok(
    strings.every(([, value]) => !value.includes("⟦")),
    "a probe marker leaked",
  );
});

test("an unknown part of the world is refused", () => {
  assert.throws(() => buildExampleWorld("de", { include: ["nonsense"] }), /Unknown part/);
});

test("the shipped files are what the test world renders; run npm run world:update", () => {
  for (const [path, bytes] of Object.entries(renderShipFiles())) {
    const target = join(repositoryRoot, path);
    assert.ok(existsSync(target), `${path} is missing; run npm run world:update`);
    assert.ok(readFileSync(target).equals(bytes), `${path} is stale; run npm run world:update`);
  }
});

test("the shipped world is the base world and nothing else", () => {
  for (const lang of LANGUAGES) {
    const shipped = JSON.parse(
      readFileSync(join(repositoryRoot, SHIP_DIRECTORY, `${lang}.json`), "utf8"),
    );
    const base = buildExampleWorld(lang, { include: ["base"] });
    assert.equal(shipped.format, SHIP_FORMAT, lang);
    assert.equal(shipped.title, exampleWorldTitle(lang), lang);
    assert.equal(shipped.mapImage.id, harbourMapId(), lang);
    assert.deepEqual(shipped.manuscript, base.manuscript, lang);
    assert.deepEqual(shipped.storyWorld, base.figures, lang);
    assert.deepEqual(shipped.storyboards, base.storyboards, lang);
    // Ids of the check part start with "x-"; none of them may ever ship.
    const ids = [...everyString(shipped)].filter(([path]) =>
      /\.(id|elementId|from|to|target\.id)$/.test(path),
    );
    assert.deepEqual(
      ids.filter(([, value]) => value.startsWith("x-")),
      [],
      `${lang}: a check-part id ships`,
    );
  }
});
