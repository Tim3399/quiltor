import { describe, expect, it } from "vitest";
import fixture from "../../../../../../contracts/fixtures/application-api/manuscript/wire.v1.json";
import manifest from "../../../../../../contracts/manifest.json";
import { decodeManuscriptV1, encodeManuscriptV1 } from "./manuscript";

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("manuscript wire v1", () => {
  it("consumes the registered fixture and round-trips extensions", () => {
    const contract = manifest.contracts.find(
      (item) => item.name === "application.manuscript-wire" && item.version === 1,
    );
    expect(contract?.fixtures[0]?.path).toBe("fixtures/application-api/manuscript/wire.v1.json");

    const decoded = decodeManuscriptV1(fixture);
    expect(decoded.revision).toBe(7);
    expect(decoded.document.extension).toEqual({ source: "contract-fixture" });
    expect(decoded.document.chapters[0].storyTime).toEqual({
      startMomentId: "arrival",
      endMomentId: "departure",
      extensionLabel: "The nested record also preserves extensions.",
    });
    expect(
      JSON.parse(JSON.stringify(encodeManuscriptV1(decoded.document, decoded.revision))),
    ).toEqual(fixture);
  });

  it("isolates nested story-time records and validates their identifiers", () => {
    const source = copy(fixture);
    const decoded = decodeManuscriptV1(source);
    const storyTime = decoded.document.chapters[0].storyTime;
    expect(storyTime).toBeDefined();
    if (!storyTime) return;
    storyTime.startMomentId = "changed-after-decode";
    expect(source.payload.chapters[0].storyTime.startMomentId).toBe("arrival");

    const encoded = encodeManuscriptV1(decoded.document, decoded.revision);
    storyTime.startMomentId = "changed-after-encode";
    expect(encoded.payload.chapters[0].storyTime?.startMomentId).toBe("changed-after-decode");

    const whitespace = copy(fixture);
    whitespace.payload.chapters[0].storyTime.startMomentId = " arrival";
    expect(() => decodeManuscriptV1(whitespace)).toThrow();

    const sameMomentRange = copy(fixture);
    sameMomentRange.payload.chapters[0].storyTime.endMomentId = "arrival";
    expect(() => decodeManuscriptV1(sameMomentRange)).toThrow();
  });

  it("round-trips stable note targets and rejects malformed UTF-16 note ranges", () => {
    const source = copy(fixture);
    const decoded = decodeManuscriptV1(source);
    const reference = decoded.document.chapters[0].noteReferences?.[0];
    expect(reference?.target).toEqual({ kind: "entity", id: "mara" });
    if (!reference) return;
    reference.target.id = "changed-after-decode";
    expect(source.payload.chapters[0].noteReferences[0].target.id).toBe("mara");

    const encoded = encodeManuscriptV1(decoded.document, decoded.revision);
    reference.target.id = "changed-after-encode";
    expect(encoded.payload.chapters[0].noteReferences?.[0].target.id).toBe("changed-after-decode");

    const wrongSurface = copy(fixture);
    wrongSurface.payload.chapters[0].noteReferences[0].surface = "Unruhig";
    expect(() => decodeManuscriptV1(wrongSurface)).toThrow();

    const unknownTarget = copy(fixture);
    (unknownTarget.payload.chapters[0].noteReferences[0].target as Record<string, unknown>).kind =
      "relationship";
    expect(() => decodeManuscriptV1(unknownTarget)).toThrow();

    const astralBoundary = copy(fixture);
    astralBoundary.payload.chapters[0].note = "😀 Mara";
    astralBoundary.payload.chapters[0].noteReferences = [
      {
        id: "split-astral",
        target: { kind: "entity", id: "mara" },
        from: 1,
        to: 2,
        surface: "😀",
      },
    ];
    expect(() => decodeManuscriptV1(astralBoundary)).toThrow();

    const overlapping = copy(fixture);
    overlapping.payload.chapters[0].noteReferences.push({
      id: "overlap",
      target: { kind: "place", id: "archive" },
      from: 8,
      to: 15,
      surface: "he nur ",
    });
    expect(() => decodeManuscriptV1(overlapping)).toThrow();
  });

  it("round-trips detached note formatting and rejects malformed heading ranges", () => {
    const source = copy(fixture);
    const decoded = decodeManuscriptV1(source);
    expect(decoded.document.chapters[0].noteMarks).toEqual([
      { from: 0, to: 24, kind: "heading", level: 2 },
      { from: 4, to: 10, kind: "bold" },
    ]);
    const first = decoded.document.chapters[0].noteMarks?.[0];
    if (first?.kind !== "heading") throw new Error("heading fixture missing");
    first.level = 3;
    expect(source.payload.chapters[0].noteMarks[0].level).toBe(2);
    const encoded = encodeManuscriptV1(decoded.document, decoded.revision);
    first.level = 1;
    expect(encoded.payload.chapters[0].noteMarks?.[0]).toMatchObject({ level: 3 });

    const invalidLevel = copy(fixture);
    invalidLevel.payload.chapters[0].noteMarks[0].level = 4;
    expect(() => decodeManuscriptV1(invalidLevel)).toThrow();

    const multiLine = copy(fixture);
    multiLine.payload.chapters[0].note = "Erste\nZweite";
    multiLine.payload.chapters[0].noteReferences = [];
    multiLine.payload.chapters[0].noteMarks = [{ from: 0, to: 12, kind: "heading", level: 1 }];
    expect(() => decodeManuscriptV1(multiLine)).toThrow();

    const astralBoundary = copy(fixture);
    astralBoundary.payload.chapters[0].note = "😀 Mara";
    astralBoundary.payload.chapters[0].noteReferences = [];
    astralBoundary.payload.chapters[0].noteMarks = [{ from: 1, to: 2, kind: "bold" }];
    expect(() => decodeManuscriptV1(astralBoundary)).toThrow();

    const overlapping = copy(fixture);
    overlapping.payload.chapters[0].noteMarks = [
      { from: 0, to: 8, kind: "italic" },
      { from: 4, to: 12, kind: "italic" },
    ];
    expect(() => decodeManuscriptV1(overlapping)).toThrow();
  });

  it("canonicalizes unsorted note formatting without mutating the source", () => {
    const source = copy(fixture);
    source.payload.chapters[0].noteMarks.reverse();

    const decoded = decodeManuscriptV1(source);

    expect(decoded.document.chapters[0].noteMarks).toEqual([
      { from: 0, to: 24, kind: "heading", level: 2 },
      { from: 4, to: 10, kind: "bold" },
    ]);
    expect(source.payload.chapters[0].noteMarks[0]).toEqual({
      from: 4,
      to: 10,
      kind: "bold",
    });
    expect(encodeManuscriptV1(decoded.document).payload.chapters[0].noteMarks).toEqual(
      decoded.document.chapters[0].noteMarks,
    );
  });

  it("preserves forward-compatible note-mark extensions through the wire round trip", () => {
    const source = copy(fixture);
    Object.assign(source.payload.chapters[0].noteMarks[1], {
      extensionRenderer: "future-emphasis",
    });

    const decoded = decodeManuscriptV1(source);
    expect(decoded.document.chapters[0].noteMarks?.[1]).toMatchObject({
      kind: "bold",
      extensionRenderer: "future-emphasis",
    });
    expect(encodeManuscriptV1(decoded.document).payload.chapters[0].noteMarks?.[1]).toMatchObject({
      kind: "bold",
      extensionRenderer: "future-emphasis",
    });
  });

  it("rejects malformed or unversioned envelopes instead of casting them", () => {
    const wrongVersion = copy(fixture) as Record<string, unknown>;
    wrongVersion.version = 2;
    const extraEnvelopeField = copy(fixture) as Record<string, unknown>;
    extraEnvelopeField.worldId = "routing-leak";
    const invalidPayload = copy(fixture);
    invalidPayload.payload.chapters[0].mentions[0].to = 999;

    expect(() => decodeManuscriptV1(wrongVersion)).toThrow();
    expect(() => decodeManuscriptV1(extraEnvelopeField)).toThrow();
    expect(() => decodeManuscriptV1(invalidPayload)).toThrow();
  });

  it("accepts only JavaScript-safe non-negative revisions", () => {
    const largestSafe = copy(fixture);
    largestSafe.revision = Number.MAX_SAFE_INTEGER;
    expect(decodeManuscriptV1(largestSafe).revision).toBe(Number.MAX_SAFE_INTEGER);

    for (const revision of [-1, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY]) {
      const candidate = copy(fixture);
      candidate.revision = revision;
      expect(() => decodeManuscriptV1(candidate)).toThrow();
    }
  });
});

