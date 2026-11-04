import { describe, expect, it } from "vitest";
import { type Translate, translateUiMessage } from "../../i18n";
import type { SnapshotInfo } from "./model";
import { localizedSummary, snapshotName } from "./snapshotName";

const de: Translate = (key, params) => translateUiMessage("de", key, params);
const en: Translate = (key, params) => translateUiMessage("en", key, params);
const at = (subject: string, kind?: string) =>
  ({
    hash: "h",
    shortHash: "h",
    date: "2026-10-28T12:20:00",
    subject,
    kind,
  }) as SnapshotInfo;

describe("snapshotName", () => {
  it("names the state held on to before a restore by its own wording and a German date", () => {
    expect(snapshotName(at("Before restore", "before-restore"), de, "de")).toBe(
      "Vor Wiederherstellung, 28.10.2026, 12:20",
    );
  });

  it("names an automatic snapshot and shows an author's name after its date", () => {
    expect(snapshotName(at("Writing backup 2026-10-28 12:20", "automatic"), de, "de")).toBe(
      "Automatische Sicherung, 28.10.2026, 12:20",
    );
    expect(snapshotName(at("Vor dem Umbau", "manual"), de, "de")).toBe(
      "28.10.2026, 12:20 · Vor dem Umbau",
    );
  });

  it("shows the server's change summaries in the reader's language", () => {
    expect(snapshotName(at('Chapter "Der Sturm" edited', "manual"), de, "de")).toBe(
      "28.10.2026, 12:20 · Kapitel „Der Sturm“ bearbeitet",
    );
  });
});

describe("localizedSummary", () => {
  it.each([
    ['Chapter "Der Sturm" edited', "Kapitel „Der Sturm“ bearbeitet"],
    ['Profile "Mara" edited', "Profil „Mara“ bearbeitet"],
    ["2 chapters edited", "2 Kapitel bearbeitet"],
    ["1 chapter, 1 profile edited", "1 Kapitel, 1 Profil bearbeitet"],
    ["3 chapters, 2 profiles edited", "3 Kapitel, 2 Profile bearbeitet"],
    ["2 profiles edited", "2 Profile bearbeitet"],
  ])("translates %s", (subject, german) => {
    expect(localizedSummary(subject, de)).toBe(german);
  });

  it("leaves an author's own words alone, even ones that look close", () => {
    for (const subject of ["edited", "Chapter one edited", "Kapitel 3 fertig", ""])
      expect(localizedSummary(subject, de)).toBe(subject);
  });

  it("writes the English summary in English typography", () => {
    expect(localizedSummary('Chapter "The Storm" edited', en)).toBe("Chapter “The Storm” edited");
  });
});
