import { describe, expect, it } from "vitest";
import manifest from "../../../../../../contracts/manifest.json";
import fixture from "../../../../../../contracts/fixtures/application-api/manuscript/wire.v1.json";
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
