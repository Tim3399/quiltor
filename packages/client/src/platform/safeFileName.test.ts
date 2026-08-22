import { describe, expect, it } from "vitest";
import { safeFileName } from "./safeFileName";

describe("safeFileName", () => {
  it("keeps readable Unicode while replacing platform separators", () => {
    expect(safeFileName("Prolog / Rückkehr.md")).toBe("Prolog - Rückkehr.md");
    expect(safeFileName("Prolog\\Rückkehr.md")).toBe("Prolog - Rückkehr.md");
  });

  it.each(["CON", "prn", "AUX", "NUL", "COM1", "lpt9"])(
    "avoids the Windows device name %s",
    (name) => expect(safeFileName(`${name}.md`)).toBe(`${name}-Datei.md`),
  );

  it.each([
    ["COM1.extra.md", "COM1-Datei.extra.md"],
    ["NUL.backup.txt", "NUL-Datei.backup.txt"],
    ["COM¹.txt", "COM¹-Datei.txt"],
    ["LPT².log", "LPT²-Datei.log"],
    ["Kapitel. ", "Kapitel"],
  ])("normalizes Windows device and trailing-edge name %s", (name, expected) => {
    const result = safeFileName(name);
    expect(result).toBe(expected);
    expect(new TextEncoder().encode(result).byteLength).toBeLessThanOrEqual(255);
  });

  it("keeps the extension and a complete Unicode grapheme within 255 UTF-8 bytes", () => {
    const result = safeFileName(`${"Sehr lang 🧭 ".repeat(80)}Rückkehr.md`);
    expect(new TextEncoder().encode(result).byteLength).toBeLessThanOrEqual(255);
    expect(result.endsWith(".md")).toBe(true);
    expect(result).not.toContain("�");
  });

  it("provides a stable fallback for names made only from unsafe edges", () => {
    expect(safeFileName("... ")).toBe("Export");
  });
});
