import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { foldName, nameDistance } from "./entityCompletion";

const fixture = JSON.parse(
  readFileSync(
    join(process.cwd(), "contracts/fixtures/story-world/entity-resolution.v2.json"),
    "utf8",
  ),
) as {
  fold: Array<{ input: string; expected: string }>;
  distance: Array<{ mention: string; candidate: string; budget: number; expected: number }>;
};

describe("entity resolution cross-language contract", () => {
  it("shares spelling folding and conservative typo vectors with Python", () => {
    for (const testCase of fixture.fold) {
      expect(foldName(testCase.input).trim().replace(/\s+/g, " ")).toBe(testCase.expected);
    }
    for (const testCase of fixture.distance) {
      expect(
        nameDistance(foldName(testCase.mention), foldName(testCase.candidate), testCase.budget),
      ).toBe(testCase.expected);
    }
  });
});
