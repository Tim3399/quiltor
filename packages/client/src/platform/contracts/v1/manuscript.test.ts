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