describe("manuscript wire v1 book layout", () => {
  it("round-trips settings and isolates them from source and encoded values", () => {
    const source = copy(fixture);
    const decoded = decodeManuscriptV1(source);
    expect(decoded.document.bookLayout).toMatchObject({
      preset: "quiltor-novel",
      pageWidthMm: 152.4,
      sceneSymbol: "⁂",
    });
    if (!decoded.document.bookLayout) throw new Error("book-layout fixture missing");
    decoded.document.bookLayout.author = "Changed after decode";
    expect(source.payload.bookLayout.author).toBe("Mara Beispiel");

    const encoded = encodeManuscriptV1(decoded.document, decoded.revision);
    decoded.document.bookLayout.author = "Changed after encode";
    expect(encoded.payload.bookLayout?.author).toBe("Changed after decode");
    expect(encoded.payload.bookLayout?.extensionTypography).toEqual({ kept: true });
  });

  it("keeps old manuscripts without settings readable", () => {
    const wire = copy(fixture);
    delete (wire.payload as Record<string, unknown>).bookLayout;
    expect(decodeManuscriptV1(wire).document.bookLayout).toBeUndefined();
  });

  it("rejects invalid field types, enums, ranges, and unusable page areas", () => {
    const invalid: unknown[] = [];
    for (const [key, value] of [
      ["mirrorMargins", "yes"],
      ["pageFormat", "letter"],
      ["pageFormat", []],
      ["fontSizePt", 5],
      ["widows", 2.5],
      ["sceneSymbol", "   "],
    ] as const) {
      const wire = copy(fixture);
      (wire.payload.bookLayout as Record<string, unknown>)[key] = value;
      invalid.push(wire);
    }
    const narrow = copy(fixture);
    Object.assign(narrow.payload.bookLayout, {
      pageWidthMm: 80,
      marginInnerMm: 25,
      marginOuterMm: 25,
      gutterMm: 1,
    });
    invalid.push(narrow);
    const short = copy(fixture);
    Object.assign(short.payload.bookLayout, {
      pageHeightMm: 80,
      marginTopMm: 26,
      marginBottomMm: 25,
    });
    invalid.push(short);

    for (const wire of invalid) expect(() => decodeManuscriptV1(wire)).toThrow();
  });
});

