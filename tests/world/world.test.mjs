import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CATALOG_FILE, PURPOSES, partOfIds, renderCatalog } from "./catalog.mjs";
import { IDS_FILE, renderIdsFile } from "./ids.mjs";
import {
  buildExampleWorld,
  DICTIONARIES,
  exampleWorldTitle,
  harbourMapId,
  LANGUAGES,
  PART_DICTIONARIES,
  PARTS,
  structureKeys,
} from "./index.mjs";
import { LOCK_FILE, lockBytes, lockDifferences, renderLock } from "./lock.mjs";
import { measurementWorlds, TIME_CHECK_ELEMENTS, TIME_CHECK_MOMENTS } from "./parts/gold.mjs";
import {
  BOOK,
  CHAPTERS as LARGE_CHAPTERS,
  PLAN as LARGE_PLAN,
  PERSON_GENDER,
} from "./parts/large.mjs";
import { exportWorld } from "./export.mjs";
import { misplacedPlaceholders, planBook, wordCount } from "./large/generate.mjs";
import { SEGMENT_S1 as LARGE_S1_DE } from "./texts/large.de.mjs";
import { SEGMENT_S1 as LARGE_S1_EN } from "./texts/large.en.mjs";
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
  // The expectations of the gold part: names, synonyms and keywords in the author's language.
  "names",
  "synonyms",
  "keys",
  "titles",
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
  const [first, second] = LANGUAGES.map((lang) =>
    buildExampleWorld(lang, { include: PARTS, probe: true }),
  );
  assert.deepEqual(second, first);
});

test("the finished worlds differ in language only", () => {
  const [german, english] = LANGUAGES.map((lang) => buildExampleWorld(lang, { include: PARTS }));
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
    const { manuscript, figures, storyboards } = buildExampleWorld(lang, { include: PARTS });
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
    // Every string is searched, not only the id fields: a parentFolderId or a card target
    // naming the check part would ship it just the same.
    assert.deepEqual(
      [...everyString(shipped)].filter(([, value]) => /^(item-)?x-/.test(value)),
      [],
      `${lang}: a check-part id ships`,
    );
    // The same for the gold part, on disk and in what ship.mjs renders now: no id starting
    // with "g-", no gold text key, no expectations.
    const rendered = JSON.parse(
      renderShipFiles()[`${SHIP_DIRECTORY}/${lang}.json`].toString("utf8"),
    );
    for (const [where, document] of [
      ["on disk", shipped],
      ["rendered", rendered],
    ]) {
      assert.deepEqual(
        [...everyString(document)].filter(([, value]) => /^(item-)?g-|^gold\./.test(value)),
        [],
        `${lang} ${where}: a gold-part id or text key ships`,
      );
      assert.equal(
        JSON.stringify(document).includes('"evaluation"'),
        false,
        `${lang} ${where}: the gold expectations ship`,
      );
    }
  }
});

/** Every id the world gives out, with the list it comes from. */
function worldIds({ manuscript, figures, storyboards }) {
  return [
    ...manuscript.chapters.map((chapter) => `chapter:${chapter.id}`),
    ...manuscript.trash.map((entry) => `chapter:${entry.chapter.id}`),
    ...manuscript.structure.folders.map((folder) => `folder:${folder.id}`),
    ...manuscript.structure.items.map((item) => `item:${item.id}`),
    ...figures.nodes.map((node) => `node:${node.id}`),
    ...figures.edges.map((edge) => `edge:${edge.id}`),
    ...figures.timeline.map((moment) => `moment:${moment.id}`),
    ...figures.presence.map((entry) => `presence:${entry.id}`),
    ...storyboards.boards.map((board) => `board:${board.id}`),
    ...storyboards.nodes.map((card) => `card:${card.id}`),
    ...storyboards.edges.map((edge) => `boardEdge:${edge.id}`),
  ];
}

const bareId = (entry) => entry.slice(entry.indexOf(":") + 1);

