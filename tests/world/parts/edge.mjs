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
  storyboards.boards.push({ id: BOARD, title: t("board.x.title") });
  storyboards.nodes.push(
    reference("x-ref-deleted", { kind: "entity", id: "x-gone" }, "card.x-gone.label", 60),
    reference("x-ref-trashed", { kind: "chapter", id: "c-prologue" }, "ch.prologue.title", 380),
  );

  return world;
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
    "place standing on the opened-out map, 200 km from Graufurth; shares its name with the city",
  "x-tannenhain": "place standing on the opened-out map near its lower edge",
  "x-inselkarte":
    "second opened-out map, 600 x 500, overlapping the first; the map specs add it on demand",
  "x-inselhafen": "the one place on the second map",
  "x-empty-chapter": "chapter without text and without a note",
  "x-trash-orphan": "chapter in the bin whose folder no longer exists",
  "x-board": "board holding every card of the check part",
  "x-ref-deleted": "reference card to an element that does not exist (T-177)",
  "x-ref-trashed": "reference card to a chapter in the bin (T-177)",
};
