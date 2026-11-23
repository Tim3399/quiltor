// The check part of the test world: edge cases that are never photographed and never ship.
// Every id starts with "x-". The part only appends to the lists of the base world; nothing of
// the base world changes when it is included (world.test.mjs checks both).
//
// Words never appear here, only the keys of texts/edge.<lang>.mjs. Values that are part of the
// case itself -- an empty note, an empty chapter -- are written as literals.

/** Eight places stacked on almost the same point, one of them a favourite (T-129). */
const CLUSTER = Array.from({ length: 8 }, (_, index) => ({
  id: `x-cluster-${index + 1}`,
  x: 1600 + index * 6,
  y: 80 + index * 6,
  mapX: 1400 + index * 4,
  mapY: 300 + index * 4,
  important: index === 4,
}));

/** A board that holds every card of the check part, so the base boards stay as they are. */
const BOARD = "x-board";
/** The board of the two overlapping notes. */
const LAYERS = "x-layers";

export function describeEdge(api, world) {
  const { t } = api;
  const { manuscript, figures, storyboards } = world;

  const node = (id, type, x, y, extra = {}, notes = t(`el.${id}.notes`)) => ({
    id,
    x,
    y,
    type,
    name: t(`el.${id}.name`),
    label: t(`el.${id}.label`),
    sub: t(`el.${id}.sub`),
    accent: "ink",
    profile: { notes, fields: [] },
    ...extra,
  });

  figures.nodes.push(
    ...CLUSTER.map((spec) => ({
      ...node(spec.id, "ort", spec.x, spec.y, { mapX: spec.mapX, mapY: spec.mapY }),
      ...(spec.important ? { important: true } : {}),
    })),
    // One word of 65 letters: nothing to break it at (T-129, T-183).
    node("x-long-name", "person", 1600, 310),
    // Long names that were cut in the README pictures (T-173 B).
    node("x-long-place", "ort", 1600, 540, {
      parentPlaceId: "nordhafen",
      mapU: 0.8,
      mapV: 0.3,
      placeDisplay: "pin",
    }),
    node("x-long-org", "organisation", 1600, 770),
    // An element whose note is empty.
    node("x-empty-note", "objekt", 1980, 310, {}, ""),
    // A map opened out on the world level, with its picture, a scale and three places standing
    // on it, plus a second, smaller map with one place. Opened out, a map is ground rather
    // than a card, and the places on it are derived from the map; the base world only has
    // the folded Nordhafen and its city level. The map specs mock this group on its own
    // (support/expanded-map-fixture.ts), so its proportions are theirs: 1000 x 680, 25 km per
    // 100 px, the island map overlapping the right edge.
    node("x-weltkarte", "ort", 1980, 540, {
      mapX: 200,
      mapY: 900,
      // The same picture as Nordhafen: the world carries one map file.
      mapImageId: figures.nodes.find((item) => item.id === "nordhafen").mapImageId,
      mapExpanded: true,
      mapWidth: 1000,
      mapHeight: 680,
      mapScale: { unitsPer100px: 25, unitLabel: "km" },
      pinned: true,
    }),
    // The places on the map carry no note: the places baseline photographs the inspector of
    // the first one, and the specs type into empty notes.
    node(
      "x-graufurth",
      "ort",
      1980,
      770,
      { parentPlaceId: "x-weltkarte", mapU: 0.3, mapV: 0.4 },
      "",
    ),
    node(
      "x-nordhafen",
      "ort",
      2360,
      80,
      { parentPlaceId: "x-weltkarte", mapU: 0.7, mapV: 0.4 },
      "",
    ),
    node(
      "x-tannenhain",
      "ort",
      2360,
      310,
      { parentPlaceId: "x-weltkarte", mapU: 0.48, mapV: 0.7 },
      "",
    ),
    node("x-inselkarte", "ort", 2360, 540, {
      mapX: 900,
      mapY: 900,
      mapImageId: figures.nodes.find((item) => item.id === "nordhafen").mapImageId,
      mapExpanded: true,
      mapWidth: 600,
      mapHeight: 500,
      pinned: true,
    }),
    node(
      "x-inselhafen",
      "ort",
      2360,
      770,
      { parentPlaceId: "x-inselkarte", mapU: 0.5, mapV: 0.5 },
      "",
    ),
    // A map with its picture but no frame size, the way older or foreign documents arrive
    // (T-79). The server fills the size in from the picture when the world is loaded; the
    // stored document keeps it absent until the next ordinary save. It stands on a level of
    // its own, so no other spec's framing or expanded-map state ever sees it. The level's own
    // card stands inside the area the world level and the figures board already span: placed
    // beyond it, it would widen the first framing and push other specs' places off a phone.
    node("x-masslos-ebene", "ort", 1980, 80, { mapX: 1300, mapY: 600 }, ""),
    node(
      "x-masslose-karte",
      "ort",
      1220,
      770,
      {
        parentPlaceId: "x-masslos-ebene",
        mapX: 200,
        mapY: 200,
        mapImageId: figures.nodes.find((item) => item.id === "nordhafen").mapImageId,
        mapExpanded: true,
        mapScale: { unitsPer100px: 0.15, unitLabel: "km" },
      },
      "",
    ),
  );

  // A chapter without text, appended to the second act.
  const actTwo = manuscript.structure.items.filter(
    (item) => item.kind === "chapter" && item.parentFolderId === "act-two",
  );
  manuscript.chapters.push({
    id: "x-empty-chapter",
    title: t("ch.x-empty.title"),
    body: "",
    note: "",
  });
  manuscript.structure.items.push({
    id: "item-x-empty-chapter",
    kind: "chapter",
    chapterId: "x-empty-chapter",
    parentFolderId: "act-two",
    position: actTwo.length,
  });

  // A chapter that went through three texts (T-86). The part holds the last one; the e2e helper
  // seedExampleWorldWithHistory puts the earlier ones in as versions, so the chapter's history
  // has entries that create it and change it.
  manuscript.chapters.push({
    id: "x-chronicle",
    title: t("ch.x-chronicle.title"),
    body: t("ch.x-chronicle.body-3"),
    note: "",
  });
  manuscript.structure.items.push({
    id: "item-x-chronicle",
    kind: "chapter",
    chapterId: "x-chronicle",
    parentFolderId: "act-two",
    position: actTwo.length + 1,
  });
  // The versions of that chapter, newest last: the text of x-chronicle at each, whether the
  // other chapter `otherChapterId` carries the extra sentence, and the note of the version.
  world.history = {
    chapterId: "x-chronicle",
    otherChapterId: "c-arrival",
    appended: { text: t("ch.x-chronicle.elsewhere") },
    versions: [1, 2, 2, 3].map((stage, index) => ({
      text: t(`ch.x-chronicle.body-${stage}`),
      elsewhere: index >= 2,
      note: t(`ch.x-chronicle.note-${index + 1}`),
    })),
  };

  // A chapter in the bin whose folder no longer exists.
  manuscript.trash.push({
    chapter: {
      id: "x-trash-orphan",
      title: t("ch.x-orphan.title"),
      body: t("ch.x-orphan.body"),
      note: "",
    },
    deletedAt: "2026-02-03T08:15:00.000Z",
    originalFolderPath: [{ id: "x-gone-folder", title: t("folder.x-gone") }],
    treeItem: {
      id: "item-x-trash-orphan",
      kind: "chapter",
      chapterId: "x-trash-orphan",
      parentFolderId: "x-gone-folder",
      position: 0,
    },
  });

  // Reference cards whose target is gone or in the bin (T-177).
  const reference = (id, target, labelKey, x) => ({
    id,
    boardId: BOARD,
    kind: "reference",
    target,
    label: t(labelKey),
    zIndex: 1,
    x,
    y: 60,
    width: 260,
    height: 190,
  });
  storyboards.boards.push(
    { id: BOARD, title: t("board.x.title") },
    // The two overlapping notes have a board of their own: moving a card forward renumbers
    // the layers of the whole board, and the layer spec reads those numbers.
    { id: LAYERS, title: t("board.x-layers.title") },
  );
  storyboards.nodes.push(
    reference("x-ref-deleted", { kind: "entity", id: "x-gone" }, "card.x-gone.label", 60),
    reference("x-ref-trashed", { kind: "chapter", id: "c-prologue" }, "ch.prologue.title", 380),
    // A second card on the chapter the main board already shows (T-177: one note, two cards),
    // and a card on a side character, which the figure inspector lists as a backlink.
    reference("x-ref-storm-again", { kind: "chapter", id: "c-storm" }, "ch.c5.title", 700),
    reference("x-ref-ada", { kind: "entity", id: "ada" }, "card.x-ada.label", 1020),
    // Two notes overlapping each other, the front one one layer up, on their own board.
    ...[
      { id: "x-layer-back", x: 60, y: 420, zIndex: 1, key: "x-layer-back" },
      { id: "x-layer-front", x: 140, y: 480, zIndex: 2, key: "x-layer-front" },
    ].map((spec) => ({
      id: spec.id,
      boardId: LAYERS,
      kind: "note",
      label: t(`card.${spec.key}.label`),
      text: t(`card.${spec.key}.text`),
      zIndex: spec.zIndex,
      x: spec.x,
      y: spec.y,
      width: 280,
      height: 210,
    })),
  );

  describeLongChapters(api, world);

  return world;
}

