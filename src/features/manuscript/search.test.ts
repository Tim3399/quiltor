import { describe, expect, it } from "vitest";
import { manuscriptSearchMatches, textSearchRanges } from "./search";

describe("manuscript text search", () => {
  it("finds every literal occurrence without caring about case", () => {
    expect(textSearchRanges("Nebel, nebel. NEBEL", "nebel.")).toEqual([{ from: 7, to: 13 }]);
  });

  it("keeps document coordinates while collecting matches across chapters", () => {
    expect(
      manuscriptSearchMatches(
        [
          { id: "c1", title: "Eins", body: "Tor Tor", note: "" },
          { id: "c2", title: "Zwei", body: "Am Tor", note: "" },
        ],
        "Tor",
      ),
    ).toEqual([
      { chapterId: "c1", from: 0, to: 3 },
      { chapterId: "c1", from: 4, to: 7 },
      { chapterId: "c2", from: 3, to: 6 },
    ]);
  });
});
