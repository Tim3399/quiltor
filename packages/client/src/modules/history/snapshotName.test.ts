import { describe, expect, it } from "vitest";
import { type Translate, translateUiMessage } from "../../i18n";
import type { SnapshotInfo } from "./model";
import { snapshotName } from "./snapshotName";

const de: Translate = (key, params) => translateUiMessage("de", key, params);
const at = (subject: string, kind?: SnapshotInfo["kind"]) =>
  ({
    hash: "h",
    shortHash: "h",
    date: "2026-10-28T12:20:00",
    subject,
    kind,
  }) satisfies SnapshotInfo;

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
});
