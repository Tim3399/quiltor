import assert from "node:assert/strict";
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

test("every id of the check part starts with x-, and no base id does", () => {
  const baseIds = new Set(worldIds(buildExampleWorld("de")));
  const added = worldIds(buildExampleWorld("de", { include: PARTS })).filter(
    (id) => !baseIds.has(id),
  );
  assert.ok(added.length >= 15, `only ${added.length} ids in the check part`);
  for (const id of added) {
    assert.ok(/^x-|^item-x-/.test(bareId(id)), `${id} is in the check part without x-`);
  }
  for (const id of baseIds) assert.ok(!bareId(id).startsWith("x-"), `${id} is a base id with x-`);
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
    const baseKeys = Object.keys(PART_DICTIONARIES.base[lang]);
    const edgeKeys = new Set(Object.keys(PART_DICTIONARIES.edge[lang]));
    assert.deepEqual(
      baseKeys.filter((key) => edgeKeys.has(key)),
      [],
      `${lang}: text keys in both parts`,
    );
  }
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