test("with every part the ids stay unique and every board target exists", () => {
  for (const lang of LANGUAGES) {
    const world = buildExampleWorld(lang, { include: PARTS });
    const ids = worldIds(world);
    assert.deepEqual(
      ids.filter((id, index) => ids.indexOf(id) !== index),
      [],
      `${lang}: ids given out twice`,
    );
    const boards = new Set(world.storyboards.boards.map((board) => board.id));
    for (const card of world.storyboards.nodes) assert.ok(boards.has(card.boardId), card.id);
  }
});

test("the check part only appends: the base world is a prefix of every list", () => {
  const base = buildExampleWorld("de");
  const all = buildExampleWorld("de", { include: PARTS });
  const lists = (world) => ({
    chapters: world.manuscript.chapters,
    trash: world.manuscript.trash,
    folders: world.manuscript.structure.folders,
    items: world.manuscript.structure.items,
    nodes: world.figures.nodes,
    edges: world.figures.edges,
    timeline: world.figures.timeline,
    presence: world.figures.presence,
    boards: world.storyboards.boards,
    cards: world.storyboards.nodes,
    boardEdges: world.storyboards.edges,
  });
  const [before, after] = [lists(base), lists(all)];
  for (const [name, list] of Object.entries(before)) {
    assert.deepEqual(after[name].slice(0, list.length), list, `${name} of the base world changed`);
  }
});

/** The id prefix of every part after the base world. */
const PART_PREFIX = { edge: "x-", gold: "g-", large: "l-" };

test("every id of a later part starts with its prefix, and no base id does", () => {
  const baseIds = new Set(worldIds(buildExampleWorld("de")));
  for (const part of PARTS.filter((name) => name !== "base")) {
    const prefix = PART_PREFIX[part];
    assert.ok(prefix, `the ${part} part has no id prefix`);
    const added = worldIds(buildExampleWorld("de", { include: [part] })).filter(
      (id) => !baseIds.has(id),
    );
    assert.ok(added.length >= 15, `only ${added.length} ids in the ${part} part`);
    for (const id of added) {
      const bare = bareId(id);
      assert.ok(
        bare.startsWith(prefix) || bare.startsWith(`item-${prefix}`),
        `${id} is in the ${part} part without ${prefix}`,
      );
    }
    for (const id of baseIds) {
      assert.ok(!bareId(id).startsWith(prefix), `${id} is a base id with ${prefix}`);
    }
  }
});

test("base and check part share no id and no text key", () => {
  const baseIds = worldIds(buildExampleWorld("de")).map(bareId);
  // What the check part adds, counted: an id the part repeats is still an addition.
  const added = worldIds(buildExampleWorld("de", { include: PARTS })).map(bareId);
  for (const id of baseIds) added.splice(added.indexOf(id), 1);
  const baseSet = new Set(baseIds);
  assert.deepEqual(
    added.filter((id) => baseSet.has(id)),
    [],
    "ids of the check part that the base world already uses",
  );
  for (const lang of LANGUAGES) {
    const owner = new Map();
    for (const part of PARTS) {
      for (const key of Object.keys(PART_DICTIONARIES[part][lang])) {
        assert.ok(!owner.has(key), `${lang}: text key ${key} in ${owner.get(key)} and ${part}`);
        owner.set(key, part);
      }
    }
  }
});

