import { describe, expect, it } from "vitest";
import storyWorldSchema from "../../../../../../contracts/application-api/story-world/v1.schema.json";
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
    expect(decoded.document.edges[0]).toMatchObject({
      color: "rose",
      lineStyle: "dotted",
      relationshipKind: "kinship",
    });
    expect(decoded.document.edges[0].versions?.[0]).toMatchObject({
      color: "blue",
      lineStyle: "dashed",
      relationshipKind: "general",
    });
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
    const invalidColor = copy(fixture);
    (invalidColor.payload.edges[0] as Record<string, unknown>).color = "neon";
    const invalidVersionColor = copy(fixture);
    (invalidVersionColor.payload.edges[0].versions[0] as Record<string, unknown>).color = "neon";
    const invalidLineStyle = copy(fixture);
    (invalidLineStyle.payload.edges[0] as Record<string, unknown>).lineStyle = "wavy";
    const invalidRelationshipKind = copy(fixture);
    (invalidRelationshipKind.payload.edges[0] as Record<string, unknown>).relationshipKind =
      "blood";

    expect(() => decodeStoryWorldV1(wrongContract)).toThrow();
    expect(() => decodeStoryWorldV1(invalidCoordinate)).toThrow();
    expect(() => decodeStoryWorldV1(invalidEndpoint)).toThrow();
    expect(() => decodeStoryWorldV1(invalidDirected)).toThrow();
    expect(() => decodeStoryWorldV1(invalidActive)).toThrow();
    expect(() => decodeStoryWorldV1(invalidVersionStyle)).toThrow();
    expect(() => decodeStoryWorldV1(invalidColor)).toThrow();
    expect(() => decodeStoryWorldV1(invalidVersionColor)).toThrow();
    expect(() => decodeStoryWorldV1(invalidLineStyle)).toThrow();
    expect(() => decodeStoryWorldV1(invalidRelationshipKind)).toThrow();
    expect(storyWorldSchema.$defs.edge.properties.color.enum).toEqual([
      "auto",
      "ink",
      "gold",
      "rose",
      "moss",
      "blue",
    ]);
    expect(storyWorldSchema.$defs.relationshipVersion.properties.color.enum).toEqual(
      storyWorldSchema.$defs.edge.properties.color.enum,
    );
    expect(storyWorldSchema.$defs.edge.properties.lineStyle.enum).toEqual([
      "solid",
      "dashed",
      "dotted",
    ]);
    expect(storyWorldSchema.$defs.edge.properties.relationshipKind.enum).toEqual([
      "general",
      "kinship",
    ]);
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

  it("isolates and validates note formatting for profiles and moments", () => {
    const source = copy(fixture);
    const decoded = decodeStoryWorldV1(source);
    expect(decoded.document.nodes[0].profile?.noteMarks).toEqual([
      { from: 10, to: 16, kind: "bold" },
    ]);
    expect(decoded.document.timeline?.[0].noteMarks).toEqual([
      { from: 0, to: 23, kind: "heading", level: 3 },
    ]);
    const profileMark = decoded.document.nodes[0].profile?.noteMarks?.[0];
    if (!profileMark) throw new Error("profile mark fixture missing");
    profileMark.to = 15;
    expect(source.payload.nodes[0].profile?.noteMarks[0].to).toBe(16);

    const invalidMoment = copy(fixture);
    invalidMoment.payload.timeline[0].noteMarks[0].to = 999;
    expect(() => decodeStoryWorldV1(invalidMoment)).toThrow();

    const astralProfile = copy(fixture);
    const astralProfileValue = astralProfile.payload.nodes[0].profile;
    if (!astralProfileValue) throw new Error("profile fixture missing");
    astralProfileValue.notizen = "😀 Mara";
    astralProfileValue.noteReferences = [];
    astralProfileValue.noteMarks = [{ from: 1, to: 2, kind: "bold" }];
    expect(() => decodeStoryWorldV1(astralProfile)).toThrow();

    const astralMoment = copy(fixture);
    astralMoment.payload.timeline[0].note = "😀 Mara";
    astralMoment.payload.timeline[0].noteReferences = [];
    (
      astralMoment.payload.timeline[0] as unknown as {
        noteMarks: Array<Record<string, unknown>>;
      }
    ).noteMarks = [{ from: 1, to: 2, kind: "italic" }];
    expect(() => decodeStoryWorldV1(astralMoment)).toThrow();
  });

  it("normalizes legacy fixed and custom profile values into stable fields", () => {
    const source = copy(fixture);
    const profile = source.payload.nodes[0].profile as Record<string, unknown> | undefined;
    if (!profile) throw new Error("fixture profile is missing");
    delete profile.fields;
    Object.assign(profile, {
      alter: "32",
      rolle: "Kartographin",
      extra: [{ k: "Motiv", v: "Wahrheit", source: "legacy" }],
    });

    const decoded = decodeStoryWorldV1(source);
    expect(decoded.document.nodes[0].profile).toMatchObject({
      notizen: "Kennt das Archiv.",
      fields: [
        { id: "profile-field:mara:legacy:alter", key: "Alter", value: "32" },
        {
          id: "profile-field:mara:legacy:rolle",
          key: "Rolle in der Geschichte",
          value: "Kartographin",
        },
        {
          id: "profile-field:mara:extra:0",
          key: "Motiv",
          value: "Wahrheit",
          source: "legacy",
        },
      ],
    });
    const encoded = encodeStoryWorldV1(decoded.document, decoded.revision);
    expect(encoded.payload.nodes[0].profile).not.toHaveProperty("alter");
    expect(encoded.payload.nodes[0].profile).not.toHaveProperty("extra");
  });

  it("keeps legacy-derived field ids valid for long owner ids", () => {
    const source = copy(fixture);
    const ownerId = "owner".repeat(120);
    source.payload.nodes[0].id = ownerId;
    source.payload.edges[0].from = ownerId;
    source.payload.edges[0].versions[0].from = ownerId;
    source.payload.presence[0].elementId = ownerId;
    const profile = source.payload.nodes[0].profile as Record<string, unknown> | undefined;
    if (!profile) throw new Error("fixture profile is missing");
    delete profile.fields;
    profile.alter = "32";

    const decoded = decodeStoryWorldV1(source);
    const fieldId = decoded.document.nodes[0].profile?.fields?.[0].id;
    expect(fieldId).toBe(`profile-field:${ownerId}:legacy:alter`);
    expect(() => encodeStoryWorldV1(decoded.document, decoded.revision)).not.toThrow();
  });

  it("rejects duplicate or malformed canonical profile fields", () => {
    const duplicate = copy(fixture);
    const fields = duplicate.payload.nodes[0].profile?.fields;
    if (!fields) throw new Error("fixture profile fields are missing");
    fields[1].id = fields[0].id;

    const malformed = copy(fixture);
    const malformedFields = malformed.payload.nodes[0].profile?.fields;
    if (!malformedFields) throw new Error("fixture profile fields are missing");
    malformedFields[0].value = 32 as unknown as string;

    expect(() => decodeStoryWorldV1(duplicate)).toThrow();
    expect(() => decodeStoryWorldV1(malformed)).toThrow();
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
