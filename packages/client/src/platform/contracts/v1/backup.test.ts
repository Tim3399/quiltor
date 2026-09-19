import { describe, expect, it } from "vitest";
import { decodeBackupStatusV1 } from "./backup";

const status = {
  ok: true as const,
  endpoint: "https://backup.example",
  changes: [],
  changeCount: 0,
  suggestedMessage: "Sichern",
  lastSuccessfulTransfer: null,
  transferredSnapshotId: null,
};

describe("backup status wire v1", () => {
  it("accepts null and confirmed remote transfer states", () => {
    expect(decodeBackupStatusV1(status)).toEqual(status);
    expect(
      decodeBackupStatusV1({
        ...status,
        lastSuccessfulTransfer: "2026-09-19T10:30:00Z",
        transferredSnapshotId: "snapshot-confirmed",
      }),
    ).toMatchObject({
      lastSuccessfulTransfer: "2026-09-19T10:30:00Z",
      transferredSnapshotId: "snapshot-confirmed",
    });
  });

  it("rejects incomplete or malformed confirmed transfer metadata", () => {
    for (const invalid of [
      { ...status, lastSuccessfulTransfer: "2026-09-19T10:30:00Z" },
      { ...status, lastSuccessfulTransfer: "yesterday", transferredSnapshotId: "snapshot" },
      { ...status, lastSuccessfulTransfer: "2026-09-19T10:30:00Z", transferredSnapshotId: "" },
    ]) {
      expect(() => decodeBackupStatusV1(invalid)).toThrow();
    }
  });
});