test("every gold expectation stands for an entry of the gold part", () => {
  const baseIds = new Set(worldIds(buildExampleWorld("de")).map(bareId));
  for (const lang of LANGUAGES) {
    const world = buildExampleWorld(lang, { include: ["gold"] });
    const goldIds = new Set(
      worldIds(world)
        .map(bareId)
        .filter((id) => !baseIds.has(id)),
    );
    const { gold } = world.evaluation;
    assert.ok(gold.length >= 30, `${lang}: only ${gold.length} gold expectations`);
    const ids = gold.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length, `${lang}: an expectation id given out twice`);
    const references = gold.flatMap((entry) =>
      [
        entry.ref,
        entry.from,
        entry.to,
        entry.elementId,
        entry.placeId,
        entry.chapterId,
        ...(entry.refs ?? []),
      ]
        .filter((value) => value !== undefined)
        .map((value) => [entry.id, value]),
    );
    for (const [id, value] of references) {
      assert.ok(value.startsWith("g-") && goldIds.has(value), `${lang}: ${id} points at ${value}`);
    }
    for (const entry of gold) {
      assert.ok(["extract", "missing"].includes(entry.task), `${lang}: ${entry.id} task`);
      assert.ok(["required", "optional"].includes(entry.need), `${lang}: ${entry.id} need`);
      for (const field of ["names", "synonyms", "keys"]) {
        if (field in entry)
          assert.ok(
            entry[field].split("|").every((item) => item.trim()),
            entry.id,
          );
      }
    }
    // Each expectation of a missing figure names somebody no world holds as an element.
    const elementNames = new Set(world.figures.nodes.map((node) => node.name.toLowerCase()));
    for (const entry of gold.filter((item) => item.task === "missing")) {
      for (const name of entry.names.split("|")) {
        assert.ok(!elementNames.has(name.toLowerCase()), `${lang}: ${name} is an element`);
      }
    }
  }
});

