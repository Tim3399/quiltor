import { ChangeSet } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import type { TextMark } from "./model";
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

const bold = (from: number, to: number): TextMark => ({ from, to, kind: "bold" });
const italic = (from: number, to: number): TextMark => ({ from, to, kind: "italic" });

describe("Auszeichnungen als Bereiche", () => {
  it("fasst überlappende und angrenzende Bereiche derselben Art zusammen", () => {
    expect(normalizeMarks([bold(0, 4), bold(2, 9)])).toEqual([bold(0, 9)]);
    expect(normalizeMarks([bold(0, 4), bold(4, 9)])).toEqual([bold(0, 9)]);
    // Fett und kursiv sind verschiedene Arten -- die dürfen sich überlagern.
    expect(normalizeMarks([bold(0, 9), italic(2, 4)])).toEqual([bold(0, 9), italic(2, 4)]);
    expect(normalizeMarks([bold(3, 3), bold(-2, 2)])).toEqual([bold(0, 2)]);
    expect(normalizeMarks([bold(0, 99)], 10)).toEqual([bold(0, 10)]);
  });

  it("nimmt Fett wieder weg, wenn die Stelle schon fett ist", () => {
    expect(toggleMark([], 0, 5, "bold")).toEqual([bold(0, 5)]);
    expect(toggleMark([bold(0, 5)], 0, 5, "bold")).toEqual([]);
    // Mitten aus einem fetten Bereich heraus bleibt links und rechts fett stehen.
    expect(toggleMark([bold(0, 10)], 3, 6, "bold")).toEqual([bold(0, 3), bold(6, 10)]);
    // Nur teilweise fett heißt: die ganze Markierung wird fett, nicht doppelt fett.
    expect(toggleMark([bold(0, 4)], 0, 9, "bold")).toEqual([bold(0, 9)]);
    // Kursiv rührt Fett nicht an.
    expect(toggleMark([bold(0, 9)], 0, 4, "italic")).toEqual([italic(0, 4), bold(0, 9)]);
    expect(hasMark([bold(0, 4), bold(4, 9)], 2, 7, "bold")).toBe(true);
    expect(hasMark([bold(0, 4)], 2, 7, "bold")).toBe(false);
  });

  it("nimmt Auszeichnungen bei Textänderungen mit", () => {
    // Vor der Stelle getippt: die Auszeichnung wandert mit dem Text, statt liegenzubleiben.
    const inserted = ChangeSet.of({ from: 0, insert: "Es war einmal: " }, 10);
    expect(mapMarks([bold(0, 5)], inserted, 25)).toEqual([bold(15, 20)]);
    // Dahinter getippt: die Stelle bleibt, wo sie ist.
    expect(mapMarks([bold(0, 5)], ChangeSet.of({ from: 8, insert: "!" }, 10), 11)).toEqual([
      bold(0, 5),
    ]);
    // Ganz gelöschter Bereich verschwindet, statt als leerer Bereich zurückzubleiben.
    expect(mapMarks([bold(2, 6)], ChangeSet.of({ from: 1, to: 8 }, 10), 3)).toEqual([]);
  });

  it("trägt Auszeichnungen über eine Ersetzung außerhalb des Editors hinweg", () => {
    // Umbenennen einer Figur schreibt direkt in den Text (replaceEntityMentions).
    expect(marksAfterReplacement([bold(0, 4)], 0, 4, 6, 15)).toEqual([bold(0, 6)]);
    expect(marksAfterReplacement([bold(8, 12)], 0, 4, 6, 15)).toEqual([bold(10, 14)]);
  });

  it("schneidet den Text in Abschnitte gleicher Auszeichnung", () => {
    expect(markedSegments("Hallo Welt", 0, [bold(0, 5)])).toEqual([
      { text: "Hallo", bold: true, italic: false },
      { text: " Welt", bold: false, italic: false },
    ]);
    // Ein Absatz ist ein Ausschnitt des Kapitels, die Bereiche zählen ab Kapitelanfang.
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
    // Marker dürfen nicht an Leerraum kleben und keine Absatzgrenze überspannen.
    expect(markdownBody("Hallo Welt", [italic(5, 10)])).toBe("Hallo *Welt*");
    expect(markdownBody("Eins\n\nZwei", [italic(0, 10)])).toBe("*Eins*\n\n*Zwei*");
    expect(markdownBody("Hallo Welt", [])).toBe("Hallo Welt");
  });
});
