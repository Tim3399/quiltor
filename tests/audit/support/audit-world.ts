// A content-rich synthetic world for the layout audit, served entirely from route mocks in the
// style of mockWorkshop (tests/e2e/visual-baseline.spec.ts). Long German compounds are on purpose:
// they are what stresses narrow viewports. Nothing here reaches the real server's worlds.
import type { Page, Route } from "@playwright/test";
import exportPreviewEpub from "../../../contracts/fixtures/application-api/manuscript-export/preview.epub.v1.json" with {
  type: "json",
};
import exportPreview from "../../../contracts/fixtures/application-api/manuscript-export/preview.v1.json" with {
  type: "json",
};
import type { Manuscript } from "../../../packages/client/src/modules/manuscript";
import type { FigureState } from "../../../packages/client/src/modules/story-world";
import type { StoryboardState } from "../../../packages/client/src/modules/storyboard/model";
import {
  decodeManuscriptV1,
  encodeManuscriptV1,
} from "../../../packages/client/src/platform/contracts/v1/manuscript";
import {
  decodeStoryboardsV1,
  encodeStoryboardsV1,
} from "../../../packages/client/src/platform/contracts/v1/storyboards";
import {
  decodeStoryWorldV1,
  encodeStoryWorldV1,
} from "../../../packages/client/src/platform/contracts/v1/storyWorld";
import {
  fulfillDocumentSave,
  fulfillManuscript,
  fulfillStoryboards,
  fulfillStoryWorld,
} from "../../e2e/support/application-api";

const AUDIT_WORLD = {
  id: "gezeitenatlas",
  title: "Der gläserne Gezeitenatlas der Nordmeerküsten",
  backupUrl: "https://backup.example.com",
  updated: "2026-08-09T12:00:00Z",
};

const OTHER_WORLDS = [
  {
    id: "donaudampfer",
    title: "Die Donaudampfschifffahrtsgesellschaftskapitänswitwe",
    backupUrl: "",
    updated: "2026-07-01T09:30:00Z",
  },
  { id: "kurz", title: "Ebbe", backupUrl: "", updated: "2026-06-11T18:00:00Z" },
];

const OPENING =
  "Der Morgen lag still über dem Hafen. Mara Venn öffnete die Karte des Gezeitenarchivs und " +
  "las die Strömungen wie eine Handschrift. Die Leuchtturmwärterin Ilse Brandt winkte vom " +
  "Wellenbrecher herüber.\n\nIm Hafenmeisterbüro roch es nach Teer, Salz und " +
  "Schiffszwiebackvorratskammer. Niemand sprach über die Sturmflutwarnungsbekanntmachung.";

function mention(id: string, elementId: string, text: string, surface: string) {
  const from = text.indexOf(surface);
  return {
    id,
    elementId,
    from,
    to: from + surface.length,
    surface,
    source: "deterministic" as const,
    confidence: 1,
  };
}

const filler = (topic: string) =>
  `${topic} Die Möwen kreisten über den Landungsbrücken, und die Flut stieg langsam an. ` +
  "Hinter den Speichern lag die Altstadt mit ihren schiefen Giebeln und engen Gassen. ".repeat(6);

