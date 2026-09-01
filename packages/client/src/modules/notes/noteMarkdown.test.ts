import { describe, expect, it } from "vitest";
import { noteMarkdown } from "./noteMarkdown";

describe("note Markdown", () => {
  it("keeps leading and trailing whitespace outside emphasis markers", () => {
    expect(noteMarkdown(" Mara ", [{ from: 0, to: 6, kind: "bold" }])).toBe(" **Mara** ");
  });

  it("matches the Python mirror for mixed emphasis around astral text", () => {
    const note = " 😀 Mara ";
    expect(
      noteMarkdown(note, [
        { from: 0, to: 9, kind: "bold" },
        { from: 1, to: 8, kind: "italic" },
      ]),
    ).toBe(" ***😀 Mara*** ");
  });

  it("renders adjacent same-style extension ranges as one effective format run", () => {
    expect(
      noteMarkdown("Mara", [
        { from: 0, to: 2, kind: "bold", extensionSource: "first" },
        { from: 2, to: 4, kind: "bold", extensionSource: "second" },
      ]),
    ).toBe("**Mara**");
  });
});
