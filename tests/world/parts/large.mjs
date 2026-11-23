// The large part of the test world (T-339): a world of realistic size. One novel of 28
// chapters and about 80,000 words, among them a typical chapter (l-ch-typical, 2,500 words)
// and a very long one (l-ch-long, 9,000 words); 160 elements, 250 relationships, 300 moments,
// 150 presence entries, a map with 59 places and two boards of 150 cards each. Every
// document is far above the size at which proxies start to compress (plan D-T-339-1).
//
// Every id starts with "l-". The part never ships and no spec seeds it unless it asks for
// `include: ["large"]`.
//
// The chapters are generated (tests/world/large/generate.mjs) from segment s1 of the
// sentence bank in texts/large.<lang>.mjs: German leads, every language fills the same plan.
// With `probe` a chapter's body is its fingerprint and German word count, so the lock
// freezes the plan without carrying 80,000 words (F-339-6).

import { createHash } from "node:crypto";
import { planBook, planDigest, renderChapter } from "../large/generate.mjs";
import { PLACE_NAMES, SEGMENT_S1, texts as germanTexts } from "../texts/large.de.mjs";
import { texts as englishTexts } from "../texts/large.en.mjs";

const pad = (number, width) => String(number).padStart(width, "0");

/** The book's seed and the segment it draws from; both are frozen with the lock. */
export const BOOK = { seed: 339, segment: "s1" };
const FOLDER = "l-novel";

/** The 28 chapters: their ids, seeds and German target lengths, 80,010 words in all. */
export const CHAPTERS = Array.from({ length: 28 }, (_, index) => {
  const number = index + 1;
  const id = number === 3 ? "l-ch-typical" : number === 17 ? "l-ch-long" : `l-ch-${pad(number, 2)}`;
  const words = number === 3 ? 2500 : number === 17 ? 9000 : 2635;
  return { id, number, seed: BOOK.seed * 1000 + number, words };
});

/** Whether each first name of texts/large.de.mjs is a woman's (f) or a man's (m). */
const FIRST_NAME_GENDER = "fmfmfmfmfmfmfmfmfmfmffmfmfmfmffmfmffmfmf";
// The roles of texts/large.<lang>.mjs alternate: odd numbers are a woman's form, even a man's.
const roleFor = (index, gender) =>
  `large.role.${pad(2 * (index % 10) + (gender === "f" ? 1 : 2), 2)}`;

const PEOPLE = Array.from({ length: 80 }, (_, index) => ({
  id: `l-p-${pad(index + 1, 2)}`,
  first: index % 40,
  family: index < 40 ? index % 30 : (index + 13) % 30,
}));
const ORGANISATIONS = Array.from({ length: 10 }, (_, index) => `l-o-${pad(index + 1, 2)}`);
const THINGS = Array.from({ length: 10 }, (_, index) => `l-g-${pad(index + 1, 2)}`);
const MAP = "l-map";
const PLACES = PLACE_NAMES.map((_, index) => `l-ort-${pad(index + 1, 2)}`);

const BANK = SEGMENT_S1.map((de, index) => ({ key: `large.s1.${pad(index + 1, 3)}`, de }));
const germanName = (person) =>
  `${germanTexts[`large.first.${pad(person.first + 1, 2)}`]} ${germanTexts[`large.family.${pad(person.family + 1, 2)}`]}`;

/** The plan of every chapter, made once: it depends on nothing but the German bank. */
export const PLAN = planBook({
  seed: BOOK.seed,
  bank: BANK,
  people: PEOPLE.map(germanName),
  places: PLACE_NAMES,
  chapters: CHAPTERS,
});

const EDGE_COUNT = 250;
const MOMENT_COUNT = 300;
const PRESENCE_COUNT = 150;
const CARDS_PER_BOARD = 150;

/**
 * The relationships: every pair once, in either direction (validate_world reports a pair
 * twice as structurally duplicate, F-339-10). Between actors the kinds of a person to a
 * person or a group; to a place "lives in"; to an object "owns".
 */
