import { describe, expect, it } from "vitest";
import { resolveElementNote, withChapterNote, withFigureNote } from "./elementNotes";

const mark = { from: 0, to: 4, kind: "bold" as const };
const manuscript = {
  chapters: [{ id: "k1", title: "Eins", body: "", note: "Hafen", noteMarks: [mark] }],
};
const figures = {
  nodes: [
    { id: "mira", name: "Mira", profile: { notes: "Kennt das Archiv." } },
    { id: "hafen", name: "Hafen", type: "ort" },
  ],
  timeline: [{ id: "t1", title: "Ankunft", note: "Nebel." }],
};
const note = (text: string) => ({ text, noteReferences: [], noteMarks: [] });

describe("resolveElementNote (T-177)", () => {
  it("reads the note of a chapter, figure, place and moment", () => {
    expect(resolveElementNote({ kind: "chapter", id: "k1" }, manuscript, figures)).toEqual({
      text: "Hafen",
      noteReferences: [],
      noteMarks: [mark],
    });
    expect(resolveElementNote({ kind: "entity", id: "mira" }, manuscript, figures)?.text).toBe(
      "Kennt das Archiv.",
    );
    expect(resolveElementNote({ kind: "place", id: "hafen" }, manuscript, figures)).toEqual(
      note(""),
    );
    expect(resolveElementNote({ kind: "timeline", id: "t1" }, manuscript, figures)?.text).toBe(
      "Nebel.",
    );
  });

  it("answers null for an element that is gone", () => {
    for (const target of [
      { kind: "chapter", id: "gone" },
      { kind: "entity", id: "gone" },
      { kind: "place", id: "gone" },
      { kind: "timeline", id: "gone" },
    ] as const) {
      expect(resolveElementNote(target, manuscript, figures), target.kind).toBeNull();
    }
  });
});

describe("writing an element note (T-177)", () => {
  it("replaces a chapter's note and leaves the rest of the manuscript as it was", () => {
    const next = withChapterNote(manuscript, "k1", note("Neu"));
    expect(next?.chapters[0]).toEqual({
      id: "k1",
      title: "Eins",
      body: "",
      note: "Neu",
      noteReferences: [],
      noteMarks: [],
    });
    expect(manuscript.chapters[0].note).toBe("Hafen");
    expect(withChapterNote(manuscript, "gone", note("x"))).toBeNull();
  });

  it("writes a place into its figure's profile and a moment into the timeline", () => {
    const place = withFigureNote(figures, { kind: "place", id: "hafen" }, note("Ort"));
    expect(place?.nodes[1]).toMatchObject({ type: "ort", profile: { notes: "Ort" } });
    const moment = withFigureNote(figures, { kind: "timeline", id: "t1" }, note("Zeit"));
    expect(moment?.timeline[0].note).toBe("Zeit");
    expect(moment?.nodes).toBe(figures.nodes);
    expect(withFigureNote(figures, { kind: "entity", id: "gone" }, note("x"))).toBeNull();
  });
});