function auditManuscript(): Manuscript {
  return {
    chapters: [
      {
        id: "ankunft",
        title: "Die Ankunft im Gezeitenhafen",
        body: OPENING,
        note: "Die Unruhe nur andeuten. Kein Wort über das Archiv.",
        storyTime: { startMomentId: "t-ankunft" },
        mentions: [
          mention("m1", "mara", OPENING, "Mara Venn"),
          mention("m2", "ilse", OPENING, "Ilse Brandt"),
        ],
      },
      {
        id: "archiv",
        title: "Im Lesesaal des Gezeitenarchivs",
        body: filler("Das Archiv öffnete erst am Mittag."),
        note: "",
        storyTime: { startMomentId: "t-archiv", endMomentId: "t-sturm" },
      },
      {
        id: "sturm",
        title: "Sturmflutwarnungsbekanntmachungsnacht",
        body: filler("In der Nacht drehte der Wind."),
        note: "Hier kippt die Stimmung.",
      },
      {
        id: "zurueck",
        title: "Zurückgestellte Notizen",
        body: "Eine Szene, die noch keinen Platz hat.",
        note: "",
        inBook: false,
      },
    ],
    structure: {
      folders: [{ id: "teil-eins", title: "Erster Teil: Küstenvermessungsunterlagen" }],
      items: [
        { id: "i-teil", kind: "folder", folderId: "teil-eins", position: 0 },
        {
          id: "i-ankunft",
          kind: "chapter",
          chapterId: "ankunft",
          parentFolderId: "teil-eins",
          position: 0,
        },
        {
          id: "i-archiv",
          kind: "chapter",
          chapterId: "archiv",
          parentFolderId: "teil-eins",
          position: 1,
        },
        { id: "i-sturm", kind: "chapter", chapterId: "sturm", position: 1 },
        { id: "i-zurueck", kind: "chapter", chapterId: "zurueck", position: 2 },
      ],
    },
    trash: [
      {
        chapter: {
          id: "verworfen",
          title: "Verworfener Prolog über Leuchtfeuerbetriebsvorschriften",
          body: "Ein Anfang, der nicht trug.",
          note: "",
        },
        deletedAt: "2026-08-01T10:00:00Z",
        originalFolderPath: [],
        treeItem: { id: "i-verworfen", kind: "chapter", chapterId: "verworfen", position: 3 },
      },
    ],
    words: [
      "Gezeitenarchiv",
      { w: "Schlickwatt", d: "Weicher Meeresboden bei Ebbe" },
      "Leuchtfeuerverzeichnis",
    ],
    activeSymbols: ["„", "“", "…", "–"],
  };
}

function auditStoryWorld(): FigureState {
  return {
    nodes: [
      {
        id: "mara",
        x: 120,
        y: 120,
        type: "person",
        name: "Mara Venn",
        label: "Kartographin",
        sub: "Liest lebende Karten und misstraut jeder Küstenlinienvermessung.",
        important: true,
        aliases: [{ alias: "die Kartenleserin" }],
        profile: {
          fields: [
            { id: "f1", key: "Alter", value: "34" },
            { id: "f2", key: "Herkunft & Vorgeschichte", value: "Aufgewachsen im Lotsenhaus." },
          ],
          notes: "Spricht leise, wenn sie lügt.",
        },
      },
      {
        id: "ilse",
        x: 460,
        y: 80,
        type: "person",
        name: "Ilse Brandt",
        label: "Leuchtturmwärterin",
        sub: "Kennt jede Untiefe.",
      },
      {
        id: "mowe",
        x: 760,
        y: 140,
        type: "tier",
        name: "Kapitän Möwe",
        label: "Tier",
        sub: "Stiehlt Fisch.",
      },
      {
        id: "gilde",
        x: 300,
        y: 380,
        type: "organisation",
        name: "Hafenlotsengilde",
        label: "Organisation",
        sub: "Hütet die Fahrrinnen.",
      },
      { id: "kompass", x: 620, y: 420, type: "objekt", name: "Gläserner Kompass", label: "Objekt" },
      { id: "flut", x: 900, y: 360, type: "konzept", name: "Springflut", label: "Konzept" },
      {
        id: "weltkarte",
        type: "ort",
        name: "Nordmeerküste",
        label: "Karte",
        sub: "Die Küsten des Nordens.",
        x: 0,
        y: 0,
        mapImageId: "nordkueste",
        mapExpanded: true,
        mapWidth: 1000,
        mapHeight: 680,
        pinned: true,
        mapScale: { unitsPer100px: 25, unitLabel: "km" },
      },
      ...[
        { id: "archivort", name: "Gezeitenarchiv", mapU: 0.3, mapV: 0.4 },
        { id: "hafen", name: "Hafenmeisterbüro", mapU: 0.7, mapV: 0.4 },
        { id: "leuchtturm", name: "Leuchtturm Süderoog", mapU: 0.48, mapV: 0.7 },
      ].map((place) => ({
        ...place,
        type: "ort" as const,
        x: 0,
        y: 0,
        label: "Ort",
        sub: "An der nördlichen Küste.",
        parentPlaceId: "weltkarte",
      })),
      {
        id: "insel",
        type: "ort",
        name: "Halligwarftsiedlung",
        label: "Ort",
        sub: "Eine Warft im Wattenmeer.",
        x: 1200,
        y: 0,
      },
    ],
    edges: [
      { id: "e1", from: "mara", to: "archivort", label: "sucht", directed: true },
      {
        id: "e2",
        from: "mara",
        to: "ilse",
        label: "vertraut",
        directed: false,
        color: "gold",
        versions: [{ momentId: "t-sturm", active: true, label: "misstraut" }],
      },
      {
        id: "e3",
        from: "ilse",
        to: "gilde",
        label: "gehört zur",
        directed: true,
        lineStyle: "dashed",
      },
      { id: "e4", from: "mowe", to: "kompass", label: "stiehlt", directed: true },
    ],
    timeline: [
      {
        id: "t-ankunft",
        title: "Ankunft",
        time: 0,
        date: "1847-09-03",
        note: "Mara erreicht den Hafen.",
      },
      { id: "t-archiv", title: "Lesesaal", time: 1, note: "Das Archiv öffnet." },
      { id: "t-sturm", title: "Sturmflutwarnungsbekanntmachung", time: 3, note: "Der Wind dreht." },
      // No chapter refers to this moment, so the timeline lets it be deleted (confirm dialog).
      { id: "t-nachspiel", title: "Nachspiel", time: 5, note: "Ruhe nach dem Sturm." },
    ],
    presence: [
      { id: "p1", elementId: "mara", placeId: "hafen" },
      { id: "p2", elementId: "mara", placeId: "archivort", momentId: "t-archiv" },
      { id: "p3", elementId: "ilse", placeId: "leuchtturm" },
    ],
  };
}

