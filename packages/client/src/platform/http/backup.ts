import type { BackupStatusWireV1 } from "../contracts/v1/backup";
import { decodeBackupStatusV1 } from "../contracts/v1/backup";
import {
  ApplicationGatewayError,
  type BackupGateway,
  type BackupLoginStart,
  type BackupLoginStatus,
} from "../application";
import { currentMessages } from "./locale";
import { requestJson, withWorldBody, withWorldQuery, type HttpApplicationState } from "./request";

function backupStatus(value: unknown) {
  try {
    return decodeBackupStatusV1(value);
  } catch {
    throw new ApplicationGatewayError(currentMessages().errorInvalidResponse, "invalid_response");
  }
}

export function createBackupHttpGateway(state: HttpApplicationState): BackupGateway {
  return {
    status: async () =>
      backupStatus(await requestJson<BackupStatusWireV1>(withWorldQuery(state, "/api/backup"))),
    saveSnapshot: async (message: string, upload: boolean) => {
      const wire = await requestJson<{
        ok: true;
        log: string[];
        status: BackupStatusWireV1;
      }>("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withWorldBody(state, { message, push: upload })),
      });
      return { ...wire, status: backupStatus(wire.status) };
    },
    loginStatus: () => requestJson<BackupLoginStatus>(withWorldQuery(state, "/api/backup/login")),
    beginLogin: () =>
      requestJson<BackupLoginStart>(withWorldQuery(state, "/api/backup/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    signOut: () =>
      requestJson<{ ok: true; signedIn: false }>(withWorldQuery(state, "/api/backup/logout"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    list: () =>
      requestJson<{
        ok: true;
        backups: Array<{ name: string; created: string; size: number }>;
      }>(withWorldQuery(state, "/api/backups")),
    restore: (name: string) =>
      requestJson<{ ok: true }>("/api/backups/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withWorldBody(state, { name })),
      }),
  };
}
