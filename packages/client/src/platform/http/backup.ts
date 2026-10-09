import {
  ApplicationGatewayError,
  type BackupGateway,
  type BackupLoginStart,
  type BackupLoginStatus,
} from "../application";
import type { BackupStatusWireV1 } from "../contracts/v1/backup";
import { decodeBackupStatusV1 } from "../contracts/v1/backup";
import { decodeManuscriptV1 } from "../contracts/v1/manuscript";
import { decodeStoryboardsV1 } from "../contracts/v1/storyboards";
import { decodeStoryWorldV1 } from "../contracts/v1/storyWorld";
import { currentMessages } from "./locale";
import {
  type HttpApplicationState,
  postJson,
  requestJson,
  withWorldBody,
  withWorldQuery,
} from "./request";

function backupStatus(value: unknown) {
  try {
    return decodeBackupStatusV1(value);
  } catch {
    throw new ApplicationGatewayError(currentMessages().errorInvalidResponse, "invalid_response");
  }
}

function snapshotResult(value: unknown) {
  const wire = value as {
    ok?: unknown;
    log?: unknown;
    status?: unknown;
    warnings?: unknown;
  };
  if (
    wire?.ok !== true ||
    !Array.isArray(wire.log) ||
    !wire.log.every((entry) => typeof entry === "string") ||
    (wire.warnings !== undefined &&
      (!Array.isArray(wire.warnings) ||
        wire.warnings.some((warning) => warning !== "backup.transfer_status_failed")))
  ) {
    throw new ApplicationGatewayError(currentMessages().errorInvalidResponse, "invalid_response");
  }
  return {
    ok: true as const,
    log: wire.log as string[],
    status: backupStatus(wire.status),
    ...(wire.warnings === undefined
      ? {}
      : { warnings: wire.warnings as Array<"backup.transfer_status_failed"> }),
  };
}

function storageLocation(value: unknown) {
  const wire = value as { ok?: unknown; storage?: Record<string, unknown> };
  const storage = wire?.storage;
  if (
    wire?.ok !== true ||
    !storage ||
    typeof storage.databasePath !== "string" ||
    typeof storage.backupDirectory !== "string" ||
    (storage.lastSuccessfulBackup !== null && typeof storage.lastSuccessfulBackup !== "string") ||
    storage.scope !== "application-host" ||
    storage.canOpenFolder !== false
  ) {
    throw new ApplicationGatewayError(currentMessages().errorInvalidResponse, "invalid_response");
  }
  return {
    ok: true as const,
    storage: {
      databasePath: storage.databasePath,
      backupDirectory: storage.backupDirectory,
      lastSuccessfulBackup: storage.lastSuccessfulBackup as string | null,
      scope: "application-host" as const,
      canOpenFolder: false as const,
    },
  };
}

function backupPreview(value: unknown) {
  try {
    const wire = value as { ok?: unknown; documents?: Record<string, unknown> };
    if (wire?.ok !== true || !wire.documents) throw new Error("invalid preview");
    return {
      ok: true as const,
      documents: {
        manuscript: decodeManuscriptV1(wire.documents.manuscript).document,
        figures: decodeStoryWorldV1(wire.documents.figures).document,
        storyboards: decodeStoryboardsV1(wire.documents.storyboards).document,
      },
    };
  } catch {
    throw new ApplicationGatewayError(currentMessages().errorInvalidResponse, "invalid_response");
  }
}

function restoreResult(value: unknown) {
  const wire = value as { ok?: unknown; warnings?: unknown };
  if (
    wire?.ok !== true ||
    (wire.warnings !== undefined &&
      (!Array.isArray(wire.warnings) ||
        wire.warnings.some((warning) => warning !== "backup.mirror_failed")))
  ) {
    throw new ApplicationGatewayError(currentMessages().errorInvalidResponse, "invalid_response");
  }
  return {
    ok: true as const,
    ...(wire.warnings === undefined
      ? {}
      : { warnings: wire.warnings as Array<"backup.mirror_failed"> }),
  };
}

export function createBackupHttpGateway(state: HttpApplicationState): BackupGateway {
  return {
    status: async () =>
      backupStatus(await requestJson<BackupStatusWireV1>(withWorldQuery(state, "/api/backup"))),
    saveSnapshot: async (message: string, upload: boolean) => {
      const wire = await postJson<unknown>(
        "/api/backup",
        withWorldBody(state, { message, push: upload }),
      );
      return snapshotResult(wire);
    },
    loginStatus: () => requestJson<BackupLoginStatus>(withWorldQuery(state, "/api/backup/login")),
    beginLogin: () => postJson<BackupLoginStart>(withWorldQuery(state, "/api/backup/login"), {}),
    signOut: () =>
      postJson<{ ok: true; signedIn: false }>(withWorldQuery(state, "/api/backup/logout"), {}),
    list: () =>
      requestJson<{
        ok: true;
        backups: Array<{ name: string; created: string; size: number }>;
      }>(withWorldQuery(state, "/api/backups")),
    location: async () =>
      storageLocation(await requestJson<unknown>(withWorldQuery(state, "/api/backups/location"))),
    preview: async (name: string) =>
      backupPreview(
        await requestJson<unknown>(
          withWorldQuery(state, `/api/backups/preview?name=${encodeURIComponent(name)}`),
        ),
      ),
    restore: async (name: string) =>
      restoreResult(
        await postJson<unknown>("/api/backups/restore", withWorldBody(state, { name })),
      ),
  };
}
