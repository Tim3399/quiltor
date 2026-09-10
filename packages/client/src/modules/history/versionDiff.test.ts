import { describe, expect, it } from "vitest";
import {
  diffVersion,
  diffVersionText,
  type VersionDiffSegment,
  type VersionTextChange,
} from "./versionDiff";

function reconstructedPrevious(segments: VersionDiffSegment[]) {
  return segments
    .filter((segment) => segment.kind !== "added")
    .map((segment) => segment.text)
    .join("");
}

function reconstructedSelected(segments: VersionDiffSegment[]) {
  return segments
    .filter((segment) => segment.kind !== "removed")
    .map((segment) => segment.text)
    .join("");
}

describe("diffVersionText", () => {
  it("marks a replacement without losing the surrounding prose", () => {
    const segments = diffVersionText("Der alte Baum stand dort.", "Der junge Baum stand dort.");

    expect(segments).toEqual([
      { kind: "unchanged", text: "Der " },
      { kind: "removed", text: "alte" },
      { kind: "added", text: "junge" },
      { kind: "unchanged", text: " Baum stand dort." },
    ]);
  });

  it("preserves punctuation, whitespace and line breaks in both readings", () => {
    const previous = "Er ging.\n\nDann wartete er.";
    const selected = "Er lief!\n\nDann wartete er lange.";
    const segments = diffVersionText(previous, selected);

    expect(reconstructedPrevious(segments)).toBe(previous);
    expect(reconstructedSelected(segments)).toBe(selected);
    expect(segments.some((segment) => segment.kind === "removed")).toBe(true);
    expect(segments.some((segment) => segment.kind === "added")).toBe(true);
  });

  it.each([
    ["", ""],
    ["Äpfel — grün 🟢", "Äpfel: grün 🟩"],
    ["Cafe\u0301\t(alt)", "Café\n(neu)"],
    ["eins  zwei\r\n\r\ndrei", "null eins zwei\n\ndrei!"],
  ])("reconstructs both inputs exactly for %j and %j", (previous, selected) => {
    const segments = diffVersionText(previous, selected);

    expect(reconstructedPrevious(segments)).toBe(previous);
    expect(reconstructedSelected(segments)).toBe(selected);
  });

  it("reconstructs a deterministic sweep of mixed token edits", () => {
    let state = 0x5eed;
    const next = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state;
    };
    const pieces = ["Wort", " ", "—", "\n", "é", "e\u0301", "42", "🙂"];
    for (let example = 0; example < 200; example++) {
      const makeText = () =>
        Array.from({ length: next() % 24 }, () => pieces[next() % pieces.length]).join("");
      const previous = makeText();
      const selected = makeText();
      const segments = diffVersionText(previous, selected);

      expect(reconstructedPrevious(segments)).toBe(previous);
      expect(reconstructedSelected(segments)).toBe(selected);
    }
  });

  it("renders an initial version as added and an unchanged version without false changes", () => {
    expect(diffVersionText("", "Erster Satz.")).toEqual([{ kind: "added", text: "Erster Satz." }]);
    expect(diffVersionText("Gleich.", "Gleich.")).toEqual([{ kind: "unchanged", text: "Gleich." }]);
  });

  it("handles a large pure deletion without allocating a quadratic matrix", () => {
    const previous = "Wort ".repeat(20_000);

    expect(diffVersionText(previous, "")).toEqual([{ kind: "removed", text: previous }]);
  });

  it("keeps distant sparse edits local in a long chapter", () => {
    const words = Array.from({ length: 900 }, (_, index) => `wort${index}`);
    const changed = [...words];
    changed[100] = "anfang";
    changed[800] = "ende";
    const previous = words.join(" ");
    const selected = changed.join(" ");
    const segments = diffVersionText(previous, selected);

    expect(reconstructedPrevious(segments)).toBe(previous);
    expect(reconstructedSelected(segments)).toBe(selected);
    expect(
      segments.filter((segment) => segment.kind === "removed").map(({ text }) => text),
    ).toEqual(["wort100", "wort800"]);
    expect(segments.filter((segment) => segment.kind === "added").map(({ text }) => text)).toEqual([
      "anfang",
      "ende",
    ]);
    expect(
      segments.some((segment) => segment.kind === "unchanged" && segment.text.includes("wort450")),
    ).toBe(true);
  });

  it("keeps sparse edits around a huge repeated passage despite its long diagonal scan", () => {
    const previous = "Wort ".repeat(150_000);
    const selected = `${"Wort ".repeat(100)}Start ${"Wort ".repeat(149_799)}Ende ${"Wort ".repeat(99)}`;
    const segments = diffVersionText(previous, selected);

    expect(reconstructedPrevious(segments)).toBe(previous);
    expect(reconstructedSelected(segments)).toBe(selected);
    expect(
      segments.filter((segment) => segment.kind === "removed").map(({ text }) => text),
    ).toEqual(["Wort", "Wort"]);
    expect(segments.filter((segment) => segment.kind === "added").map(({ text }) => text)).toEqual([
      "Start",
      "Ende",
    ]);
    expect(
      segments
        .filter((segment) => segment.kind === "unchanged")
        .reduce((length, segment) => length + segment.text.length, 0),
    ).toBeGreaterThan(previous.length - 100);
  });

  it("keeps punctuation and paragraph edits inside their surrounding prose", () => {
    const previous = "Er blieb still.\n\nDer Regen fiel weiter.\n\nDann ging er heim.";
    const selected = "Er blieb still!\n\nDer Regen fiel weiter.\n\nDann lief er heim.";
    const segments = diffVersionText(previous, selected);

    expect(segments).toContainEqual({
      kind: "unchanged",
      text: "\n\nDer Regen fiel weiter.\n\nDann ",
    });
    expect(
      segments.filter((segment) => segment.kind !== "unchanged").map(({ text }) => text),
    ).toEqual([".", "!", "ging", "lief"]);
  });

  it("falls back to bounded blocks for a large rewrite while preserving both versions", () => {
    const previous = Array.from({ length: 800 }, (_, index) => `alt-${index}`).join(" ");
    const selected = Array.from({ length: 800 }, (_, index) => `neu-${index}`).join(" ");
    const segments = diffVersionText(previous, selected);

    expect(reconstructedPrevious(segments)).toBe(previous);
    expect(reconstructedSelected(segments)).toBe(selected);
    expect(segments.filter((segment) => segment.kind !== "unchanged")).toEqual([
      expect.objectContaining({ kind: "removed" }),
      expect.objectContaining({ kind: "added" }),
    ]);
    expect(segments.length).toBeLessThanOrEqual(3);
  });

  it("preserves a stable passage between two rewrites after the Myers budget is exhausted", () => {
    const oldStart = Array.from({ length: 400 }, (_, index) => `anfang-alt-${index}`).join(" ");
    const newStart = Array.from({ length: 400 }, (_, index) => `anfang-neu-${index}`).join(" ");
    const stable = Array.from({ length: 500 }, (_, index) => `mitte-${index}`).join(" ");
    const oldEnd = Array.from({ length: 400 }, (_, index) => `ende-alt-${index}`).join(" ");
    const newEnd = Array.from({ length: 400 }, (_, index) => `ende-neu-${index}`).join(" ");
    const previous = `${oldStart}\n\n${stable}\n\n${oldEnd}`;
    const selected = `${newStart}\n\n${stable}\n\n${newEnd}`;
    const segments = diffVersionText(previous, selected);

    expect(reconstructedPrevious(segments)).toBe(previous);
    expect(reconstructedSelected(segments)).toBe(selected);
    expect(
      segments.some(
        (segment) =>
          segment.kind === "unchanged" &&
          segment.text.includes("mitte-100") &&
          segment.text.includes("mitte-400"),
      ),
    ).toBe(true);
  });
});

