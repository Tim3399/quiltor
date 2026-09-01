import { ChangeSet } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  mapNoteMarks,
  normalizeNoteMarks,
  toggleNoteHeading,
  toggleNoteInlineMark,
} from "./noteMarks";

describe("note marks", () => {
  it("keeps plain text separate while toggling inline formatting", () => {
    const bold = toggleNoteInlineMark("Mara kennt den Hafen", [], 0, 4, "bold");
    expect(bold).toEqual([{ from: 0, to: 4, kind: "bold" }]);
    expect(toggleNoteInlineMark("Mara kennt den Hafen", bold, 0, 4, "bold")).toEqual([]);
  });

  it("stores headings as canonical line ranges", () => {
    expect(toggleNoteHeading("Erster Plan\nZweiter Plan", [], 2, 18, 2)).toEqual([
      { from: 0, to: 11, kind: "heading", level: 2 },
      { from: 12, to: 24, kind: "heading", level: 2 },
    ]);
  });

  it("maps headings and inline marks through the same text transaction", () => {
    const text = "Plan\nMara";
    const marks = normalizeNoteMarks(text, [
      { from: 0, to: 4, kind: "heading", level: 1 },
      { from: 5, to: 9, kind: "italic" },
    ]);
    const changes = ChangeSet.of({ from: 0, insert: "Mein " }, text.length);
    expect(mapNoteMarks(marks, changes, "Mein Plan\nMara")).toEqual([
      { from: 0, to: 9, kind: "heading", level: 1 },
      { from: 10, to: 14, kind: "italic" },
    ]);
  });

  it("preserves forward-compatible mark extensions while normalizing, mapping and toggling", () => {
    const text = "Plan\nMara";
    const marks = normalizeNoteMarks(text, [
      { from: 0, to: 4, kind: "heading", level: 1, extensionSource: "import" },
      { from: 5, to: 9, kind: "bold", extensionColor: "blue" },
    ]);
    expect(marks).toEqual([
      { from: 0, to: 4, kind: "heading", level: 1, extensionSource: "import" },
      { from: 5, to: 9, kind: "bold", extensionColor: "blue" },
    ]);

    const changes = ChangeSet.of({ from: 0, insert: "Mein " }, text.length);
    expect(mapNoteMarks(marks, changes, "Mein Plan\nMara")).toEqual([
      { from: 0, to: 9, kind: "heading", level: 1, extensionSource: "import" },
      { from: 10, to: 14, kind: "bold", extensionColor: "blue" },
    ]);

    expect(
      toggleNoteInlineMark(
        "Mara",
        [{ from: 0, to: 4, kind: "bold", extensionColor: "blue" }],
        1,
        3,
        "bold",
      ),
    ).toEqual([
      { from: 0, to: 1, kind: "bold", extensionColor: "blue" },
      { from: 3, to: 4, kind: "bold", extensionColor: "blue" },
    ]);
    expect(toggleNoteHeading(text, marks, 0, 4, 2)).toEqual([
      { from: 0, to: 4, kind: "heading", level: 2, extensionSource: "import" },
      { from: 5, to: 9, kind: "bold", extensionColor: "blue" },
    ]);
  });
});
