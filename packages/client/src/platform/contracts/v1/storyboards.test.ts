import { describe, expect, it } from "vitest";
import storyboardSchema from "../../../../../../contracts/application-api/storyboards/v1.schema.json";
import defaultFixture from "../../../../../../contracts/fixtures/application-api/storyboards/default.v1.json";
import fixture from "../../../../../../contracts/fixtures/application-api/storyboards/wire.v1.json";
import manifest from "../../../../../../contracts/manifest.json";
import { createDefaultStoryboardState } from "../../../modules/storyboard";
import { decodeStoryboardsV1, encodeStoryboardsV1 } from "./storyboards";

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("storyboards wire v1", () => {
  it("registers default, example, and differential fixtures", () => {
    const contract = manifest.contracts.find(
      (item) => item.name === "application.storyboards-wire" && item.version === 1,
    );
    expect(contract?.fixtures).toEqual([
      {
        path: "fixtures/application-api/storyboards/default.v1.json",
        mediaType: "application/json",
        role: "example",
      },
      {
        path: "fixtures/application-api/storyboards/wire.v1.json",
        mediaType: "application/json",
        role: "example",
      },
      {
        path: "fixtures/application-api/storyboards/differential.v1.json",
        mediaType: "application/json",
        role: "differential",
      },
    ]);
    expect(decodeStoryboardsV1(defaultFixture)).toEqual({
      document: createDefaultStoryboardState(),
      revision: 0,
    });
  });

  it("round-trips the normalized boards, nodes, edges, and extensions", () => {
    const decoded = decodeStoryboardsV1(fixture);
    expect(decoded.revision).toBe(3);
    expect(decoded.document.boards).toHaveLength(2);
    expect(decoded.document.nodes.map((node) => node.kind)).toEqual([
      "note",
      "reference",
      "storyboard",
      "group",
    ]);
    expect(decoded.document.extension).toEqual({ source: "contract-fixture" });
    expect(decoded.document.edges[0]).toMatchObject({
      directed: true,
      color: "gold",
      lineStyle: "dotted",
    });
    expect(decoded.document.nodes[1].target).toMatchObject({
      kind: "entity",
      id: "mara",
      extensionLabel: "Mara",
    });
    expect(
      decoded.document.nodes.map((node) => ({
        kind: node.kind,
        text: node.text,
        referenceCount: node.noteReferences?.length,
      })),
    ).toEqual([
      { kind: "note", text: "Mara reaches the archive.", referenceCount: 1 },
      { kind: "reference", text: "Mara protects the archive.", referenceCount: 1 },
      { kind: "storyboard", text: "Plot alternatives.", referenceCount: 1 },
      { kind: "group", text: "Opening sequence.", referenceCount: 1 },
    ]);

    expect(
      JSON.parse(JSON.stringify(encodeStoryboardsV1(decoded.document, decoded.revision))),
    ).toEqual(fixture);
  });

  it("detaches known nested references from decoded and encoded inputs", () => {
    const source = copy(fixture);
    const decoded = decodeStoryboardsV1(source);
    const referenceNode = decoded.document.nodes[1];
    if (referenceNode.kind !== "reference") throw new Error("reference fixture node missing");
    referenceNode.target.id = "changed-after-decode";
    expect(source.payload.nodes[1].target?.id).toBe("mara");

    for (const [index, node] of decoded.document.nodes.entries()) {
      const noteReference = node.noteReferences?.[0];
      if (!noteReference) throw new Error(`fixture reference missing for node ${index}`);
      const originalTargetId = noteReference.target.id;
      noteReference.target.id = `changed-after-decode-${index}`;
      expect(source.payload.nodes[index].noteReferences?.[0].target.id).toBe(originalTargetId);
      noteReference.target.id = originalTargetId;
    }

    const encoded = encodeStoryboardsV1(decoded.document, decoded.revision);
    referenceNode.target.id = "changed-after-encode";
    expect(encoded.payload.nodes[1].target?.id).toBe("changed-after-decode");
    for (const [index, node] of decoded.document.nodes.entries()) {
      const noteReference = node.noteReferences?.[0];
      const encodedTargetId = encoded.payload.nodes[index].noteReferences?.[0].target.id;
      if (!noteReference || !encodedTargetId) {
        throw new Error(`encoded fixture reference missing for node ${index}`);
      }
      noteReference.target.id = `changed-after-encode-${index}`;
      expect(encoded.payload.nodes[index].noteReferences?.[0].target.id).toBe(encodedTargetId);
    }
  });

  it("keeps non-note text optional and validates note references on every node kind", () => {
    const legacy = copy(fixture);
    for (const node of legacy.payload.nodes.slice(1) as Array<{
      text?: string;
      noteReferences?: unknown[];
    }>) {
      delete node.text;
      delete node.noteReferences;
    }
    expect(() => decodeStoryboardsV1(legacy)).not.toThrow();

    const emptyReferencesWithoutText = copy(fixture);
    const referenceNode = emptyReferencesWithoutText.payload.nodes[1] as {
      text?: string;
      noteReferences?: unknown[];
    };
    delete referenceNode.text;
    referenceNode.noteReferences = [];
    expect(() => decodeStoryboardsV1(emptyReferencesWithoutText)).not.toThrow();

    const referencesWithoutText = copy(fixture);
    delete (referencesWithoutText.payload.nodes[1] as { text?: string }).text;
    expect(() => decodeStoryboardsV1(referencesWithoutText)).toThrow();

    for (const index of [0, 1, 2, 3]) {
      const invalid = copy(fixture);
      const noteReference = invalid.payload.nodes[index].noteReferences?.[0];
      if (!noteReference) throw new Error(`fixture reference missing for node ${index}`);
      noteReference.surface = "not the selected text";
      expect(() => decodeStoryboardsV1(invalid), `node ${index}`).toThrow();
    }
  });

  it("keeps the JSON Schema aligned with the note-reference text dependency", () => {
    expect(storyboardSchema.$defs.node.allOf).toContainEqual({
      if: {
        required: ["noteReferences"],
        properties: { noteReferences: { minItems: 1 } },
      },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema intentionally uses `then`.
      then: { required: ["text"] },
    });
  });

  it("round-trips directed edges while keeping absent direction backward-compatible", () => {
    const directed = decodeStoryboardsV1(fixture);
    expect(directed.document.edges[0]).toMatchObject({
      label: "mentions",
      directed: true,
    });

    const legacyUndirected = copy(fixture);
    delete (legacyUndirected.payload.edges[0] as { directed?: boolean }).directed;
    const decodedLegacy = decodeStoryboardsV1(legacyUndirected);
    expect(decodedLegacy.document.edges[0].directed ?? false).toBe(false);
    expect(
      JSON.parse(
        JSON.stringify(encodeStoryboardsV1(decodedLegacy.document, decodedLegacy.revision)),
      ),
    ).toEqual(legacyUndirected);

    const invalidDirection = copy(fixture);
    (invalidDirection.payload.edges[0] as { directed?: unknown }).directed = "yes";
    const invalidColor = copy(fixture);
    (invalidColor.payload.edges[0] as { color?: unknown }).color = "neon";
    const invalidLineStyle = copy(fixture);
    (invalidLineStyle.payload.edges[0] as { lineStyle?: unknown }).lineStyle = "wavy";
    expect(() => decodeStoryboardsV1(invalidDirection)).toThrow();
    expect(() => decodeStoryboardsV1(invalidColor)).toThrow();
    expect(() => decodeStoryboardsV1(invalidLineStyle)).toThrow();

    expect(storyboardSchema.$defs.edge.properties.directed).toEqual({ type: "boolean" });
    expect(storyboardSchema.$defs.edge.properties.color.enum).toEqual([
      "auto",
      "ink",
      "gold",
      "rose",
      "moss",
      "blue",
    ]);
    expect(storyboardSchema.$defs.edge.properties.lineStyle.enum).toEqual([
      "solid",
      "dashed",
      "dotted",
    ]);
  });

  it("rejects malformed envelopes, unsafe geometry, and invalid node semantics", () => {
    const wrongContract = copy(fixture) as Record<string, unknown>;
    wrongContract.contract = "quiltor.story-world";
    const unknownEnvelopeField = copy(fixture) as Record<string, unknown>;
    unknownEnvelopeField.worldId = "routing-leak";
    const nonFinite = copy(fixture);
    nonFinite.payload.nodes[0].x = Number.POSITIVE_INFINITY;
    const unsafe = copy(fixture);
    unsafe.payload.nodes[0].y = Number.MAX_SAFE_INTEGER + 1;
    const zeroWidth = copy(fixture);
    zeroWidth.payload.nodes[0].width = 0;
    const invalidKind = copy(fixture);
    invalidKind.payload.nodes[0].kind = "image";
    const noteWithTarget = copy(fixture);
    noteWithTarget.payload.nodes[0].target = { kind: "entity", id: "mara" };
    const noteWithNullTarget = copy(fixture);
    (noteWithNullTarget.payload.nodes[0] as unknown as Record<string, unknown>).target = null;
    const noteWithoutText = copy(fixture);
    delete (noteWithoutText.payload.nodes[0] as { text?: string }).text;
    const emptyNote = copy(fixture);
    emptyNote.payload.nodes[0].text = "";
    emptyNote.payload.nodes[0].noteReferences = [];
    const longExternalTargetId = copy(fixture);
    if (!longExternalTargetId.payload.nodes[1].target) {
      throw new Error("reference fixture target missing");
    }
    longExternalTargetId.payload.nodes[1].target.id = "😀".repeat(501);
    const whitespaceExternalTargetId = copy(fixture);
    if (!whitespaceExternalTargetId.payload.nodes[1].target) {
      throw new Error("reference fixture target missing");
    }
    whitespaceExternalTargetId.payload.nodes[1].target.id = " mara";
    const oversizedOwnedEdgeId = copy(fixture);
    oversizedOwnedEdgeId.payload.edges[0].id = "😀".repeat(501);
    const missingGroupSize = copy(fixture);
    delete missingGroupSize.payload.nodes[3].width;

    expect(() => decodeStoryboardsV1(wrongContract)).toThrow();
    expect(() => decodeStoryboardsV1(unknownEnvelopeField)).toThrow();
    expect(() => decodeStoryboardsV1(nonFinite)).toThrow();
    expect(() => decodeStoryboardsV1(unsafe)).toThrow();
    expect(() => decodeStoryboardsV1(zeroWidth)).toThrow();
    expect(() => decodeStoryboardsV1(invalidKind)).toThrow();
    expect(() => decodeStoryboardsV1(noteWithTarget)).toThrow();
    expect(() => decodeStoryboardsV1(noteWithNullTarget)).toThrow();
    expect(() => decodeStoryboardsV1(noteWithoutText)).toThrow();
    expect(() => decodeStoryboardsV1(emptyNote)).not.toThrow();
    expect(() => decodeStoryboardsV1(longExternalTargetId)).not.toThrow();
    expect(() => decodeStoryboardsV1(whitespaceExternalTargetId)).not.toThrow();
    expect(() => decodeStoryboardsV1(oversizedOwnedEdgeId)).toThrow();
    expect(() => decodeStoryboardsV1(missingGroupSize)).toThrow();
  });

  it("enforces unique IDs and same-board references", () => {
    const duplicateBoard = copy(fixture);
    duplicateBoard.payload.boards[1].id = duplicateBoard.payload.boards[0].id;
    const missingNodeBoard = copy(fixture);
    missingNodeBoard.payload.nodes[0].boardId = "missing-board";
    const missingBoardTarget = copy(fixture);
    if (!missingBoardTarget.payload.nodes[2].target) {
      throw new Error("board fixture target missing");
    }
    missingBoardTarget.payload.nodes[2].target.id = "missing-board";
    const referenceToBoard = copy(fixture);
    if (!referenceToBoard.payload.nodes[1].target) {
      throw new Error("reference fixture target missing");
    }
    referenceToBoard.payload.nodes[1].target.kind = "storyboard";
    const crossBoardEdge = copy(fixture);
    crossBoardEdge.payload.nodes[1].boardId = "plot-board";
    const missingEndpoint = copy(fixture);
    missingEndpoint.payload.edges[0].targetNodeId = "missing-node";
    const invalidDirection = copy(fixture);
    (invalidDirection.payload.edges[0] as Record<string, unknown>).directed = "yes";

    expect(() => decodeStoryboardsV1(duplicateBoard)).toThrow();
    expect(() => decodeStoryboardsV1(missingNodeBoard)).toThrow();
    expect(() => decodeStoryboardsV1(missingBoardTarget)).toThrow();
    expect(() => decodeStoryboardsV1(referenceToBoard)).toThrow();
    expect(() => decodeStoryboardsV1(crossBoardEdge)).toThrow();
    expect(() => decodeStoryboardsV1(missingEndpoint)).toThrow();
    expect(() => decodeStoryboardsV1(invalidDirection)).toThrow();
  });

  it("validates exact note-reference ranges and local storyboard targets", () => {
    const mismatchedSurface = copy(fixture);
    const references = mismatchedSurface.payload.nodes[0].noteReferences;
    if (!references) throw new Error("note fixture references missing");
    references[0].surface = "archive";

    const source = copy(fixture);
    const sourceReferences = source.payload.nodes[0].noteReferences;
    if (!sourceReferences) throw new Error("note fixture references missing");
    sourceReferences[0].target = { kind: "storyboard", id: "plot-board" };
    expect(decodeStoryboardsV1(source).document.nodes[0]).toMatchObject({
      noteReferences: [{ target: { kind: "storyboard", id: "plot-board" } }],
    });
    sourceReferences[0].target.id = "missing-board";

    expect(() => decodeStoryboardsV1(mismatchedSurface)).toThrow();
    expect(() => decodeStoryboardsV1(source)).toThrow();
  });
});
