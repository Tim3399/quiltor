// The structure of the example world, once for every language: ids, positions, assignments,
// relationships, times and cards. Words never appear here, only the keys of texts.<lang>.mjs.
//
// A branch on the language belongs in the texts, never in here: example_world.test.mjs builds
// both worlds with the texts replaced by their keys and requires them to be identical.

/** One element of the world: where it sits in the graph and what kind it is. */
const ELEMENTS = [
  { id: "oda", type: "person", x: 80, y: 80, accent: "ink" },
  { id: "rat", type: "organisation", x: 460, y: 80, accent: "ink" },
  { id: "gilde", type: "organisation", x: 840, y: 80, accent: "ink" },
  { id: "atlas", type: "objekt", x: 1220, y: 80, accent: "gold", important: true },
  { id: "blatt", type: "objekt", x: 1220, y: 310, accent: "rose" },
  {
    id: "nordhafen",
    type: "ort",
    x: 460,
    y: 770,
    accent: "moss",
    place: { mapX: 300, mapY: 300 },
  },
  { id: "iven", type: "person", x: 460, y: 310, accent: "rose" },
  { id: "mara", type: "person", x: 840, y: 310, accent: "gold", important: true },
  { id: "lumen", type: "tier", x: 1220, y: 540, accent: "moss" },
  {
    id: "leuchtturm",
    type: "ort",
    x: 80,
    y: 540,
    accent: "ink",
    place: { mapX: 900, mapY: 480 },
  },
  {
    id: "salzmarkt",
    type: "ort",
    x: 80,
    y: 310,
    accent: "gold",
    place: { parentPlaceId: "nordhafen", mapU: 0.15, mapV: 0.55, placeDisplay: "pin" },
  },
  {
    id: "archive",
    type: "ort",
    x: 460,
    y: 540,
    accent: "moss",
    place: { parentPlaceId: "nordhafen", mapU: 0.42, mapV: 0.5, placeDisplay: "card" },
  },
  { id: "tilo", type: "person", x: 840, y: 540, accent: "moss", died: "t7" },
  {
    id: "faehrsteg",
    type: "ort",
    x: 840,
    y: 770,
    accent: "ink",
    place: { parentPlaceId: "nordhafen", mapU: 0.59, mapV: 0.62, placeDisplay: "pin" },
  },
];

/** Months of the Tide Reckoning: the number of days is identity, the names are texts. */
const MONTH_DAYS = [30, 29, 31, 30, 28, 31, 30, 29];
const WEEKDAY_COUNT = 6;

const MOMENTS = [
  { id: "t1", time: 0 },
  { id: "t2", time: 3 },
  { id: "t3", time: 6 },
  { id: "t4", time: 9 },
  { id: "t5", time: 12 },
  { id: "t6", time: 15 },
  { id: "t7", time: 18 },
  { id: "t8", time: 22 },
];

/** Chapters in reading order: the act they sit in, and the moment they take place at. */
const CHAPTERS = [
  { id: "c-arrival", key: "c1", act: "act-one", moment: "t1" },
  { id: "c-archive", key: "c2", act: "act-one", moment: "t2" },
  { id: "c-sheet", key: "c3", act: "act-one", moment: "t3" },
  { id: "c-market", key: "c4", act: "act-one", moment: "t4" },
  { id: "c-storm", key: "c5", act: "act-two", moment: "t5" },
  { id: "c-break", key: "c6", act: "act-two", moment: "t6" },
  { id: "c-crossing", key: "c7", act: "act-two" },
  { id: "c-coast", key: "c8", act: "act-two" },
];

