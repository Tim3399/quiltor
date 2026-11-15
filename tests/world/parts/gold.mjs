// The gold part of the test world: the AI gold set (T-289). Five short chapters, each built
// around one trap for an extraction model, the elements, relationships, moments and presence
// they describe, and what a model is expected to propose from them (`world.evaluation`).
// Every id starts with "g-". The part never ships and no spec seeds it unless it asks for
// `include: ["gold"]`.
//
// Words never appear here, only the keys of texts/gold.<lang>.mjs. Lists of names, synonyms
// and keywords are one text each with "|" between the entries; the evaluation's matcher
// splits them.
//
// `g-wilm-ghost` and the moments g-t-death, g-t-later, g-t-a and g-t-b are material for the
// time check of T-290 (a dead figure present after its death; a date that contradicts the
// order). They are frozen by "append, do not change" and never enter a measurement world.

/** The folder all gold chapters stand in. */
const FOLDER = "g-folder";

/** Gold elements: id, kind, position on the figures board. */
const ELEMENTS = [
  ["g-arvid", "person"],
  ["g-lena", "person"],
  ["g-tamo", "person"],
  ["g-hedda", "person"],
  ["g-fort", "ort"],
  ["g-sandhorn", "ort"],
  ["g-brack", "ort"],
  ["g-wehl", "ort"],
  ["g-key", "objekt"],
  ["g-moewe", "objekt"],
  ["g-crew", "organisation"],
  ["g-wilm-ghost", "person"],
].map(([id, type], index) => ({
  id,
  type,
  x: 2800 + (index % 4) * 380,
  y: 80 + Math.floor(index / 4) * 230,
}));

/** The elements of the time check; never part of a measurement world. */
export const TIME_CHECK_ELEMENTS = ["g-wilm-ghost"];
/** The moments of the time check; never part of a measurement world. */
export const TIME_CHECK_MOMENTS = ["g-t-death", "g-t-later", "g-t-a", "g-t-b"];

/** The gold chapters, in order, and the elements each one mentions by name. */
const CHAPTERS = [
  { id: "g-ch-alias", key: "g-alias", mentions: ["g-arvid", "g-fort", "g-key", "g-lena"] },
  { id: "g-ch-pronoun", key: "g-pronoun", mentions: ["g-lena", "g-sandhorn"] },
  { id: "g-ch-mention", key: "g-mention", mentions: ["g-fort", "g-lena", "g-arvid", "g-hedda"] },
  { id: "g-ch-shift", key: "g-shift", mentions: ["g-tamo", "g-arvid", "g-brack"] },
  {
    id: "g-ch-trip",
    key: "g-trip",
    mentions: ["g-lena", "g-fort", "g-brack", "g-moewe", "g-crew", "g-wehl"],
  },
];

/** Moments: the events of the chapters, then the time-check material. */
const MOMENTS = [
  { id: "g-ev-gate" },
  { id: "g-ev-watch" },
  { id: "g-ev-meal" },
  { id: "g-ev-command" },
  // The trip has one moment per place (critic note r4).
  { id: "g-ev-depart", date: "1803-03-14" },
  { id: "g-ev-board" },
  { id: "g-ev-landing" },
  { id: "g-t-death" },
  { id: "g-t-later" },
  // In this order on purpose: g-t-a carries the earlier date but stands after g-t-b.
  { id: "g-t-b", date: "1803-03-20" },
  { id: "g-t-a", date: "1803-03-14" },
];

/** Relationships: id, from, to, directed. */
const EDGES = [
  ["g-e-key", "g-arvid", "g-key", true],
  ["g-e-distrust", "g-lena", "g-arvid", true],
  // Two relationships on one pair: allies who became rivals (g-ch-shift).
  ["g-e-ally", "g-arvid", "g-tamo", false],
  ["g-e-rival", "g-arvid", "g-tamo", false],
];

/** Presence: id, figure, place, moment. Every entry carries its moment. */
const PRESENCE = [
  ["g-p-arvid-gate", "g-arvid", "g-fort", "g-ev-gate"],
  ["g-p-lena-gate", "g-lena", "g-fort", "g-ev-gate"],
  ["g-p-lena-watch", "g-lena", "g-sandhorn", "g-ev-watch"],
  ["g-p-arvid-meal", "g-arvid", "g-fort", "g-ev-meal"],
  ["g-p-lena-meal", "g-lena", "g-fort", "g-ev-meal"],
  ["g-p-lena-depart", "g-lena", "g-fort", "g-ev-depart"],
  ["g-p-lena-board", "g-lena", "g-brack", "g-ev-board"],
  ["g-p-lena-landing", "g-lena", "g-wehl", "g-ev-landing"],
  // Time check: present after his death.
  ["g-p-ghost-later", "g-wilm-ghost", "g-fort", "g-t-later"],
];