function auditStoryboards(): StoryboardState {
  return {
    boards: [
      { id: "main-storyboard", title: "Handlungsbogen" },
      { id: "nebenhandlung", title: "Nebenhandlung der Hafenlotsengilde" },
    ],
    nodes: [
      {
        id: "story-note-1",
        boardId: "main-storyboard",
        kind: "note",
        x: 40,
        y: 40,
        text: "Mara findet die Karte. Wer hat sie dort versteckt?",
      },
      {
        id: "story-ref-1",
        boardId: "main-storyboard",
        kind: "reference",
        x: 380,
        y: 60,
        target: { kind: "entity", id: "mara" },
      },
      {
        id: "story-group-1",
        boardId: "main-storyboard",
        kind: "group",
        x: 40,
        y: 260,
        width: 520,
        height: 220,
        label: "Zweiter Akt: Sturmflutvorbereitungen",
      },
      {
        id: "story-board-1",
        boardId: "main-storyboard",
        kind: "storyboard",
        x: 700,
        y: 60,
        target: { kind: "storyboard", id: "nebenhandlung" },
      },
    ],
    edges: [
      {
        id: "se1",
        boardId: "main-storyboard",
        sourceNodeId: "story-note-1",
        targetNodeId: "story-ref-1",
        label: "führt zu",
        directed: true,
      },
    ],
  };
}

const MAP_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="680" viewBox="0 0 1000 680">
  <rect width="1000" height="680" fill="#d4e1e3"/>
  <path d="M0 0H750L715 65 815 130 725 180 810 240 695 295 775 350 690 415 740 490 650 550 660 680H0Z" fill="#e8e5d6" stroke="#829b98" stroke-width="3"/>
  <path d="M225 0Q160 120 315 220T380 415Q420 495 695 500" fill="none" stroke="#a9c7cf" stroke-width="13"/>
