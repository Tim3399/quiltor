import { describe, expect, it } from "vitest";
import { wordCount } from "./wordCount";

describe("wordCount", () => {
  it("counts words regardless of whitespace", () => {
    expect(wordCount("  Eins\n zwei   drei ")).toBe(3);
  });
  it("handles empty text correctly", () => {
    expect(wordCount("   ")).toBe(0);
  });
});