/**
 * What a model is expected to propose, per task and chapter. `ref` is the world entry the
 * expectation stands for; `need` is required or optional (an optional entry found is neutral).
 * `missing` expects the two figures that only the notes of g-fort and g-crew name; they are
 * no element in any world, so they have no `ref`.
 */
function expectations(t) {
  const element = (chapter, ref, category, type, need = "required") => ({
    id: `g-exp-${chapter}-${ref.slice(2)}`,
    task: "extract",
    chapterId: `g-ch-${chapter}`,
    category,
    need,
    ref,
    type,
    names: t(`gold.${ref}.names`),
  });
  const figure = (chapter, ref, need) => element(chapter, ref, "figure", "person", need);
  const place = (chapter, ref, need) => element(chapter, ref, "place", "ort", need);
  const thing = (chapter, ref, type, need) => element(chapter, ref, "thing", type, need);
  const relation = (chapter, ref, from, to, directed, need = "required") => ({
    id: `g-exp-${chapter}-${ref.slice(2)}`,
    task: "extract",
    chapterId: `g-ch-${chapter}`,
    category: "relation",
    need,
    ref,
    from,
    to,
    directed,
    relationshipKind: "general",
    synonyms: t(`gold.${ref}.synonyms`),
  });
  const event = (chapter, ref, refs, date) => ({
    id: `g-exp-${chapter}-${ref.slice(2)}`,
    task: "extract",
    chapterId: `g-ch-${chapter}`,
    category: "event",
    need: "required",
    ref,
    refs,
    keys: t(`gold.${ref}.keys`),
    ...(date ? { date } : {}),
  });
  const presence = (chapter, ref) => {
    const [, elementId, placeId] = PRESENCE.find(([id]) => id === ref);
    return {
      id: `g-exp-${chapter}-${ref.slice(2)}`,
      task: "extract",
      chapterId: `g-ch-${chapter}`,
      category: "presence",
      need: "required",
      ref,
      elementId,
      placeId,
    };
  };
  const missing = (ref) => ({
    id: `g-exp-missing-${ref.slice(2)}`,
    task: "missing",
    category: "figure",
    need: "required",
    type: "person",
    names: t(`gold.${ref}.names`),
  });
  return [
    // Alias chain: one figure under four names.
    figure("alias", "g-arvid"),
    figure("alias", "g-lena"),
    place("alias", "g-fort"),
    thing("alias", "g-key", "objekt"),
    relation("alias", "g-e-key", "g-arvid", "g-key", true),
    relation("alias", "g-e-distrust", "g-lena", "g-arvid", true, "optional"),
    presence("alias", "g-p-arvid-gate"),
    presence("alias", "g-p-lena-gate"),
    event("alias", "g-ev-gate", ["g-arvid", "g-fort"]),
    // Pronoun only: no new figure called "she".
    figure("pronoun", "g-lena"),
    place("pronoun", "g-sandhorn"),
    presence("pronoun", "g-p-lena-watch"),
    event("pronoun", "g-ev-watch", ["g-lena", "g-sandhorn"]),
    // A quoted grandmother: finding her is neutral.
    figure("mention", "g-lena"),
    figure("mention", "g-arvid"),
    figure("mention", "g-hedda", "optional"),
    place("mention", "g-fort"),
    presence("mention", "g-p-arvid-meal"),
    presence("mention", "g-p-lena-meal"),
    event("mention", "g-ev-meal", ["g-lena", "g-arvid", "g-fort"]),
    // Allies turn rivals: two relationships on one pair.
    figure("shift", "g-tamo"),
    figure("shift", "g-arvid"),
    place("shift", "g-brack"),
    place("shift", "g-fort", "optional"),
    relation("shift", "g-e-ally", "g-arvid", "g-tamo", false),
    relation("shift", "g-e-rival", "g-arvid", "g-tamo", false),
    event("shift", "g-ev-command", ["g-arvid", "g-tamo"]),
    // A trip: three places, one moment each, and an absolute date.
    figure("trip", "g-lena"),
    place("trip", "g-fort"),
    place("trip", "g-brack"),
    place("trip", "g-wehl"),
    thing("trip", "g-moewe", "objekt"),
    thing("trip", "g-crew", "organisation"),
    presence("trip", "g-p-lena-depart"),
    presence("trip", "g-p-lena-board"),
    presence("trip", "g-p-lena-landing"),
    event("trip", "g-ev-depart", ["g-lena", "g-fort"], "1803-03-14"),
    event("trip", "g-ev-board", ["g-lena", "g-brack", "g-moewe"]),
    event("trip", "g-ev-landing", ["g-lena", "g-wehl"]),
    // Figures only the notes name.
    missing("g-ilka"),
    missing("g-fenn"),
  ];
}