</svg>`;

/** git word-diff output, the format HistoryDialog parses. */
const HISTORY_DIFF = [
  "diff --git a/kapitel/03-sturmflutwarnungsbekanntmachungsnacht.md b/kapitel/03-sturmflutwarnungsbekanntmachungsnacht.md",
  "index 1111111..2222222 100644",
  "--- a/kapitel/03-sturmflutwarnungsbekanntmachungsnacht.md",
  "+++ b/kapitel/03-sturmflutwarnungsbekanntmachungsnacht.md",
  "@@ -1,3 +1,3 @@",
  "In der Nacht drehte [-der Wind.-]{+der Wind, und die Deichschutzverbandsversammlung tagte bis zum Morgen.+}",
  "Die Möwen kreisten über den Landungsbrücken.",
  "diff --git a/figuren/mara.md b/figuren/mara.md",
  "@@ -1 +1 @@",
  "Mara Venn, [-Kartographin-]{+Kartographin und Gezeitenarchivarin+}",
].join("\n");

export type AuditWorldOptions = {
  /** Make every document save fail, so the shell enters its error phase (recovery). */
  failSaves?: boolean;
};

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body });

/** Installs every route the audit needs. Later routes win in Playwright, so the catch-all comes first. */
export async function mockAuditWorld(page: Page, options: AuditWorldOptions = {}) {
  let manuscript = auditManuscript();
  let storyWorld = auditStoryWorld();
  let storyboards = auditStoryboards();
  const revisions = { manuscript: 0, state: 0, storyboards: 0 };

  // Anything not modelled below answers with a harmless success instead of reaching the server.
  await page.route("**/api/**", (route) => json(route, { ok: true }));

  await page.route("**/api/version", (route) => json(route, { ok: true, version: "audit" }));
  await page.route("**/api/whoami", (route) =>
    json(route, {
      ok: true,
      sub: "autorin",
      email: "autorin@example.com",
      name: "Autorin",
      multiUser: true,
    }),
  );
  await page.route("**/api/worlds", (route) =>
    json(route, { ok: true, worlds: [AUDIT_WORLD, ...OTHER_WORLDS] }),
  );
  await page.route("**/api/worlds/open", (route) => json(route, { ok: true, world: AUDIT_WORLD }));
  await page.route("**/api/worlds/trash*", (route) =>
    json(route, {
      ok: true,
      worlds: [
        {
          ...OTHER_WORLDS[1],
          id: "alt",
          title: "Verworfene Küstenchronik",
          deletedAt: "2026-08-02T08:00:00Z",
        },
      ],
    }),
  );

  const failSave = (route: Route) =>
    json(
      route,
      { ok: false, error: { code: "storage.unavailable", category: "unavailable", params: {} } },
      503,
    );
  await page.route("**/api/manuscript?*", (route) => {
    if (route.request().method() === "GET")
      return fulfillManuscript(route, manuscript, revisions.manuscript);
    if (options.failSaves) return failSave(route);
    manuscript = decodeManuscriptV1(route.request().postDataJSON()).document as Manuscript;
    revisions.manuscript += 1;
    return fulfillDocumentSave(route, revisions.manuscript);
  });
  await page.route("**/api/state?*", (route) => {
    if (route.request().method() === "GET")
      return fulfillStoryWorld(route, storyWorld, revisions.state);
    if (options.failSaves) return failSave(route);
    storyWorld = decodeStoryWorldV1(route.request().postDataJSON()).document;
    revisions.state += 1;
    return fulfillDocumentSave(route, revisions.state);
  });
  await page.route("**/api/storyboards?*", (route) => {
    if (route.request().method() === "GET")
      return fulfillStoryboards(route, storyboards, revisions.storyboards);
    if (options.failSaves) return failSave(route);
    storyboards = decodeStoryboardsV1(route.request().postDataJSON()).document;
    revisions.storyboards += 1;
    return fulfillDocumentSave(route, revisions.storyboards);
  });

  await page.route("**/api/place-map?*", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: MAP_IMAGE }),
  );

  await page.route("**/api/assistant/status*", (route) =>
    json(route, {
      ok: true,
      available: true,
      installed: true,
      mode: "local",
      reason: "",
      chunks: 42,
      model: "audit-model",
    }),
  );
  // A finished world extraction with proposals, so proposal cards, the claim classifier and the
  // proposal editor exist (shape as in tests/e2e/assistant-proposal-retry.spec.ts).
  await page.route("**/api/assistant/jobs", (route) =>
    json(route, {
      ok: true,
      created: true,
      job: {
        id: "audit-job",
        status: "completed",
        error: "",
        errorType: "",
        cancelRequested: false,
        createdAt: "2026-08-09T12:00:00Z",
        result: {
          ok: true,
          message:
            "Im Kapitel „Die Ankunft im Gezeitenhafen“ habe ich eine neue Figur und eine Beziehung gefunden.",
          sources: [],
          mode: "world_extraction",
          extraction: { chapterIds: ["ankunft"], chapterCount: 1, groupCount: 1 },
          proposals: [
            {
              kind: "create_element",
              tempId: "new:joergensen",
              element: { type: "person", name: "Hafenkapitän Jörgensen" },
            },
            {
              kind: "create_relationship",
              relationship: {
                from: "mara",
                to: "ilse",
                label: "misstraut heimlich",
                directed: true,
              },
            },
          ],
        },
      },
    }),
  );
  await page.route("**/api/assistant/progress*", (route) =>
    json(route, { ok: true, progress: null }),
  );
  await page.route("**/api/writing-assistance/status*", (route) =>
    json(route, {
      ok: true,
      installed: true,
      stale: false,
      version: "audit",
      sources: {
        "audit-dictionary": {
          version: "1",
          url: "https://example.com/woerterbuch",
          checksum: "0".repeat(64),
          license: "CC BY-SA 4.0",
          attribution: "Audit-Wörterbuch",
        },
      },
      grammar: {
        supported: true,
        unsupportedReason: "",
        available: true,
        installed: true,
        running: true,
        version: "6.5",
        javaVersion: 21,
        javaRequired: 17,
        externalConfigured: false,
        externalEnabled: false,
        download: {
          url: "https://languagetool.org/download/LanguageTool-6.5.zip",
          checksum: "0".repeat(64),
          license: "LGPL-2.1",
        },
      },
    }),
  );
  await page.route("**/api/writing-assistance/lookup*", (route) => {
    const body = (route.request().postDataJSON() ?? {}) as { query?: string; mode?: string };
    return json(route, {
      ok: true,
      query: body.query ?? "",
      language: "de-DE",
      mode: body.mode ?? "dictionary",
      version: "audit",
      results: [
        {
          lemma: body.query || "Hafen",
          partOfSpeech: "Substantiv",
          meaning: "Geschützter Liegeplatz für Schiffe an einer Küste oder einem Flussufer.",
          values: ["Anlegestelle", "Liegeplatz", "Schiffsanlegestellenverwaltungsbereich"],
          source: "Audit-Wörterbuch",
        },
      ],
    });
  });
  await page.route("**/api/writing-assistance/check*", (route) =>
    json(route, {
      ok: true,
      language: "de-DE",
      issues: [
        {
          id: "g1",
          from: 4,
          to: 10,
          ruleId: "AUDIT_RULE",
          category: "Grammatik",
          message: "Möglicherweise fehlt hier ein Komma vor der Konjunktion.",
          replacements: ["Morgen,", "Morgen"],
        },
      ],
    }),
  );
  await page.route("**/api/manuscript-export/preview*", (route) => {
    const preset = (route.request().postDataJSON() as { preset?: string } | null)?.preset;
    if (preset === "epub") return json(route, exportPreviewEpub);
    return json(route, { ...exportPreview, preview: { ...exportPreview.preview, preset } });
  });

  await page.route("**/api/history?*", (route) =>
    json(route, {
      ok: true,
      commits: [
        {
          hash: "a".repeat(40),
          shortHash: "aaaaaaa",
          date: "2026-08-08T20:00:00Z",
          subject: "Kapitel über die Sturmflutnacht ergänzt",
        },
        {
          hash: "b".repeat(40),
          shortHash: "bbbbbbb",
          date: "2026-08-07T09:00:00Z",
          subject: "Figuren angelegt",
        },
      ],
    }),
  );
  await page.route("**/api/history", (route) => json(route, { ok: true, commits: [] }));
  await page.route("**/api/history/diff*", (route) =>
    json(route, {
      ok: true,
      diff: HISTORY_DIFF,
      newFiles: ["kapitel/05-nachspiel.md"],
      mode: "word",
    }),
  );

  const backupStatus = {
    ok: true,
    endpoint: AUDIT_WORLD.backupUrl,
    changes: ["manuscript.json", "state.json"],
    changeCount: 2,
    suggestedMessage: "Kapitel „Sturmflutwarnungsbekanntmachungsnacht“ überarbeitet",
    lastSuccessfulTransfer: "2026-08-07T09:00:00Z",
    transferredSnapshotId: "snap-1",
  };
  await page.route("**/api/backup?*", (route) => json(route, backupStatus));
  await page.route("**/api/backup", (route) => json(route, backupStatus));
  await page.route("**/api/backup/login*", (route) =>
    json(route, {
      ok: true,
      configured: true,
      hosted: false,
      endpoint: AUDIT_WORLD.backupUrl,
      signedIn: true,
      account: "autorin",
      email: "autorin@example.com",
      name: "Autorin",
      issuer: "https://login.example.com",
      scope: "backup",
      issuerReachable: true,
    }),
  );
  await page.route("**/api/backups?*", (route) =>
    json(route, {
      ok: true,
      backups: [
        {
          name: "quiltor-2026-08-08T20-00-00.sqlite",
          created: "2026-08-08T20:00:00Z",
          size: 182_000,
        },
        {
          name: "quiltor-2026-08-07T09-00-00.sqlite",
          created: "2026-08-07T09:00:00Z",
          size: 176_400,
        },
      ],
    }),
  );
  await page.route("**/api/backups", (route) =>
    json(route, {
      ok: true,
      backups: [
        {
          name: "quiltor-2026-08-08T20-00-00.sqlite",
          created: "2026-08-08T20:00:00Z",
          size: 182_000,
        },
      ],
    }),
  );
  await page.route("**/api/backups/location*", (route) =>
    json(route, {
      ok: true,
      storage: {
        databasePath: "C:/Users/Autorin/AppData/Roaming/Quiltor/Welten/gezeitenatlas.sqlite3",
        backupDirectory: "C:/Users/Autorin/AppData/Roaming/Quiltor/Sicherungen/Gezeitenatlas",
        lastSuccessfulBackup: "2026-08-08T20:00:00Z",
        scope: "application-host",
        canOpenFolder: false,
      },
    }),
  );
  await page.route("**/api/backups/preview*", (route) =>
    json(route, {
      ok: true,
      documents: {
        manuscript: encodeManuscriptV1(auditManuscript(), 0),
        figures: encodeStoryWorldV1(auditStoryWorld(), 0),
        storyboards: encodeStoryboardsV1(auditStoryboards(), 0),
      },
    }),
  );
  await page.route("**/api/sync*", (route) =>
    json(route, {
      ok: true,
      configured: true,
      endpoint: AUDIT_WORLD.backupUrl,
      mode: "manual",
      state: "local-pending",
      localFingerprint: "f".repeat(64),
      baseGeneration: 3,
      remote: { generation: 3, snapshotId: "snap-1" },
      lastSyncedAt: "2026-08-07T09:00:00Z",
      account: {
        accountId: "autorin",
        access: "read-write",
        usedBytes: 1_200_000,
        limitBytes: 50_000_000,
        deleteAfter: null,
      },
    }),
  );
  return {
    manuscript: () => manuscript,
    storyWorld: () => storyWorld,
    storyboards: () => storyboards,
  };
}
