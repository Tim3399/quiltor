import { describe, expect, it } from "vitest";
import manifest from "../../../../../../contracts/manifest.json";
import fixture from "../../../../../../contracts/fixtures/application-api/story-world/wire.v1.json";
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
});