export function describeGold(api, world) {
  const { t } = api;
  const { manuscript, figures } = world;

  figures.nodes.push(
    ...ELEMENTS.map((spec) => ({
      id: spec.id,
      x: spec.x,
      y: spec.y,
      type: spec.type,
      name: t(`el.${spec.id}.name`),
      label: t(`el.${spec.id}.label`),
      sub: t(`el.${spec.id}.sub`),
      accent: "ink",
      profile: { notes: t(`el.${spec.id}.notes`), fields: [] },
      ...(spec.id === "g-wilm-ghost" ? { diedMomentId: "g-t-death" } : {}),
    })),
  );

  const start = figures.timeline.length;
  figures.timeline.push(
    ...MOMENTS.map((moment, index) => ({
      id: moment.id,
      title: t(`moment.${moment.id}.title`),
      note: t(`moment.${moment.id}.note`),
      ...(moment.date ? { date: moment.date } : {}),
      position: start + index,
    })),
  );

  figures.edges.push(
    ...EDGES.map(([id, from, to, directed]) => ({
      id,
      from,
      to,
      label: t(`edge.${id}.label`),
      directed,
      lineStyle: "solid",
    })),
  );

  figures.presence.push(
    ...PRESENCE.map(([id, elementId, placeId, momentId]) => ({ id, elementId, placeId, momentId })),
  );

  manuscript.structure.folders.push({ id: FOLDER, title: t("folder.g-folder") });
  manuscript.structure.items.push({
    id: `item-${FOLDER}`,
    kind: "folder",
    folderId: FOLDER,
    position: manuscript.structure.items.filter((item) => item.kind === "folder").length,
  });
  for (const [position, spec] of CHAPTERS.entries()) {
    const body = t(`ch.${spec.key}.body`);
    manuscript.chapters.push({
      id: spec.id,
      title: t(`ch.${spec.key}.title`),
      body,
      note: "",
      mentions: spec.mentions.map((elementId) =>
        api.mention(
          body,
          `g-m-${spec.key.slice(2)}-${elementId.slice(2)}`,
          elementId,
          `el.${elementId}.name`,
        ),
      ),
    });
    manuscript.structure.items.push({
      id: `item-${spec.id}`,
      kind: "chapter",
      chapterId: spec.id,
      parentFolderId: FOLDER,
      position,
    });
  }

  world.evaluation = { titles: t("gold.titles"), gold: expectations(t) };
  return world;
}

/**
 * The worlds the evaluation runs against (plan §5), built from a world that includes the
 * gold part. Only `g-` entries survive; the base world, its calendar and the time-check
 * material stay out. Keys are `<task>-<mode>` plus the chapter for `extract`, and `time-check`
 * for the world of T-290, which is not measured.
 */