/**
 * The two long chapters of the check part (T-355), for the tests of the AI features: more than
 * 5,000 words each, with something to find spread over the whole text and a figure and an event
 * in the last fifth that appear nowhere before it, so that silent truncation shows. The prose
 * tells the harbour while the others are in the archive, and afterwards: "Kettenwache"
 * (days 12 to 17 of the Tide Reckoning) and "Das Siegel am Archiv" (days 25 to 30).
 */
function describeLongChapters(api, world) {
  const { t } = api;
  const { manuscript, figures } = world;
  const node = (id, type, x, y, extra = {}) => ({
    id,
    x,
    y,
    type,
    name: t(`el.${id}.name`),
    label: t(`el.${id}.label`),
    sub: t(`el.${id}.sub`),
    accent: "ink",
    profile: { notes: t(`el.${id}.notes`), fields: [] },
    ...extra,
  });
  const alias = (id) => ({ aliases: [{ alias: t(`el.${id}.alias`), source: "manual" }] });
  const place = (id, x, y, mapU, mapV) =>
    node(id, "ort", x, y, {
      parentPlaceId: "nordhafen",
      mapU,
      mapV,
      placeDisplay: "pin",
    });

  figures.nodes.push(
    node("x-wenke", "person", 2740, 80, alias("x-wenke")),
    // Only ever spoken of: he is dead before the story begins.
    node("x-hinrik", "person", 2740, 310),
    node("x-jorun", "person", 2740, 540, alias("x-jorun")),
    node("x-pelle", "person", 2740, 770, alias("x-pelle")),
    node("x-thea", "person", 3120, 80),
    node("x-kettenordnung", "objekt", 3120, 310),
    node("x-seeschwalbe", "objekt", 3120, 540),
    place("x-hafenhaus", 3120, 770, 0.33, 0.62),
    place("x-netzboden", 3500, 80, 0.2, 0.3),
  );

  // Days of the Tide Reckoning counted from t1 (the nineteenth of Neapmoon, day 12, is t5).
  const moments = [
    ["x-t1", 13],
    ["x-t2", 14],
    ["x-t3", 16],
    ["x-t4", 17],
    ["x-t5", 25],
    ["x-t6", 27],
    ["x-t7", 30],
  ];
  figures.timeline.push(
    ...moments.map(([id, time], index) => ({
      id,
      title: t(`moment.${id}.title`),
      note: t(`moment.${id}.note`),
      time,
      position: figures.timeline.length + index,
      precision: "day",
    })),
  );

  const relation = (id, from, to, extra = {}) => ({
    id,
    from,
    to,
    label: t(`edge.${id}.label`),
    directed: true,
    lineStyle: "solid",
    ...extra,
  });
  const turn = (id, momentId) => ({
    versions: [{ momentId, label: t(`edge.${id}.v1`), active: true }],
  });
  figures.edges.push(
    // Chapter 1: the harbourmaster comes to rely on the clerk (x-t2).
    relation("x-e1", "oda", "x-wenke", turn("x-e1", "x-t2")),
    relation("x-e2", "x-wenke", "x-hinrik"),
    relation("x-e3", "x-jorun", "x-seeschwalbe"),
    // Chapter 2: she bends the law she had invoked (x-t5).
    relation("x-e4", "oda", "x-kettenordnung", turn("x-e4", "x-t5")),
    relation("x-e5", "x-thea", "gilde"),
    relation("x-e6", "bela", "x-pelle"),
  );

  figures.presence.push(
    ...[
      ["oda", "x-hafenhaus", "x-t2"],
      ["x-wenke", "x-hafenhaus", "x-t2"],
      ["x-thea", "archive", "x-t7"],
    ].map(([elementId, placeId, momentId], index) => ({
      id: `x-presence-${index + 1}`,
      elementId,
      placeId,
      momentId,
    })),
  );

  const actTwo = manuscript.structure.items.filter(
    (item) => item.kind === "chapter" && item.parentFolderId === "act-two",
  );
  const chapters = [
    { id: "x-kettenwache", key: "kettenwache", start: "t5", end: "x-t4" },
    { id: "x-siegel", key: "siegel", start: "x-t5", end: "x-t7" },
  ];
  chapters.forEach((spec, index) => {
    manuscript.chapters.push({
      id: spec.id,
      title: t(`ch.${spec.id}.title`),
      body: t(`ch.${spec.id}.body`),
      note: t(`ch.${spec.id}.note`),
      storyTime: { startMomentId: spec.start, endMomentId: spec.end },
    });
    manuscript.structure.items.push({
      id: `item-${spec.id}`,
      kind: "chapter",
      chapterId: spec.id,
      parentFolderId: "act-two",
      position: actTwo.length + index,
    });
  });

  world.checkpoints = CHECKPOINTS.map((spec) => ({ ...spec, surface: t(`chk.${spec.id}`) }));
}

