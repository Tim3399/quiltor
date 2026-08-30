import { describe, expect, it } from "vitest";
import { diffVersionText, type VersionDiffSegment } from "./versionDiff";

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

  it("renders an initial version as added and an unchanged version without false changes", () => {
    expect(diffVersionText("", "Erster Satz.")).toEqual([{ kind: "added", text: "Erster Satz." }]);
    expect(diffVersionText("Gleich.", "Gleich.")).toEqual([{ kind: "unchanged", text: "Gleich." }]);
  });

  it("handles a large pure deletion without allocating a quadratic matrix", () => {
    const previous = "Wort ".repeat(20_000);

    expect(diffVersionText(previous, "")).toEqual([{ kind: "removed", text: previous }]);
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
});