export function measurementWorlds(world) {
  const gold = world.evaluation.gold;
  const isGold = (id) => typeof id === "string" && id.startsWith("g-");
  const nodes = world.figures.nodes.filter((node) => isGold(node.id));
  const chapters = world.manuscript.chapters.filter((chapter) => isGold(chapter.id));
  const measured = (id) => !TIME_CHECK_ELEMENTS.includes(id) && !TIME_CHECK_MOMENTS.includes(id);

  const build = ({
    chapterIds = [],
    keepMentions = true,
    nodeIds = [],
    edgeIds = [],
    momentIds = [],
    presenceIds = [],
  }) => {
    const chosen = chapters
      .filter((chapter) => chapterIds.includes(chapter.id))
      .map((chapter) => {
        const copy = structuredClone(chapter);
        if (!keepMentions) delete copy.mentions;
        return copy;
      });
    const folders = chosen.length
      ? [world.manuscript.structure.folders.find((folder) => folder.id === FOLDER)]
      : [];
    const items = chosen.length
      ? [
          { id: `item-${FOLDER}`, kind: "folder", folderId: FOLDER, position: 0 },
          ...chosen.map((chapter, position) => ({
            id: `item-${chapter.id}`,
            kind: "chapter",
            chapterId: chapter.id,
            parentFolderId: FOLDER,
            position,
          })),
        ]
      : [];
    const pick = (list, ids) =>
      list.filter((entry) => ids.includes(entry.id)).map((entry) => structuredClone(entry));
    return {
      manuscript: { chapters: chosen, structure: { folders, items }, trash: [] },
      figures: {
        nodes: pick(nodes, nodeIds),
        edges: pick(world.figures.edges, edgeIds),
        timeline: pick(world.figures.timeline, momentIds).map((moment, position) => ({
          ...moment,
          position,
        })),
        presence: pick(world.figures.presence, presenceIds),
      },
    };
  };

  const refsOf = (entries, category) =>
    entries.filter((entry) => entry.category === category && entry.ref).map((entry) => entry.ref);
  const elementCategories = ["figure", "place", "thing"];
  const worlds = {};
  for (const chapter of CHAPTERS) {
    const entries = gold.filter(
      (entry) => entry.task === "extract" && entry.chapterId === chapter.id,
    );
    worlds[`extract-A-${chapter.id}`] = build({ chapterIds: [chapter.id], keepMentions: false });
    worlds[`extract-B-${chapter.id}`] = build({
      chapterIds: [chapter.id],
      nodeIds: elementCategories.flatMap((category) => refsOf(entries, category)),
      edgeIds: refsOf(entries, "relation"),
      momentIds: refsOf(entries, "event"),
      presenceIds: refsOf(entries, "presence"),
    });
  }
  worlds["missing-A"] = build({ nodeIds: ["g-fort", "g-crew"] });
  worlds["missing-B"] = build({
    chapterIds: CHAPTERS.map((chapter) => chapter.id),
    nodeIds: nodes.map((node) => node.id).filter(measured),
    edgeIds: world.figures.edges.filter((edge) => isGold(edge.id)).map((edge) => edge.id),
    momentIds: world.figures.timeline
      .filter((moment) => isGold(moment.id) && measured(moment.id))
      .map((moment) => moment.id),
    presenceIds: PRESENCE.filter(
      ([, elementId, , momentId]) => measured(elementId) && measured(momentId),
    ).map(([id]) => id),
  });
  worlds["time-check"] = build({
    nodeIds: [...TIME_CHECK_ELEMENTS, "g-fort"],
    momentIds: TIME_CHECK_MOMENTS,
    presenceIds: PRESENCE.filter(([, elementId]) => TIME_CHECK_ELEMENTS.includes(elementId)).map(
      ([id]) => id,
    ),
  });
  return worlds;
}

/** What each entry of the gold part is there for, in the catalog (CATALOG.md). */
export const PURPOSE = {
  "g-arvid":
    "figure under four names: Hauptmann Selm Arvid, der Hauptmann, Arvid, Selm (alias trap)",
  "g-lena": "figure that acts only through a pronoun in g-ch-pronoun; travels in g-ch-trip",
  "g-tamo": "ally turned rival of Arvid: two relationships on one pair (g-ch-shift)",
  "g-hedda": "grandmother who is only quoted; an optional entry, finding her is neutral",
  "g-fort": "place of the gold chapters; its note names the smuggler Ilka Saar (task missing)",
  "g-sandhorn": "lighthouse of the pronoun chapter",
  "g-brack": "harbour, second stop of the trip",
  "g-wehl": "island, last stop of the trip",
  "g-key": "thing Arvid carries (relationship g-e-key)",
  "g-moewe": "ship of the trip; its name is part of the crew's name",
  "g-crew": "group whose note names boatswain Fenn (task missing)",
  "g-wilm-ghost":
    "time check for T-290: present after his death (g-t-death, g-t-later); never in a measurement world",
  "g-ch-alias": "gold chapter: one figure under several names",
  "g-ch-pronoun": "gold chapter: a figure acting only through a pronoun; no new figure expected",
  "g-ch-mention": "gold chapter: a figure only quoted ('Wie Großmutter Hedda immer sagte')",
  "g-ch-shift": "gold chapter: allies turn rivals, two triples on one pair",
  "g-ch-trip":
    "gold chapter: a trip over three places, one moment each, absolute date 14 March 1803",
};