describe("manuscript wire v1 and hidden elements", () => {
  it("carries the insert panel's selection across the wire", () => {
    const wire = copy(fixture);
    (wire.payload as Record<string, unknown>).hiddenElements = ["mara", "archiv"];

    expect(decodeManuscriptV1(wire).document.hiddenElements).toEqual(["mara", "archiv"]);
  });

  it("rejects anything that is not a list of ids", () => {
    const wire = copy(fixture);
    (wire.payload as Record<string, unknown>).hiddenElements = [42];

    expect(() => decodeManuscriptV1(wire)).toThrow();
  });

  it("stays valid without it -- older documents do not know the field", () => {
    expect(decodeManuscriptV1(copy(fixture)).document.hiddenElements).toBeUndefined();
  });
});

describe("manuscript wire v1 and the German field names it used to have", () => {
  /*
   * Until v3.16 the two lists were called `zeichenAktiv` and `elementeVerborgen`. They are
   * gone, and not merely unused: the world database renames them once when it migrates, so
   * nothing on disk carries them any more. A payload that still does is a payload from
   * somewhere else, and the wire refuses it rather than guessing.
   */
  it("does not map an old key onto the new one", () => {
    const wire = copy(fixture);
    const payload = wire.payload as Record<string, unknown>;
    delete payload.activeSymbols;
    payload.zeichenAktiv = ["„"];

    expect(decodeManuscriptV1(wire).document).not.toHaveProperty("activeSymbols");
  });
});