export function describeWorld(api, mapImageId) {
  const { t } = api;

  const chapter = (spec) => {
    const body = t(`ch.${spec.key}.body`);
    const result = {
      id: spec.id,
      title: t(`ch.${spec.key}.title`),
      body,
      note: t(`ch.${spec.key}.note`),
    };
    if (spec.moment) result.storyTime = { startMomentId: spec.moment };
    return result;
  };

  const chapters = CHAPTERS.map(chapter);
  const arrival = chapters.find((item) => item.id === "c-arrival");
  arrival.mentions = [api.mention(arrival.body, "m-iven", "iven", "el.iven.name")];
  const archive = chapters.find((item) => item.id === "c-archive");
  archive.marks = [api.mark(archive.body, "word.lichtsaum.w", "italic")];

  const folders = [
    { id: "act-one", title: t("folder.act1") },
    { id: "act-two", title: t("folder.act2") },
  ];
  const items = [
    { id: "folder-one", kind: "folder", folderId: "act-one", position: 0 },
    { id: "folder-two", kind: "folder", folderId: "act-two", position: 1 },
  ];
  const positions = {};
  for (const spec of CHAPTERS) {
    positions[spec.act] = (positions[spec.act] ?? -1) + 1;
    items.push({
      id: `item-${spec.id}`,
      kind: "chapter",
      chapterId: spec.id,
      parentFolderId: spec.act,
      position: positions[spec.act],
    });
  }

  // A chapter in the bin, put there on a fixed day so the world does not change between runs.
  const prologue = {
    id: "c-prologue",
    title: t("ch.prologue.title"),
    body: t("ch.prologue.body"),
    note: t("ch.prologue.note"),
  };
  const trash = [
    {
      chapter: prologue,
      deletedAt: "2026-01-12T09:30:00.000Z",
      originalFolderPath: [{ id: "act-one", title: t("folder.act1") }],
      treeItem: {
        id: "item-c-prologue",
        kind: "chapter",
        chapterId: "c-prologue",
        parentFolderId: "act-one",
        position: 4,
      },
    },
  ];

  const manuscript = {
    chapters,
    trash,
    words: ["lichtsaum", "gezeitenarchiv", "kartennebel", "nipptide", "ebbpfad"].map((word) => ({
      w: t(`word.${word}.w`),
      d: t(`word.${word}.d`),
    })),
    activeSymbols: [1, 2, 3, 4].map((index) => t(`symbol.${index}`)),
    structure: { folders, items },
  };

  const field = (id, key, value) => ({ id: `field-${id}`, key, value });

  const node = (spec) => {
    const id = spec.id;
    const result = {
      id,
      x: spec.x,
      y: spec.y,
      type: spec.type,
      name: t(`el.${id}.name`),
      label: t(`el.${id}.label`),
      sub: t(`el.${id}.sub`),
      accent: spec.accent,
    };
    if (spec.important) result.important = true;
    if (spec.died) result.diedMomentId = spec.died;
    result.profile =
      id === "mara"
        ? maraProfile()
        : {
            notes: t(`el.${id}.notes`),
            fields: [field(id, t("field.role"), t(`el.${id}.label`))],
          };
    if (id === "mara") result.aliases = [{ alias: t("el.mara.alias"), source: "manual" }];
    Object.assign(result, spec.place ?? {});
    return result;
  };

  function maraProfile() {
    const { text, marks } = api.noteDoc([
      { level: 1, heading: "el.mara.name", body: "mara.notes.intro" },
      { level: 2, heading: "mara.notes.drive.h", body: "mara.notes.drive.p" },
      { level: 2, heading: "mara.notes.traces.h", body: "mara.notes.traces.p" },
      { level: 2, heading: "mara.notes.open.h", body: "mara.notes.open.p" },
    ]);
    return {
      notes: text,
      fields: [
        field("mara", t("field.role"), t("el.mara.label")),
        field("mara-origin", t("field.origin"), t("el.nordhafen.name")),
      ],
      noteMarks: marks,
      noteReferences: [
        api.reference(text, "ref-iven", { kind: "entity", id: "iven" }, "el.iven.name"),
        api.reference(text, "ref-archive", { kind: "place", id: "archive" }, "el.archive.name"),
        api.reference(text, "ref-atlas-open", { kind: "timeline", id: "t2" }, "moment.t2.title"),
        api.reference(text, "ref-tilo", { kind: "entity", id: "tilo" }, "el.tilo.name"),
      ],
    };
  }

  const nodes = ELEMENTS.map(node);
  // The city level is drawn on a picture; the places in it sit at fixed points of that picture.
  const city = nodes.find((item) => item.id === "nordhafen");
  Object.assign(city, {
    mapImageId,
    mapImageZoom: 1,
    mapImageU: 0.5,
    mapImageV: 0.5,
    mapWidth: 480,
    mapHeight: 320,
    mapScale: { unitsPer100px: 0.15, unitLabel: "km" },
  });

  const edge = (id, from, to, extra = {}) => ({
    id,
    from,
    to,
    label: t(`edge.${id}.label`),
    directed: true,
    lineStyle: "solid",
    ...extra,
  });
  const version = (id, momentId, extra = {}) => ({
    momentId,
    label: t(`edge.${id}.v${momentId.slice(1)}`),
    active: true,
    ...extra,
  });

  const edges = [
    edge("e1", "mara", "iven", { versions: [version("e1", "t2"), version("e1", "t6")] }),
    edge("e2", "mara", "atlas", { color: "gold" }),
    edge("e3", "iven", "archive"),
    edge("e4", "gilde", "iven", {
      lineStyle: "dashed",
      versions: [version("e4", "t6", { color: "rose" })],
    }),
    edge("e5", "mara", "lumen", { directed: false }),
    edge("e6", "gilde", "atlas", { lineStyle: "dashed" }),
    edge("e7", "oda", "rat"),
    edge("e8", "rat", "gilde", { lineStyle: "dashed", versions: [version("e8", "t5")] }),
    edge("e9", "tilo", "mara"),
    edge("e10", "mara", "blatt"),
    edge("e11", "blatt", "atlas"),
    edge("e12", "tilo", "faehrsteg"),
  ];

  const timeline = MOMENTS.map((moment, index) => ({
    id: moment.id,
    title: t(`moment.${moment.id}.title`),
    note: t(`moment.${moment.id}.note`),
    time: moment.time,
    position: index,
    precision: "day",
  }));

  const timeSystem = {
    id: "gezeitenrechnung",
    name: t("calendar.name"),
    kind: "custom",
    unit: "day",
    epochTime: 0,
    epochYear: 214,
    epochMonth: 3,
    epochDay: 7,
    epochWeekday: 2,
    eraName: t("calendar.era"),
    eraAbbreviation: t("calendar.eraAbbreviation"),
    displayFormat: t("calendar.format"),
    months: MONTH_DAYS.map((dayCount, index) => ({
      name: t(`month.${index + 1}.name`),
      shortName: t(`month.${index + 1}.short`),
      dayCount,
    })),
    weekdays: Array.from({ length: WEEKDAY_COUNT }, (_, index) => ({
      name: t(`weekday.${index + 1}.name`),
      shortName: t(`weekday.${index + 1}.short`),
    })),
  };

  const presence = [
    ["mara", "archive", "t1"],
    ["iven", "archive", "t1"],
    ["mara", "archive", "t2"],
    ["iven", "archive", "t2"],
    ["oda", "salzmarkt", "t4"],
    ["mara", "salzmarkt", "t4"],
    ["tilo", "faehrsteg", "t7"],
    ["mara", "leuchtturm", "t8"],
  ].map(([elementId, placeId, momentId], index) => ({
    id: `presence-${index + 1}`,
    elementId,
    placeId,
    momentId,
  }));

  const figures = {
    nodes,
    edges,
    timeline,
    timeSystem,
    mapScale: { unitsPer100px: 0.5, unitLabel: "km" },
    presence,
  };

  return { manuscript, figures, storyboards: describeStoryboards(api) };
}

