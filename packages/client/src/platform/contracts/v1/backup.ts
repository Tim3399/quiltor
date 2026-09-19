import type { BackupStatus } from "../../../modules/backup";

export interface BackupStatusWireV1 {
  ok: true;
  endpoint?: string | null;
  changes: string[];
  changeCount: number;
  suggestedMessage: string;
  lastSuccessfulTransfer: string | null;
  transferredSnapshotId: string | null;
}

export function decodeBackupStatusV1(value: unknown): BackupStatus {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid backup status wire value");
  }
  const wire = value as Partial<BackupStatusWireV1>;
  if (
    wire.ok !== true ||
    (wire.endpoint !== undefined && wire.endpoint !== null && typeof wire.endpoint !== "string") ||
    !Array.isArray(wire.changes) ||
    !wire.changes.every((entry) => typeof entry === "string") ||
    typeof wire.changeCount !== "number" ||
    !Number.isSafeInteger(wire.changeCount) ||
    wire.changeCount < 0 ||
    typeof wire.suggestedMessage !== "string" ||
    (wire.lastSuccessfulTransfer !== null && typeof wire.lastSuccessfulTransfer !== "string") ||
    (wire.transferredSnapshotId !== null && typeof wire.transferredSnapshotId !== "string") ||
    (wire.lastSuccessfulTransfer === null) !== (wire.transferredSnapshotId === null) ||
    (typeof wire.lastSuccessfulTransfer === "string" &&
      (!wire.lastSuccessfulTransfer.endsWith("Z") ||
        Number.isNaN(Date.parse(wire.lastSuccessfulTransfer)))) ||
    (typeof wire.transferredSnapshotId === "string" && !wire.transferredSnapshotId)
  ) {
    throw new TypeError("Invalid backup status wire value");
  }
  return {
    ok: true,
    endpoint: wire.endpoint,
    changes: [...wire.changes],
    changeCount: wire.changeCount,
    suggestedMessage: wire.suggestedMessage,
    lastSuccessfulTransfer: wire.lastSuccessfulTransfer,
    transferredSnapshotId: wire.transferredSnapshotId,
  };
}