/**
 * What the extraction has to find in the two long chapters (T-355). `surface` is a phrase of
 * the chapter text in each language (texts/edge.<lang>.mjs, key chk.<id>); where it stands is
 * worked out from the text, see checkpointPositions. `kind` is figur, alias, beziehung, ort,
 * ereignis (a dated event), pronomen (a passage where only pronouns name the people) or spaet
 * (a figure or event that appears for the first time in the last fifth of its chapter, `of`).
 * `late` marks every checkpoint that lies in the last fifth. These become entries of the gold
 * set once that part exists (T-289).
 */
const CHECKPOINTS = [
  { id: "a-figur-wenke", chapterId: "x-kettenwache", kind: "figur", elementId: "x-wenke" },
  {
    id: "a-figur-hinrik",
    chapterId: "x-kettenwache",
    kind: "figur",
    elementId: "x-hinrik",
    mentionOnly: true,
  },
  { id: "a-alias-federwenke", chapterId: "x-kettenwache", kind: "alias", elementId: "x-wenke" },
  { id: "a-alias-kartenleserin", chapterId: "x-kettenwache", kind: "alias", elementId: "mara" },
  { id: "a-alias-kettenmeisterin", chapterId: "x-kettenwache", kind: "alias", elementId: "oda" },
  {
    id: "a-beziehung-misstrauen",
    chapterId: "x-kettenwache",
    kind: "beziehung",
    edgeId: "x-e1",
  },
  {
    id: "a-beziehung-vertrauen",
    chapterId: "x-kettenwache",
    kind: "beziehung",
    edgeId: "x-e1",
  },
  { id: "a-ort-hafenhaus", chapterId: "x-kettenwache", kind: "ort", elementId: "x-hafenhaus" },
  { id: "a-ort-netzboden", chapterId: "x-kettenwache", kind: "ort", elementId: "x-netzboden" },
  { id: "a-ort-salzmarkt", chapterId: "x-kettenwache", kind: "ort", elementId: "salzmarkt" },
  { id: "a-datum-sperrung", chapterId: "x-kettenwache", kind: "ereignis", momentId: "t5" },
  { id: "a-datum-zaehlung", chapterId: "x-kettenwache", kind: "ereignis", momentId: "x-t1" },
  { id: "a-datum-sitzung", chapterId: "x-kettenwache", kind: "ereignis", momentId: "x-t2" },
  { id: "a-datum-verlesung", chapterId: "x-kettenwache", kind: "ereignis", momentId: "x-t3" },
  { id: "a-datum-seeschwalbe", chapterId: "x-kettenwache", kind: "ereignis", momentId: "x-t4" },
  { id: "a-pronomen", chapterId: "x-kettenwache", kind: "pronomen" },
  {
    id: "a-spaet-figur",
    chapterId: "x-kettenwache",
    kind: "spaet",
    of: "figur",
    elementId: "x-jorun",
  },
  {
    id: "a-spaet-ereignis",
    chapterId: "x-kettenwache",
    kind: "spaet",
    of: "ereignis",
    momentId: "x-t4",
  },
  { id: "b-figur-pelle", chapterId: "x-siegel", kind: "figur", elementId: "x-pelle" },
  {
    id: "b-figur-hinrik",
    chapterId: "x-siegel",
    kind: "figur",
    elementId: "x-hinrik",
    mentionOnly: true,
  },
  { id: "b-figur-venn", chapterId: "x-siegel", kind: "figur", mentionOnly: true },
  { id: "b-alias-kreidepelle", chapterId: "x-siegel", kind: "alias", elementId: "x-pelle" },
  {
    id: "b-beziehung-beugen",
    chapterId: "x-siegel",
    kind: "beziehung",
    edgeId: "x-e4",
  },
  { id: "b-ort-salzmarkt", chapterId: "x-siegel", kind: "ort", elementId: "salzmarkt" },
  { id: "b-ort-ebbpfad", chapterId: "x-siegel", kind: "ort" },
  { id: "b-ort-faehrsteg", chapterId: "x-siegel", kind: "ort", elementId: "faehrsteg" },
  { id: "b-datum-kette", chapterId: "x-siegel", kind: "ereignis", momentId: "x-t5" },
  { id: "b-datum-nipptide", chapterId: "x-siegel", kind: "ereignis", momentId: "x-t6" },
  { id: "b-pronomen", chapterId: "x-siegel", kind: "pronomen" },
  {
    id: "b-spaet-figur",
    chapterId: "x-siegel",
    kind: "spaet",
    of: "figur",
    elementId: "x-thea",
  },
  {
    id: "b-spaet-ereignis",
    chapterId: "x-siegel",
    kind: "spaet",
    of: "ereignis",
    momentId: "x-t7",
  },
  { id: "b-datum-siegel", chapterId: "x-siegel", kind: "ereignis", momentId: "x-t7" },
];