function textChanges(projection: ReturnType<typeof diffVersion>): VersionTextChange[] {
  return projection.changes;
}

describe("diffVersion", () => {
  it("projects text changes and equal spans onto exact character offsets", () => {
    expect(diffVersion("Der alte Baum.", "Der junge Baum.")).toEqual({
      changes: [
        { kind: "removed", at: 4, text: "alte" },
        { kind: "added", from: 4, to: 9, text: "junge" },
      ],
      equalSpans: [
        { previousFrom: 0, previousTo: 4, selectedFrom: 0, selectedTo: 4 },
        { previousFrom: 8, previousTo: 14, selectedFrom: 9, selectedTo: 15 },
      ],
      formattingChanges: [],
    });
  });

  it("reports formatting added and removed on unchanged text", () => {
    const added = diffVersion("Ein Wort", "Ein Wort", [], [{ kind: "bold", from: 4, to: 8 }]);
    const removed = diffVersion("Ein Wort", "Ein Wort", [{ kind: "italic", from: 4, to: 8 }], []);

    expect(added.formattingChanges).toEqual([
      { kind: "format-added", markKind: "bold", from: 4, to: 8 },
    ]);
    expect(removed.formattingChanges).toEqual([
      { kind: "format-removed", markKind: "italic", from: 4, to: 8 },
    ]);
  });

  it("does not report formatting when marked text merely follows an insertion", () => {
    const projection = diffVersion(
      "Alter Text",
      "Neu Alter Text",
      [{ kind: "bold", from: 0, to: 5 }],
      [{ kind: "bold", from: 4, to: 9 }],
    );

    expect(textChanges(projection)).toEqual([{ kind: "added", from: 0, to: 4, text: "Neu " }]);
    expect(projection.formattingChanges).toEqual([]);
  });

  it("reports a mark change after an insertion without including the inserted text", () => {
    const projection = diffVersion(
      "Alter Text",
      "Neu Alter Text",
      [{ kind: "bold", from: 0, to: 5 }],
      [
        { kind: "bold", from: 4, to: 9 },
        { kind: "italic", from: 4, to: 9 },
      ],
    );

    expect(projection.formattingChanges).toEqual([
      { kind: "format-added", markKind: "italic", from: 4, to: 9 },
    ]);
  });

  it("limits formatting changes to the equal part of a rewritten marked range", () => {
    const projection = diffVersion(
      "Der alte Baum",
      "Der neue Baum",
      [{ kind: "bold", from: 4, to: 13 }],
      [],
    );

    expect(projection.formattingChanges).toEqual([
      { kind: "format-removed", markKind: "bold", from: 8, to: 13 },
    ]);
  });

  it("keeps overlapping bold and italic changes independent and normalized", () => {
    const projection = diffVersion(
      "Wortlaut",
      "Wortlaut",
      [
        { kind: "bold", from: -2, to: 8 },
        { kind: "italic", from: 2, to: 6 },
      ],
      [
        { kind: "bold", from: 2, to: 20 },
        { kind: "italic", from: 0, to: 4 },
      ],
    );

    expect(projection.formattingChanges).toEqual([
      { kind: "format-removed", markKind: "bold", from: 0, to: 2 },
      { kind: "format-added", markKind: "italic", from: 0, to: 2 },
      { kind: "format-removed", markKind: "italic", from: 4, to: 6 },
    ]);
  });

  it("handles many disjoint unchanged marks with a monotonic range sweep", () => {
    const text = "x ".repeat(5_000);
    const marks = Array.from({ length: 5_000 }, (_, index) => ({
      kind: "bold" as const,
      from: index * 2,
      to: index * 2 + 1,
    }));

    expect(diffVersion(text, text, marks, marks).formattingChanges).toEqual([]);
  });
});