const RELATIONSHIPS = (() => {
  const actors = [...PEOPLE.map((person) => person.id), ...ORGANISATIONS];
  const between = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15];
  const seen = new Set();
  const edges = [];
  for (let step = 0; edges.length < EDGE_COUNT; step += 1) {
    const index = edges.length;
    const from = actors[step % actors.length];
    const kind = index % 5;
    const pool = kind === 4 ? PLACES : kind === 3 ? THINGS : actors;
    const to = pool[(step * 7 + 3 + Math.floor(step / actors.length) * 11) % pool.length];
    const pair = [from, to].sort().join("|");
    if (to === from || seen.has(pair)) continue;
    seen.add(pair);
    const rel = kind === 4 ? 13 : kind === 3 ? 14 : between[index % between.length];
    edges.push({
      id: `l-e-${pad(index + 1, 3)}`,
      from,
      to,
      label: `large.rel.${pad(rel, 2)}`,
      directed: kind >= 3 || index % 3 !== 0,
      lineStyle: index % 4 === 0 ? "dashed" : "solid",
    });
  }
  return edges;
})();

const sha16 = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** A chapter in probe mode: segment, plan, German length and the hash of both texts. */
function probeBody(plan) {
  const names = PEOPLE.map(germanName);
  const de = renderChapter(plan.tokens, (key) => germanTexts[key], names, PLACE_NAMES);
  const en = renderChapter(plan.tokens, (key) => englishTexts[key], names, PLACE_NAMES);
  return `⟦large-body ${BOOK.segment} plan:${planDigest(plan.tokens)} de:${sha16(de)} en:${sha16(en)} ${plan.words}⟧`;
}