/**
 * Where each checkpoint stands in its chapter: the offset of its phrase in UTF-16 units like
 * every offset in Quiltor, the paragraph it is in (counting from 0, paragraphs being separated
 * by an empty line) and the share of the chapter text that lies before it.
 */
export function checkpointPositions(world) {
  return world.checkpoints.map((checkpoint) => {
    const body = world.manuscript.chapters.find((item) => item.id === checkpoint.chapterId).body;
    const offset = body.indexOf(checkpoint.surface);
    return {
      id: checkpoint.id,
      kind: checkpoint.kind,
      chapterId: checkpoint.chapterId,
      offset,
      paragraph: offset < 0 ? -1 : body.slice(0, offset).split("\n\n").length - 1,
      ratio: offset / body.length,
    };
  });
}

/** What each entry of the check part is there for, in the catalog (CATALOG.md). */
export const PURPOSE = {
  ...Object.fromEntries(
    CLUSTER.map((spec) => [
      spec.id,
      `one of eight places stacked on one point (T-129)${spec.important ? "; the favourite" : ""}`,
    ]),
  ),
  "x-long-name": "person whose name is one unbreakable word of 65 letters (T-129, T-183)",
  "x-long-place": "long place name inside Nordhafen (cut as North Harb... in T-173 B)",
  "x-long-org": "long organisation name with an apostrophe (cut in T-173 B)",
  "x-empty-note": "element with an empty note",
  "x-weltkarte":
    "map opened out on the world level, 1000 x 680 with a 25 km scale; mocked alone by the map specs",
  "x-graufurth": "place standing on the opened-out map, the one the map specs select",
  "x-nordhafen":
    "place standing on the opened-out map, 200 km from Graufurth; shares its name with the city, so it keeps no children: element-notes opens the city by 'Nordhafen öffnen'",
  "x-tannenhain": "place standing on the opened-out map near its lower edge",
  "x-inselkarte":
    "second opened-out map, 600 x 500, overlapping the first; the map specs add it on demand",
  "x-inselhafen": "the one place on the second map",
  "x-masslos-ebene": "level of its own for the map without a size (T-79)",
  "x-masslose-karte":
    "opened-out map with a picture but no frame size; the server fills it in (T-79)",
  "x-empty-chapter": "chapter without text and without a note",
  "x-trash-orphan": "chapter in the bin whose folder no longer exists",
  "x-chronicle":
    "chapter with three texts; seedExampleWorldWithHistory saves them as versions, the first creates it (T-86)",
  "x-board": "board holding every card of the check part",
  "x-ref-deleted": "reference card to an element that does not exist (T-177)",
  "x-ref-storm-again":
    "second card on the chapter the main board shows; one note, two cards (T-177)",
  "x-ref-ada": "card on a side character, listed as a backlink in the figure inspector",
  "x-layers": "board holding only the two overlapping notes",
  "x-layer-back": "note overlapped by x-layer-front, one layer below it",
  "x-layer-front": "note overlapping x-layer-back, one layer above it",
  "x-ref-trashed": "reference card to a chapter in the bin (T-177)",
  "x-wenke":
    "council clerk of the long chapters; alias Federwenke; the harbourmaster comes to rely on her (T-355)",
  "x-hinrik": "former harbourmaster, only ever mentioned, never on stage (T-355)",
  "x-jorun":
    "captain who first appears in the last fifth of x-kettenwache, a check for silent truncation (T-355)",
  "x-pelle": "chalk boy of the Salt Market; alias Kreidepelle; figure of x-siegel (T-355)",
  "x-thea": "Guild examiner who first appears in the last fifth of x-siegel (T-355)",
  "x-kettenordnung": "the harbour's chain law; the harbourmaster bends it in x-siegel (T-355)",
  "x-seeschwalbe": "salt barge of x-jorun, waiting before the chain (T-355)",
  "x-hafenhaus": "the council's hall, a place inside Nordhafen (T-355)",
  "x-netzboden": "Bela's net loft, a place inside Nordhafen (T-355)",
  "x-kettenwache":
    "long chapter, 8,000 to 9,000 words, days 12 to 17 of the Tide Reckoning; checkpoints a-* (T-355)",
  "x-siegel":
    "long chapter, 5,500 to 6,500 words, days 25 to 30 of the Tide Reckoning; checkpoints b-* (T-355)",
};