function describeStoryboards(api) {
  const { t } = api;
  const main = "main-storyboard";
  const second = "second-board";

  const group = (id, boardId, key, box) => ({
    id,
    boardId,
    kind: "group",
    label: t(`card.${key}.label`),
    text: t(`card.${key}.text`),
    zIndex: 0,
    ...box,
  });
  const note = (id, boardId, key, box, extra = {}) => ({
    id,
    boardId,
    kind: "note",
    label: t(`card.${key}.label`),
    text: t(`card.${key}.text`),
    zIndex: 1,
    ...box,
    ...extra,
  });
  // A reference card carries no text of its own: it shows the note of its element (T-177).
  const reference = (id, boardId, target, nameKey, box) => ({
    id,
    boardId,
    kind: "reference",
    target,
    label: t(nameKey),
    zIndex: 1,
    ...box,
  });
  const link = (id, boardId, target, key, box) => ({
    id,
    boardId,
    kind: "storyboard",
    target: { kind: "storyboard", id: target },
    label: t(`card.${key}.link.label`),
    text: t(`card.${key}.link.text`),
    zIndex: 1,
    ...box,
  });

  const arrivalText = t("card.arrival.text");
  const nodes = [
    group("group-act-one", main, "group1", { x: 30, y: 30, width: 760, height: 620 }),
    group("group-act-two", main, "group2", { x: 830, y: 30, width: 650, height: 620 }),
    note(
      "note-arrival",
      main,
      "arrival",
      { x: 70, y: 190, width: 330, height: 190 },
      {
        noteReferences: [
          api.reference(
            arrivalText,
            "story-ref-mara",
            { kind: "entity", id: "mara" },
            "el.mara.name",
          ),
          api.reference(
            arrivalText,
            "story-ref-archive",
            { kind: "place", id: "archive" },
            "el.archive.name",
          ),
        ],
      },
    ),
    reference("reference-mara", main, { kind: "entity", id: "mara" }, "el.mara.name", {
      x: 460,
      y: 190,
      width: 260,
      height: 190,
    }),
    note("note-rumour", main, "rumour", { x: 70, y: 430, width: 330, height: 180 }),
    reference("reference-archive", main, { kind: "place", id: "archive" }, "el.archive.name", {
      x: 460,
      y: 430,
      width: 260,
      height: 180,
    }),
    note("note-turn", main, "turn", { x: 870, y: 190, width: 330, height: 190 }),
    reference("reference-chapter", main, { kind: "chapter", id: "c-storm" }, "ch.c5.title", {
      x: 870,
      y: 430,
      width: 240,
      height: 180,
    }),
    link("board-crossing", main, second, "crossing", { x: 1190, y: 430, width: 250, height: 180 }),
    note("note-sea", second, "sea", { x: 60, y: 60, width: 340, height: 200 }),
    reference("reference-atlas", second, { kind: "entity", id: "atlas" }, "el.atlas.name", {
      x: 480,
      y: 60,
      width: 260,
      height: 200,
    }),
    note("note-crossing", second, "lantern", { x: 60, y: 340, width: 340, height: 190 }),
    reference("reference-tilo", second, { kind: "entity", id: "tilo" }, "el.tilo.name", {
      x: 480,
      y: 340,
      width: 260,
      height: 190,
    }),
    link("board-north", second, main, "north", { x: 800, y: 340, width: 260, height: 190 }),
  ];

  const edge = (id, boardId, sourceNodeId, targetNodeId, labelKey) => ({
    id,
    boardId,
    sourceNodeId,
    targetNodeId,
    ...(labelKey ? { label: t(`boardEdge.${labelKey}`) } : {}),
    directed: true,
  });

  return {
    boards: [
      { id: main, title: t("board.main.title") },
      { id: second, title: t("board.second.title") },
    ],
    nodes,
    edges: [
      edge("board-edge-one", main, "note-arrival", "reference-mara", "figure"),
      edge("board-edge-two", main, "reference-mara", "reference-archive", "seeks"),
      edge("board-edge-three", main, "note-rumour", "reference-archive", "leads"),
      edge("board-edge-four", main, "note-turn", "reference-chapter"),
      edge("board-edge-five", main, "reference-chapter", "board-crossing", "departure"),
      edge("board-edge-six", second, "note-sea", "reference-atlas", "shows"),
      edge("board-edge-seven", second, "note-crossing", "reference-tilo", "ferryman"),
      edge("board-edge-eight", second, "note-crossing", "board-north", "back"),
    ],
  };
}
