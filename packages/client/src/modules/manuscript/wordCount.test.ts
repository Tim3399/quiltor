import { describe, expect, it } from "vitest";
import { wordCount } from "./wordCount";

describe("wordCount", () => {
  it("zählt Wörter unabhängig von Leerraum", () => {
    expect(wordCount("  Eins\n zwei   drei ")).toBe(3);
  });
  it("behandelt leeren Text korrekt", () => {
    expect(wordCount("   ")).toBe(0);
  });
});
