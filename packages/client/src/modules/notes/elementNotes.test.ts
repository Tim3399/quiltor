import { describe, expect, it } from "vitest";
import {
  isChapterInTrash,
  resolveElementNote,
  titleHeadingLines,
  withChapterNote,
  withFigureNote,
} from "./elementNotes";

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

describe("titleHeadingLines (T-185)", () => {
  const heading = (text: string, to: number) => ({
    text,
    noteReferences: [],
    noteMarks: [{ from: 0, to, kind: "heading" as const, level: 1 as const }],
  });

  it("hides a first-line heading that equals the card title, and the empty line after it", () => {
    expect(titleHeadingLines(heading("Mara Venn\n\nSie sucht.", 9), "Mara Venn")).toBe(2);
    expect(titleHeadingLines(heading("Mara Venn\nSie sucht.", 9), "Mara Venn")).toBe(1);
    expect(titleHeadingLines(heading("Mara Venn", 9), "Mara Venn")).toBe(1);
  });

  it("ignores whitespace and letter case when it compares", () => {
    expect(titleHeadingLines(heading("MARA   venn \nText", 12), " Mara Venn")).toBe(1);
  });

  it("shows a heading that differs from the title", () => {
    expect(titleHeadingLines(heading("Mara\nText", 4), "Mara Venn")).toBe(0);
  });

  it("shows the same heading when it is not the first line", () => {
    const later = {
      text: "Vorspann\nMara Venn\nText",
      noteReferences: [],
      noteMarks: [{ from: 9, to: 18, kind: "heading" as const, level: 1 as const }],
    };
    expect(titleHeadingLines(later, "Mara Venn")).toBe(0);
  });

  it("shows a first line that is plain text, however alike the title", () => {
    expect(titleHeadingLines(note("Mara Venn\nText"), "Mara Venn")).toBe(0);
  });

  it("hides nothing for an empty title", () => {
    expect(titleHeadingLines(heading("\nText", 0), "")).toBe(0);
  });
});

describe("titleHeadingLines, partial heading (T-185)", () => {
  it("shows a first line whose heading covers only the end of it", () => {
    const partial = {
      text: "Mara Venn\nText",
      noteReferences: [],
      noteMarks: [{ from: 5, to: 9, kind: "heading" as const, level: 1 as const }],
    };
    expect(titleHeadingLines(partial, "Mara Venn")).toBe(0);
  });
});

describe("isChapterInTrash (F-177-10)", () => {
  const withTrash = { ...manuscript, trash: [{ chapter: { id: "alt" } }] };

  it("is true for a chapter that sits in the trash", () => {
    expect(isChapterInTrash({ kind: "chapter", id: "alt" }, withTrash)).toBe(true);
  });

  it("is false for a chapter in the book, a missing one and any other kind", () => {
    expect(isChapterInTrash({ kind: "chapter", id: "k1" }, withTrash)).toBe(false);
    expect(isChapterInTrash({ kind: "chapter", id: "gone" }, withTrash)).toBe(false);
    expect(isChapterInTrash({ kind: "entity", id: "alt" }, withTrash)).toBe(false);
    expect(isChapterInTrash({ kind: "chapter", id: "alt" }, manuscript)).toBe(false);
  });
});