export function describeLarge(api, world) {
  const { t, probe } = api;
  const { manuscript, figures, storyboards } = world;

  const personName = (person) =>
    `${t(`large.first.${pad(person.first + 1, 2)}`)} ${t(`large.family.${pad(person.family + 1, 2)}`)}`;
  const peopleNames = PEOPLE.map(personName);
  const placeNames = PLACES.map((_, index) => t(`large.place.${pad(index + 1, 2)}`));

  // Elements: on a grid to the right of every other part, one column per kind.
  const grid = (column, row) => ({ x: 4200 + column * 380, y: 80 + row * 230 });
  const element = (id, type, position, name, label, sub, notes, extra = {}) => ({
    id,
    ...position,
    type,
    name,
    label,
    sub,
    accent: "ink",
    profile: { notes, fields: [] },
    ...extra,
  });
  const nodes = [];
  const seenOfGender = { f: 0, m: 0 };
  PEOPLE.forEach((person, index) => {
    // The German role takes the form that fits the person's first name (F-339-13); each
    // gender walks through its ten roles in turn.
    const gender = FIRST_NAME_GENDER[person.first];
    const role = roleFor(seenOfGender[gender]++, gender);
    const node = element(
      person.id,
      "person",
      grid(index % 8, Math.floor(index / 8)),
      peopleNames[index],
      t(role),
      t(`large.trait.${pad((index % 10) + 1, 2)}`),
      t(`large.note.${pad((index % 10) + 1, 2)}`),
    );
    // The first 20 people carry a full profile.
    if (index < 20) {
      node.profile.fields = [
        { id: `field-${person.id}-role`, key: t("large.field.role"), value: t(role) },
        {
          id: `field-${person.id}-home`,
          key: t("large.field.home"),
          value: placeNames[index % placeNames.length],
        },
      ];
    }
    nodes.push(node);
  });
  ORGANISATIONS.forEach((id, index) => {
    nodes.push(
      element(
        id,
        "organisation",
        grid(8, index),
        t(`large.org.${pad(index + 1, 2)}`),
        t("large.label.organisation"),
        t("large.org.sub"),
        t(`large.note.${pad((index % 10) + 1, 2)}`),
      ),
    );
  });
  THINGS.forEach((id, index) => {
    nodes.push(
      element(
        id,
        "objekt",
        grid(9, index),
        t(`large.obj.${pad(index + 1, 2)}`),
        t("large.label.objekt"),
        t("large.obj.sub"),
        t(`large.note.${pad((index % 10) + 1, 2)}`),
      ),
    );
  });
  const nordhafen = figures.nodes.find((node) => node.id === "nordhafen");
  nodes.push(
    element(
      MAP,
      "ort",
      grid(10, 0),
      t("large.map.name"),
      t("large.map.label"),
      t("large.map.sub"),
      t("large.map.notes"),
      {
        mapX: 4200,
        mapY: 2600,
        mapImageId: nordhafen.mapImageId,
        mapExpanded: true,
        mapWidth: 1500,
        mapHeight: 1000,
        mapScale: { unitsPer100px: 5, unitLabel: "km" },
      },
    ),
  );
  PLACES.forEach((id, index) => {
    nodes.push(
      element(
        id,
        "ort",
        grid(10 + Math.floor((index + 1) / 10), (index + 1) % 10),
        placeNames[index],
        t("large.label.ort"),
        t("large.place.sub"),
        t(`large.note.${pad((index % 10) + 1, 2)}`),
        {
          parentPlaceId: MAP,
          mapU: 0.05 + (index % 10) * 0.1,
          mapV: 0.08 + Math.floor(index / 10) * 0.15,
        },
      ),
    );
  });
  figures.nodes.push(...nodes);

  // Relationships, moments and presence, chosen with a fixed step so the lists stay stable.
  const actors = [...PEOPLE.map((person) => person.id), ...ORGANISATIONS, ...THINGS];
  figures.edges.push(...RELATIONSHIPS.map((edge) => ({ ...edge, label: t(edge.label) })));
  const start = figures.timeline.length;
  figures.timeline.push(
    ...Array.from({ length: MOMENT_COUNT }, (_, index) => ({
      id: `l-t-${pad(index + 1, 3)}`,
      title: t(`large.moment.${pad((index % 20) + 1, 2)}`),
      note: t("large.momentNote"),
      time: 2000 + index * 2,
      // Frozen relative to the part, so a moment added to an earlier part changes nothing
      // here (F-339-11).
      position: probe ? `⟦position l-t +${index}⟧` : start + index,
      precision: "day",
    })),
  );
  figures.presence.push(
    ...Array.from({ length: PRESENCE_COUNT }, (_, index) => ({
      id: `l-pr-${pad(index + 1, 3)}`,
      elementId: PEOPLE[index % PEOPLE.length].id,
      placeId: PLACES[(index * 3) % PLACES.length],
      momentId: `l-t-${pad(((index * 2) % MOMENT_COUNT) + 1, 3)}`,
    })),
  );

  // The novel: one folder, 28 generated chapters.
  manuscript.structure.folders.push({ id: FOLDER, title: t("folder.l-novel") });
  manuscript.structure.items.push({
    id: `item-${FOLDER}`,
    kind: "folder",
    folderId: FOLDER,
    position: probe
      ? "⟦position l-novel +0⟧"
      : manuscript.structure.items.filter((item) => item.kind === "folder").length,
  });
  for (const [position, chapter] of CHAPTERS.entries()) {
    const plan = PLAN[position];
    // Rendering asks for every key the plan draws, so each counts as used, also in probe mode.
    const text = renderChapter(plan.tokens, t, peopleNames, placeNames);
    // The lock freezes the plan, the German length and the text of both languages, so a
    // changed renderer shows as a changed chapter (F-339-12).
    const body = probe ? probeBody(plan) : text;
    manuscript.chapters.push({
      id: chapter.id,
      title: t(`large.ch.${pad(chapter.number, 2)}`),
      body,
      note: "",
    });
    manuscript.structure.items.push({
      id: `item-${chapter.id}`,
      kind: "chapter",
      chapterId: chapter.id,
      parentFolderId: FOLDER,
      position,
    });
  }

  // Two boards: the plot with a card on every chapter, the cast with a card on every actor;
  // notes fill each board up to 150 cards.
  const boards = [
    { id: "l-board-plot", title: t("large.board.plot.title") },
    { id: "l-board-cast", title: t("large.board.cast.title") },
  ];
  storyboards.boards.push(...boards);
  const box = (index) => ({
    x: 60 + (index % 15) * 320,
    y: 60 + Math.floor(index / 15) * 240,
    width: 280,
    height: 200,
  });
  const note = (boardId, id, index) => ({
    id,
    boardId,
    kind: "note",
    label: t(`large.card.label.${pad((index % 5) + 1, 2)}`),
    text: t(`large.card.text.${pad((index % 5) + 1, 2)}`),
    zIndex: 1,
    ...box(index),
  });
  const reference = (boardId, id, target, label, index) => ({
    id,
    boardId,
    kind: "reference",
    target,
    label,
    zIndex: 1,
    ...box(index),
  });
  const plot = CHAPTERS.map((chapter, index) =>
    reference(
      "l-board-plot",
      `l-card-plot-${pad(index + 1, 3)}`,
      { kind: "chapter", id: chapter.id },
      manuscript.chapters.find((item) => item.id === chapter.id).title,
      index,
    ),
  );
  for (let index = plot.length; index < CARDS_PER_BOARD; index += 1) {
    plot.push(note("l-board-plot", `l-card-plot-${pad(index + 1, 3)}`, index));
  }
  const cast = actors.map((id, index) =>
    reference(
      "l-board-cast",
      `l-card-cast-${pad(index + 1, 3)}`,
      { kind: "entity", id },
      nodes.find((node) => node.id === id).name,
      index,
    ),
  );
  for (let index = cast.length; index < CARDS_PER_BOARD; index += 1) {
    cast.push(note("l-board-cast", `l-card-cast-${pad(index + 1, 3)}`, index));
  }
  storyboards.nodes.push(...plot, ...cast);

  return world;
}