test("no gold name belongs to two gold entries", () => {
  const normalize = (name) =>
    name
      .normalize("NFKC")
      .toLowerCase()
      .replaceAll("ß", "ss")
      .replace(/[\p{P}]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  for (const lang of LANGUAGES) {
    const { gold } = buildExampleWorld(lang, { include: ["gold"] }).evaluation;
    const owner = new Map();
    for (const entry of gold.filter((item) => item.names)) {
      const who = entry.ref ?? entry.id;
      for (const name of entry.names.split("|").map(normalize)) {
        assert.ok(
          !owner.has(name) || owner.get(name) === who,
          `${lang}: "${name}" names ${owner.get(name)} and ${who}`,
        );
        owner.set(name, who);
      }
    }
  }
});

test("every measurement world holds only gold entries, and nothing points outside it", () => {
  for (const lang of LANGUAGES) {
    const worlds = measurementWorlds(buildExampleWorld(lang, { include: ["gold"] }));
    assert.deepEqual(
      Object.keys(worlds).filter((name) => name.startsWith("extract-")).length,
      10,
      `${lang}: extract worlds`,
    );
    for (const [name, { manuscript, figures }] of Object.entries(worlds)) {
      const ids = worldIds({
        manuscript,
        figures,
        storyboards: { boards: [], nodes: [], edges: [] },
      });
      for (const id of ids) {
        const bare = bareId(id);
        assert.ok(bare.startsWith("g-") || bare.startsWith("item-g-"), `${lang} ${name}: ${id}`);
      }
      assert.equal("timeSystem" in figures, false, `${lang} ${name}: a calendar came along`);
      const nodeIds = new Set(figures.nodes.map((node) => node.id));
      const momentIds = new Set(figures.timeline.map((moment) => moment.id));
      for (const edge of figures.edges) {
        assert.ok(nodeIds.has(edge.from) && nodeIds.has(edge.to), `${lang} ${name}: ${edge.id}`);
      }
      for (const entry of figures.presence) {
        assert.ok(nodeIds.has(entry.elementId) && nodeIds.has(entry.placeId), entry.id);
        assert.ok(momentIds.has(entry.momentId), `${lang} ${name}: ${entry.id}`);
      }
      for (const node of figures.nodes) {
        if (node.diedMomentId) assert.ok(momentIds.has(node.diedMomentId), `${lang} ${name}`);
      }
      for (const chapter of manuscript.chapters) {
        for (const mention of chapter.mentions ?? []) {
          if (name.startsWith("extract-B")) assert.ok(nodeIds.has(mention.elementId), mention.id);
        }
        if (name.startsWith("extract-A")) assert.equal("mentions" in chapter, false, chapter.id);
      }
      if (name === "time-check") continue;
      for (const id of [...TIME_CHECK_ELEMENTS, ...TIME_CHECK_MOMENTS]) {
        assert.ok(!nodeIds.has(id) && !momentIds.has(id), `${lang} ${name}: ${id} is measured`);
      }
    }
  }
});

test("every measurement world passes the server's validation", () => {
  const worlds = Object.fromEntries(
    LANGUAGES.flatMap((lang) =>
      Object.entries(measurementWorlds(buildExampleWorld(lang, { include: ["gold"] }))).map(
        ([name, world]) => [`${lang}:${name}`, world],
      ),
    ),
  );
  const script = [
    "import json, sys",
    "from quiltor.domain.story_world.validation import valid_figures, valid_manuscript",
    'worlds = json.loads(sys.stdin.buffer.read().decode("utf-8"))',
    "bad = [name for name, world in worlds.items()",
    "       if not valid_manuscript(world['manuscript']) or not valid_figures(world['figures'])]",
    "print(json.dumps(bad))",
  ].join("\n");
  const result = spawnSync(
    process.execPath,
    [join(repositoryRoot, "tools/dev/python.mjs"), "--needs", "quiltor", "-c", script],
    {
      cwd: repositoryRoot,
      input: JSON.stringify(worlds),
      encoding: "utf8",
      env: { ...process.env, PYTHONPATH: join(repositoryRoot, "src") },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(result.stdout.trim().split("\n").at(-1)),
    [],
    "worlds the server refuses",
  );
  assert.ok(Object.keys(worlds).length >= 26);
});

test("the check part carries the edge cases the suites rely on", () => {
  for (const lang of LANGUAGES) {
    const { manuscript, figures, storyboards } = buildExampleWorld(lang, { include: PARTS });
    const node = (id) => figures.nodes.find((item) => item.id === id);
    const cluster = figures.nodes.filter((item) => item.id.startsWith("x-cluster-"));
    assert.equal(cluster.length, 8, lang);
    assert.equal(cluster.filter((item) => item.important).length, 1, lang);
    const spread = (key) =>
      Math.max(...cluster.map((item) => item[key])) - Math.min(...cluster.map((item) => item[key]));
    assert.ok(spread("x") <= 60 && spread("y") <= 60, `${lang}: the cluster is not stacked`);
    assert.ok(node("x-long-name").name.length >= 60, lang);
    assert.ok(!/\s/.test(node("x-long-name").name), `${lang}: the long name can be broken`);
    assert.ok(node("x-long-place").name.length >= 50, lang);
    assert.equal(node("x-long-place").parentPlaceId, "nordhafen", lang);
    assert.ok(node("x-long-org").name.includes("'") || lang === "de", lang);
    assert.equal(node("x-empty-note").profile.notes, "", lang);
    assert.equal(manuscript.chapters.find((item) => item.id === "x-empty-chapter").body, "");
    const orphan = manuscript.trash.find((entry) => entry.chapter.id === "x-trash-orphan");
    const folders = new Set(manuscript.structure.folders.map((folder) => folder.id));
    assert.ok(!folders.has(orphan.treeItem.parentFolderId), `${lang}: the orphan has a folder`);
    const card = (id) => storyboards.nodes.find((item) => item.id === id);
    assert.ok(!figures.nodes.some((item) => item.id === card("x-ref-deleted").target.id));
    assert.equal(card("x-ref-trashed").target.id, "c-prologue", lang);
  }
});

test("the typed ids are what the test world renders; run npm run world:update", () => {
  const target = join(repositoryRoot, IDS_FILE);
  assert.ok(existsSync(target), `${IDS_FILE} is missing; run npm run world:update`);
  assert.ok(
    readFileSync(target).equals(renderIdsFile()),
    `${IDS_FILE} is stale; run npm run world:update`,
  );
});

const readLock = () => JSON.parse(readFileSync(join(repositoryRoot, LOCK_FILE), "utf8"));

test("nothing the lock knows has changed; the world only grows", () => {
  const { changed } = lockDifferences(readLock());
  assert.deepEqual(
    changed,
    [],
    "the test world changed what exists. Take every affected test and baseline along in the " +
      "same change, then run npm run world:update so the lock shows the change",
  );
});

test("every German text change reached the English translation", () => {
  const { stale } = lockDifferences(readLock());
  assert.deepEqual(
    stale,
    [],
    "the German text changed but its English translation did not. Update texts/*.en.mjs, or " +
      "if the English is still right: npm run world:update -- --confirm-translation <key>",
  );
});

test("the lock knows every entry of the world; run npm run world:update", () => {
  const { added } = lockDifferences(readLock());
  assert.deepEqual(added, [], "entries the lock does not know yet; run npm run world:update");
  assert.ok(
    readFileSync(join(repositoryRoot, LOCK_FILE)).equals(lockBytes(renderLock(readLock()))),
    `${LOCK_FILE} is stale; run npm run world:update`,
  );
});

test("every element and every entry of the check part says what it is for", () => {
  const owner = partOfIds();
  const world = buildExampleWorld("de", { include: PARTS });
  const missing = world.figures.nodes
    .map((node) => node.id)
    .filter((id) => !PURPOSES[owner.get(id)]?.[id]);
  for (const [id, part] of owner) {
    if (part !== "base" && !PURPOSES[part]?.[id]) missing.push(id);
  }
  assert.deepEqual(missing, [], "entries without a purpose in their part's PURPOSE table");
  for (const [part, table] of Object.entries(PURPOSES)) {
    for (const id of Object.keys(table)) {
      assert.equal(owner.get(id), part, `PURPOSE of ${part} names ${id}, which it does not hold`);
    }
  }
});

test("the catalog is what the test world renders; run npm run world:update", async () => {
  const target = join(repositoryRoot, CATALOG_FILE);
  assert.ok(existsSync(target), `${CATALOG_FILE} is missing; run npm run world:update`);
  assert.ok(
    readFileSync(target).equals(await renderCatalog()),
    `${CATALOG_FILE} is stale; run npm run world:update`,
  );
});

test("the gold set agrees with itself: its own entries as proposals score F1 = 1.0", () => {
  // The matcher compares German word forms (a genitive, a compound); a gold part whose own
  // moment is not found by its own keywords would put a floor under the German event score.
  const isGold = (item) => typeof item.id === "string" && item.id.startsWith("g-");
  for (const lang of LANGUAGES) {
    const world = buildExampleWorld(lang, { include: ["gold"] });
    const dump = {
      evaluation: world.evaluation,
      nodes: world.figures.nodes.filter(isGold),
      edges: world.figures.edges.filter(isGold),
      timeline: world.figures.timeline.filter(isGold),
      presence: world.figures.presence.filter(isGold),
    };
    const result = spawnSync(
      process.execPath,
      [
        join(repositoryRoot, "tools/dev/python.mjs"),
        "--needs",
        "json",
        join(repositoryRoot, "tests/world/gold_selfcheck.py"),
      ],
      { cwd: repositoryRoot, input: JSON.stringify(dump), encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout.trim().split("\n").at(-1));
    assert.ok(Object.keys(report).length >= 5, `${lang}: only ${Object.keys(report)} chapters`);
    for (const [chapter, categories] of Object.entries(report)) {
      for (const [category, f1] of Object.entries(categories)) {
        assert.equal(f1, 1, `${lang} ${chapter} ${category}: F1 ${f1}`);
      }
    }
  }
});

// The large part (T-339): a world of realistic size, generated from a closed sentence bank.

const SCENE = "\n\n***\n\n";
const largeChapters = (world) =>
  world.manuscript.chapters.filter((chapter) => chapter.id.startsWith("l-"));

test("the large part generates the same chapters on every run", () => {
  // Two separate processes: the plan is made once per process, so only a second process
  // shows whether it depends on anything but the seeds and the bank.
  const exportScript = join(repositoryRoot, "tests/world/export.mjs");
  for (const lang of LANGUAGES) {
    const [first, second] = [1, 2].map(() => {
      const run = spawnSync(
        process.execPath,
        [exportScript, "--include", "base,large", "--lang", lang],
        { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
      );
      assert.equal(run.status, 0, String(run.stderr));
      return createHash("sha256").update(run.stdout).digest("hex");
    });
    assert.equal(first, second, `${lang}: two runs differ`);
    assert.equal(
      first,
      createHash("sha256")
        .update(exportWorld({ include: ["base", "large"], lang }))
        .digest("hex"),
      `${lang}: the export differs from the world this process builds`,
    );
  }
});

test("the generator uses every sentence of its segment, whatever the seed", () => {
  // About twice as many draws as the bank has sentences: free draws alone would leave one in
  // seven out.
  const bank = LARGE_S1_DE.map((de, index) => ({ key: `s${index}`, de }));
  for (const seed of [1, 2, 3]) {
    const [plan] = planBook({
      seed,
      bank,
      people: ["Anke Ahlers"],
      places: ["Sellin"],
      chapters: [{ id: "probe", seed, words: 2 * wordCount(LARGE_S1_DE.join(" ")) }],
    });
    const used = new Set(plan.tokens.filter((token) => token.key).map((token) => token.key));
    assert.equal(used.size, bank.length, `seed ${seed}: ${bank.length - used.size} unused`);
  }
});

test("the large part has the lengths its budget and import tests rely on", () => {
  const chapters = largeChapters(buildExampleWorld("de", { include: ["large"] }));
  assert.equal(chapters.length, 28);
  const words = Object.fromEntries(
    chapters.map((chapter) => [chapter.id, wordCount(chapter.body)]),
  );
  for (const { id, words: target } of LARGE_CHAPTERS) {
    // A chapter ends with the first sentence that reaches its target.
    assert.ok(words[id] >= target && words[id] < target + 40, `${id}: ${words[id]} words`);
  }
  assert.ok(words["l-ch-typical"] >= 2000 && words["l-ch-typical"] <= 3000);
  assert.ok(words["l-ch-long"] >= 8000 && words["l-ch-long"] <= 10000);
  const total = Object.values(words).reduce((sum, count) => sum + count, 0);
  assert.ok(total >= 80000 && total < 81000, `the novel has ${total} words`);
  for (const chapter of chapters) {
    assert.ok(chapter.body.includes(SCENE), `${chapter.id} has no scene break`);
  }
});

test("the large part's probe body is its German length, in both languages", () => {
  for (const lang of LANGUAGES) {
    const probe = largeChapters(buildExampleWorld(lang, { include: ["large"], probe: true }));
    const german = largeChapters(buildExampleWorld("de", { include: ["large"] }));
    for (const [index, chapter] of probe.entries()) {
      const match =
        /^⟦large-body (s\d+) plan:[0-9a-f]{16} de:[0-9a-f]{16} en:[0-9a-f]{16} (\d+)⟧$/.exec(
          chapter.body,
        );
      assert.ok(match, `${lang} ${chapter.id}: ${chapter.body.slice(0, 40)}`);
      assert.equal(match[1], BOOK.segment);
      assert.equal(Number(match[2]), wordCount(german[index].body), chapter.id);
    }
  }
});

test("every large-part document lies far above the size proxies compress at", () => {
  const world = buildExampleWorld("de", { include: ["large"] });
  for (const name of ["manuscript", "figures", "storyboards"]) {
    const bytes = Buffer.byteLength(JSON.stringify(world[name]));
    assert.ok(bytes > 50_000, `${name}: ${bytes} bytes`);
  }
});

test("the sentence bank's two languages match and its placeholders stand where German allows", () => {
  assert.equal(LARGE_S1_EN.length, LARGE_S1_DE.length);
  const holes = (text) => (text.match(/\{(figur|ort)\}/g) ?? []).join(",");
  for (const [index, sentence] of LARGE_S1_DE.entries()) {
    assert.equal(holes(LARGE_S1_EN[index]), holes(sentence), `s1.${index + 1}`);
  }
  assert.deepEqual(misplacedPlaceholders(LARGE_S1_DE), []);
  assert.deepEqual(
    misplacedPlaceholders(["Man sah {figur} am Kai.", "Das Haus von {figur} brannte."]),
    ["Man sah {figur} am Kai.", "Das Haus von {figur} brannte."],
  );
});

test("the large part exports its novel as Markdown and text", () => {
  const markdown = exportWorld({ include: ["base", "large"], format: "md", folder: "l-novel" });
  const text = exportWorld({ include: ["base", "large"], format: "txt", folder: "l-novel" });
  assert.equal((markdown.match(/^# /gm) ?? []).length, 28);
  assert.ok(wordCount(text) > 80000);
});

test("the server's world check finds nothing wrong with the large part", () => {
  // The base world passes validate_world with no issue; the large part must as well
  // (F-339-10: 55 relationships were structurally duplicate).
  const world = buildExampleWorld("de", { include: ["large"] });
  const script = [
    "import json, sys",
    "from quiltor.domain.story_world.integrity import validate_world",
    "from quiltor.domain.story_world.validation import valid_figures, valid_manuscript",
    'world = json.loads(sys.stdin.buffer.read().decode("utf-8"))',
    "issues = [issue for issue in validate_world(world['figures'])['issues'] if 'l-' in issue]",
    "print(json.dumps({'issues': issues, 'figures': valid_figures(world['figures']),",
    "                  'manuscript': valid_manuscript(world['manuscript'])}))",
  ].join("\n");
  const result = spawnSync(
    process.execPath,
    [join(repositoryRoot, "tools/dev/python.mjs"), "--needs", "quiltor", "-c", script],
    {
      cwd: repositoryRoot,
      input: JSON.stringify(world),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PYTHONPATH: join(repositoryRoot, "src") },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const verdict = JSON.parse(result.stdout.trim().split("\n").at(-1));
  assert.deepEqual(verdict.issues, [], "validate_world issues on l- entries");
  assert.equal(verdict.figures, true, "valid_figures refuses the large part");
  assert.equal(verdict.manuscript, true, "valid_manuscript refuses the large part");
});

test("the large part's frozen entries do not depend on the parts before it", () => {
  // A moment or folder added to edge or gold must not change any l- entry of the lock
  // (F-339-11): the large part built alone and after every other part freezes the same.
  const entries = (include) => {
    const world = buildExampleWorld("de", { include, probe: true });
    return {
      moments: world.figures.timeline.filter((moment) => moment.id.startsWith("l-")),
      items: world.manuscript.structure.items.filter((item) => item.id.startsWith("item-l-")),
      chapters: largeChapters(world),
    };
  };
  assert.deepEqual(entries(["large"]), entries(PARTS));
});

test("the lock freezes the German and the English text of every large chapter", () => {
  // F-339-12: a changed renderer has to show in the lock, not only a changed plan.
  const sha16 = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
  const probe = largeChapters(buildExampleWorld("de", { include: ["large"], probe: true }));
  const [german, english] = LANGUAGES.map((lang) =>
    largeChapters(buildExampleWorld(lang, { include: ["large"] })),
  );
  for (const [index, chapter] of probe.entries()) {
    assert.ok(chapter.body.includes(` de:${sha16(german[index].body)} `), `${chapter.id} de`);
    assert.ok(chapter.body.includes(` en:${sha16(english[index].body)} `), `${chapter.id} en`);
  }
});

test("the large part reads naturally: roles, relationships and sentences", () => {
  // F-339-13. German women's roles end in -in, men's do not.
  const world = buildExampleWorld("de", { include: ["large"] });
  for (const node of world.figures.nodes.filter((item) => item.id.startsWith("l-p-"))) {
    const female = PERSON_GENDER[node.id] === "f";
    assert.equal(node.label.endsWith("in"), female, `${node.id} ${node.name}: ${node.label}`);
  }
  const relation = Object.fromEntries(
    world.figures.edges.filter((edge) => edge.id.startsWith("l-")).map((edge) => [edge.id, edge]),
  );
  for (const edge of Object.values(relation)) {
    if (edge.to.startsWith("l-ort-")) assert.equal(edge.label, "wohnt in", edge.id);
    else if (edge.to.startsWith("l-g-")) assert.equal(edge.label, "besitzt", edge.id);
    else assert.ok(!["wohnt in", "besitzt"].includes(edge.label), edge.id);
  }
  for (const chapter of LARGE_PLAN) {
    const keys = chapter.tokens.filter((token) => token.key).map((token) => token.key);
    const repeated = keys.filter((key, index) => index > 0 && key === keys[index - 1]);
    assert.deepEqual(repeated, [], `${chapter.id}: a sentence twice in a row`);
  }
});
