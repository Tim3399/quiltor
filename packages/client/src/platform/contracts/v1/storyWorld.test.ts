import { describe, expect, it } from "vitest";
import fixture from "../../../../../../contracts/fixtures/application-api/story-world/wire.v1.json";
import manifest from "../../../../../../contracts/manifest.json";
import { decodeStoryWorldV1, encodeStoryWorldV1 } from "./storyWorld";

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("story-world wire v1", () => {
  it("consumes the registered fixture and round-trips extensions", () => {
    const contract = manifest.contracts.find(
      (item) => item.name === "application.story-world-wire" && item.version === 1,
    );
    expect(contract?.fixtures[0]?.path).toBe("fixtures/application-api/story-world/wire.v1.json");

    const decoded = decodeStoryWorldV1(fixture);
    expect(decoded.revision).toBe(4);
    expect(decoded.document.extension).toEqual({ source: "contract-fixture" });
    expect(
      JSON.parse(JSON.stringify(encodeStoryWorldV1(decoded.document, decoded.revision))),
    ).toEqual(fixture);
  });

  it("rejects malformed envelopes, coordinates and references", () => {
    const wrongContract = copy(fixture) as Record<string, unknown>;
    wrongContract.contract = "quiltor.manuscript";
    const invalidCoordinate = copy(fixture);
    invalidCoordinate.payload.nodes[0].x = "far away" as unknown as number;
    const invalidEndpoint = copy(fixture);
    invalidEndpoint.payload.edges[0].to = "missing-place";
    const invalidDirected = copy(fixture);
    invalidDirected.payload.edges[0].gerichtet = "yes" as unknown as boolean;
    const invalidActive = copy(fixture);
    invalidActive.payload.edges[0].versions[0].active = "yes" as unknown as boolean;
    const invalidVersionStyle = copy(fixture);
    (invalidVersionStyle.payload.edges[0].versions[0] as Record<string, unknown>).style = "wavy";

    expect(() => decodeStoryWorldV1(wrongContract)).toThrow();
    expect(() => decodeStoryWorldV1(invalidCoordinate)).toThrow();
    expect(() => decodeStoryWorldV1(invalidEndpoint)).toThrow();
    expect(() => decodeStoryWorldV1(invalidDirected)).toThrow();
    expect(() => decodeStoryWorldV1(invalidActive)).toThrow();
    expect(() => decodeStoryWorldV1(invalidVersionStyle)).toThrow();
  });

  it("isolates and validates profile and timeline note references", () => {
    const source = copy(fixture);
    const decoded = decodeStoryWorldV1(source);
    const profileReference = decoded.document.nodes[0].profile?.noteReferences?.[0];
    const momentReference = decoded.document.timeline?.[0].noteReferences?.[0];
    expect(profileReference?.target).toEqual({ kind: "place", id: "archive" });
    expect(momentReference?.surface).toBe("Archiv");
    if (!profileReference || !momentReference) return;
    profileReference.target.id = "changed-profile";
    momentReference.target.id = "changed-moment";
    expect(source.payload.nodes[0].profile?.noteReferences[0].target.id).toBe("archive");
    expect(source.payload.timeline[0].noteReferences[0].target.id).toBe("archive");

    const encoded = encodeStoryWorldV1(decoded.document, decoded.revision);
    profileReference.target.id = "changed-after-encode";
    momentReference.target.id = "changed-after-encode";
    expect(encoded.payload.nodes[0].profile?.noteReferences?.[0].target.id).toBe("changed-profile");
    expect(encoded.payload.timeline?.[0].noteReferences?.[0].target.id).toBe("changed-moment");

    const badProfileRange = copy(fixture);
    const badProfile = badProfileRange.payload.nodes[0].profile;
    expect(badProfile).toBeDefined();
    if (!badProfile) throw new Error("fixture profile is missing");
    badProfile.noteReferences[0].to = 999;
    expect(() => decodeStoryWorldV1(badProfileRange)).toThrow();

    const badMomentSurface = copy(fixture);
    badMomentSurface.payload.timeline[0].noteReferences[0].surface = "Ankunft";
    expect(() => decodeStoryWorldV1(badMomentSurface)).toThrow();

    const duplicateMomentReference = copy(fixture);
    duplicateMomentReference.payload.timeline[0].noteReferences.push({
      ...duplicateMomentReference.payload.timeline[0].noteReferences[0],
    });
    expect(() => decodeStoryWorldV1(duplicateMomentReference)).toThrow();
  });

  it("accepts reference targets for every valid story-world ID", () => {
    const source = copy(fixture);
    const longTargetId = "target".repeat(100);
    source.payload.nodes.push({ ...source.payload.nodes[1], id: longTargetId });
    const profile = source.payload.nodes[0].profile;
    if (!profile) throw new Error("fixture profile is missing");
    profile.noteReferences[0].target.id = longTargetId;

    expect(
      decodeStoryWorldV1(source).document.nodes[0].profile?.noteReferences?.[0].target.id,
    ).toBe(longTargetId);
  });
});
