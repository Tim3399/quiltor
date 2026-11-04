import { describe, expect, it } from "vitest";
import { type Translate, translateUiMessage } from "../../i18n";
import type { SnapshotKindWire } from "../../platform";
import type { SnapshotInfo } from "./model";
import { snapshotName } from "./snapshotName";

const t: Translate = (key, params) => translateUiMessage("de", key, params);

const snapshot = (kind: SnapshotKindWire | undefined, extra: Partial<SnapshotInfo> = {}) => ({
  hash: "h",
  shortHash: "h",
  date: "2026-10-28T12:20:28",
  subject: "English name the server stored",
  kind,
  ...extra,
});

describe("snapshotName", () => {
  const generated: [SnapshotKindWire, string][] = [
    ["automatic", "Automatische Sicherung, 28.10.2026, 12:20"],
    ["changes", "Sicherung nach Änderungen, 28.10.2026, 12:20"],
    ["before-restore", "Vor Wiederherstellung, 28.10.2026, 12:20"],
    ["cloud-sync", "Abgleich mit anderen Geräten, 28.10.2026, 12:20"],
    ["before-cloud-sync", "Vor dem Abgleich, 28.10.2026, 12:20"],
    ["cloud-sync-conflict", "Eigener Stand bei einem Abgleichskonflikt, 28.10.2026, 12:20"],
  ];

  it.each(generated)(
    "words the generated kind %s in German, never the stored name",
    (kind, name) => {
      const shown = snapshotName(snapshot(kind), t, "de");
      expect(shown).toBe(name);
      expect(shown).not.toContain("English");
    },
  );

  it("covers every kind the wire knows", () => {
    const every: Record<SnapshotKindWire, true> = {
      manual: true,
      automatic: true,
      changes: true,
      "before-restore": true,
      "cloud-sync": true,
      "before-cloud-sync": true,
      "cloud-sync-conflict": true,
    };
    const worded = new Set<string>([...generated.map(([kind]) => kind), "manual"]);
    expect(worded).toEqual(new Set(Object.keys(every)));
  });

  it("shows an author's name as written, after its date", () => {
    expect(snapshotName(snapshot("manual", { subject: "Vor dem Umbau" }), t, "de")).toBe(
      "28.10.2026, 12:20 · Vor dem Umbau",
    );
    expect(snapshotName(snapshot(undefined, { subject: "Vor dem Umbau" }), t, "de")).toBe(
      "28.10.2026, 12:20 · Vor dem Umbau",
    );
  });

  it("names the one chapter or profile a changes snapshot touched", () => {
    expect(
      snapshotName(
        snapshot("changes", { changes: { chapters: ["Der Hafen"], profiles: [] } }),
        t,
        "de",
      ),
    ).toBe("Kapitel „Der Hafen“ bearbeitet, 28.10.2026, 12:20");
    expect(
      snapshotName(
        snapshot("changes", { changes: { chapters: [], profiles: ["Mara Venn"] } }),
        t,
        "de",
      ),
    ).toBe("Profil „Mara Venn“ bearbeitet, 28.10.2026, 12:20");
  });

  it("counts chapters and profiles when a changes snapshot touched several", () => {
    const counted = (chapters: number, profiles: number) =>
      snapshotName(
        snapshot("changes", {
          changes: {
            chapters: Array.from({ length: chapters }, (_, index) => `K${index}`),
            profiles: Array.from({ length: profiles }, (_, index) => `P${index}`),
          },
        }),
        t,
        "de",
      );
    expect(counted(2, 1)).toBe("2 Kapitel, 1 Profil bearbeitet, 28.10.2026, 12:20");
    expect(counted(1, 3)).toBe("1 Kapitel, 3 Profile bearbeitet, 28.10.2026, 12:20");
    expect(counted(3, 0)).toBe("3 Kapitel bearbeitet, 28.10.2026, 12:20");
  });
});