/** The gender of each person's first name, by id: f or m. */
export const PERSON_GENDER = Object.fromEntries(
  PEOPLE.map((person) => [person.id, FIRST_NAME_GENDER[person.first]]),
);

/** The entries of the large part that the catalog and the typed ids name one by one. */
export const NAMED = new Set([
  FOLDER,
  MAP,
  ...CHAPTERS.map((chapter) => chapter.id),
  ...PEOPLE.slice(0, 20).map((person) => person.id),
  "l-board-plot",
  "l-board-cast",
]);

/** What each entry of the large part is there for, in the catalog (CATALOG.md). */
export const PURPOSE = {
  "l-ch-typical": "chapter of typical length, 2,500 German words (budget tests, T-330)",
  "l-ch-long": "very long chapter, 9,000 German words (budget tests, stitching, T-330)",
  ...Object.fromEntries(
    CHAPTERS.filter((chapter) => !["l-ch-typical", "l-ch-long"].includes(chapter.id)).map(
      (chapter) => [chapter.id, `chapter ${chapter.number} of the novel, about 2,635 German words`],
    ),
  ),
  ...Object.fromEntries(
    PEOPLE.map((person, index) => [
      person.id,
      index < 20 ? "person of the novel with a full profile" : "person of the novel",
    ]),
  ),
  ...Object.fromEntries(ORGANISATIONS.map((id) => [id, "organisation of the novel"])),
  ...Object.fromEntries(THINGS.map((id) => [id, "object of the novel"])),
  [MAP]: "map of the north coast, opened out, with the 59 places of the novel on it",
  ...Object.fromEntries(PLACES.map((id) => [id, "place on the map of the novel"])),
  "l-board-plot": "board with a card on every chapter of the novel, filled up with notes",
  "l-board-cast":
    "board with a card on every person, organisation and object, filled up with notes",
  ...Object.fromEntries(
    Array.from({ length: CARDS_PER_BOARD }, (_, index) => [
      `l-card-plot-${pad(index + 1, 3)}`,
      index < 28 ? "card on a chapter of the novel" : "note on the plot board",
    ]),
  ),
  ...Object.fromEntries(
    Array.from({ length: CARDS_PER_BOARD }, (_, index) => [
      `l-card-cast-${pad(index + 1, 3)}`,
      index < 100 ? "card on an element of the novel" : "note on the cast board",
    ]),
  ),
};
