import { ChangeSet } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  bodyParagraphs,
  hasMark,
  mapMarks,
  markdownBody,
  markedSegments,
  marksAfterReplacement,
  normalizeMarks,
  toggleMark,
} from "./marks";
import type { TextMark } from "./model";

const bold = (from: number, to: number): TextMark => ({ from, to, kind: "bold" });
const italic = (from: number, to: number): TextMark => ({ from, to, kind: "italic" });

describe("Auszeichnungen als Bereiche", () => {
  it("fasst überlappende und angrenzende Bereiche derselben Art zusammen", () => {
    expect(normalizeMarks([bold(0, 4), bold(2, 9)])).toEqual([bold(0, 9)]);
    expect(normalizeMarks([bold(0, 4), bold(4, 9)])).toEqual([bold(0, 9)]);
    // Bold and italic are different kinds -- those are allowed to overlap.
    expect(normalizeMarks([bold(0, 9), italic(2, 4)])).toEqual([bold(0, 9), italic(2, 4)]);
    expect(normalizeMarks([bold(3, 3), bold(-2, 2)])).toEqual([bold(0, 2)]);
    expect(normalizeMarks([bold(0, 99)], 10)).toEqual([bold(0, 10)]);
  });

  it("nimmt Fett wieder weg, wenn die Stelle schon fett ist", () => {
    expect(toggleMark([], 0, 5, "bold")).toEqual([bold(0, 5)]);
    expect(toggleMark([bold(0, 5)], 0, 5, "bold")).toEqual([]);
    // Taken out of the middle of a bold range, bold remains to its left and right.
    expect(toggleMark([bold(0, 10)], 3, 6, "bold")).toEqual([bold(0, 3), bold(6, 10)]);
    // Partly bold means: the whole selection becomes bold, not doubly bold.
    expect(toggleMark([bold(0, 4)], 0, 9, "bold")).toEqual([bold(0, 9)]);
    // Italic does not touch bold.
    expect(toggleMark([bold(0, 9)], 0, 4, "italic")).toEqual([italic(0, 4), bold(0, 9)]);
    expect(hasMark([bold(0, 4), bold(4, 9)], 2, 7, "bold")).toBe(true);
    expect(hasMark([bold(0, 4)], 2, 7, "bold")).toBe(false);
  });

  it("nimmt Auszeichnungen bei Textänderungen mit", () => {
    // Typed before the spot: the mark travels with the text rather than staying put.
    const inserted = ChangeSet.of({ from: 0, insert: "Es war einmal: " }, 10);
    expect(mapMarks([bold(0, 5)], inserted, 25)).toEqual([bold(15, 20)]);
    // Typed after it: the spot stays where it is.
    expect(mapMarks([bold(0, 5)], ChangeSet.of({ from: 8, insert: "!" }, 10), 11)).toEqual([
      bold(0, 5),
    ]);
    // A range deleted entirely disappears rather than staying behind as an empty one.
    expect(mapMarks([bold(2, 6)], ChangeSet.of({ from: 1, to: 8 }, 10), 3)).toEqual([]);
  });

  it("trägt Auszeichnungen über eine Ersetzung außerhalb des Editors hinweg", () => {
    // Renaming a figure writes straight into the text (replaceEntityMentions).
    expect(marksAfterReplacement([bold(0, 4)], 0, 4, 6, 15)).toEqual([bold(0, 6)]);
    expect(marksAfterReplacement([bold(8, 12)], 0, 4, 6, 15)).toEqual([bold(10, 14)]);
  });

  it("schneidet den Text in Abschnitte gleicher Auszeichnung", () => {
    expect(markedSegments("Hallo Welt", 0, [bold(0, 5)])).toEqual([
      { text: "Hallo", bold: true, italic: false },
      { text: " Welt", bold: false, italic: false },
    ]);
    // A paragraph is a section of the chapter; the ranges count from its start.
    expect(markedSegments("Welt", 6, [bold(6, 10)])).toEqual([
      { text: "Welt", bold: true, italic: false },
    ]);
    expect(markedSegments("Hallo", 0, [bold(0, 5), italic(0, 5)])).toEqual([
      { text: "Hallo", bold: true, italic: true },
    ]);
  });

  it("kennt die Absätze der Buchfassung samt ihrer Position im Kapitel", () => {
    expect(bodyParagraphs("\n\nEins\n\nZwei\nnoch Zwei\n")).toEqual([
      { text: "Eins", from: 2 },
      { text: "Zwei\nnoch Zwei", from: 8 },
    ]);
  });

  it("schreibt beim Export Markdown-Marker, im Kapiteltext aber nie", () => {
    expect(markdownBody("Hallo Welt", [bold(0, 5)])).toBe("**Hallo** Welt");
    expect(markdownBody("Hallo Welt", [italic(6, 10)])).toBe("Hallo *Welt*");
    expect(markdownBody("Hallo Welt", [bold(0, 10), italic(0, 10)])).toBe("***Hallo Welt***");
    // Markers must not cling to whitespace, nor span a paragraph boundary.
    expect(markdownBody("Hallo Welt", [italic(5, 10)])).toBe("Hallo *Welt*");
    expect(markdownBody("Eins\n\nZwei", [italic(0, 10)])).toBe("*Eins*\n\n*Zwei*");
    expect(markdownBody("Hallo Welt", [])).toBe("Hallo Welt");
  });
});
