import {
  ApplicationGatewayError,
  type CloudSyncStatus,
  type SynchronizationGateway,
} from "../application";
import { decodeManuscriptV1 } from "../contracts/v1/manuscript";
import { decodeStoryWorldV1 } from "../contracts/v1/storyWorld";
import { decodeStoryboardsV1 } from "../contracts/v1/storyboards";
import { currentMessages } from "./locale";
import { type HttpApplicationState, requestJson, withWorldBody, withWorldQuery } from "./request";

function invalid(): never {
  throw new ApplicationGatewayError(currentMessages().errorInvalidResponse, "invalid_response");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

const digest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const date = (value: unknown) =>
  value === null ||
  (typeof value === "string" && /(?:Z|\+00:00)$/.test(value) && !Number.isNaN(Date.parse(value)));

export function decodeCloudSyncStatus(value: unknown): CloudSyncStatus {
  const wire = record(value);
  const remote = record(wire.remote);
  if (
    wire.ok !== true ||
    typeof wire.configured !== "boolean" ||
    typeof wire.endpoint !== "string" ||
    wire.mode !== "manual" ||
    !["unconfigured", "unlinked", "synced", "local-pending", "remote-pending", "conflict"].includes(
      String(wire.state),
    ) ||
    typeof wire.localFingerprint !== "string" ||
    (wire.configured && !digest(wire.localFingerprint)) ||
    (wire.baseGeneration !== null && !count(wire.baseGeneration)) ||
    !count(remote.generation) ||
    (remote.snapshotId !== null && !digest(remote.snapshotId)) ||
    !date(wire.lastSyncedAt) ||
    (remote.generation === 0) !== (remote.snapshotId === null) ||
    (!wire.configured && wire.state !== "unconfigured") ||
    (wire.configured && wire.state === "unconfigured")
  )
    invalid();
  if (wire.account !== undefined) {
    const account = record(wire.account);
    if (
      typeof account.accountId !== "string" ||
      !account.accountId ||
      !["read-write", "read-only"].includes(String(account.access)) ||
      !count(account.usedBytes) ||
      (account.limitBytes !== null && !count(account.limitBytes)) ||
      !date(account.deleteAfter)
    )
      invalid();
  }
  return wire as CloudSyncStatus;
}

export function createSynchronizationHttpGateway(
  state: HttpApplicationState,
): SynchronizationGateway {
  return {
    status: async () =>
      decodeCloudSyncStatus(await requestJson(withWorldQuery(state, "/api/sync"))),
    preview: async () => {
      const wire = record(await requestJson(withWorldQuery(state, "/api/sync/preview")));
      if (
        wire.ok !== true ||
        !count(wire.generation) ||
        wire.generation === 0 ||
        !digest(wire.snapshotId)
      )
        invalid();
      const documents = record(wire.documents);
      try {
        return {
          ok: true,
          generation: wire.generation,
          snapshotId: wire.snapshotId,
          documents: {
            manuscript: decodeManuscriptV1(documents.manuscript).document,
            figures: decodeStoryWorldV1(documents.figures).document,
            storyboards: decodeStoryboardsV1(documents.storyboards).document,
          },
        };
      } catch {
        return invalid();
      }
    },
    synchronize: async (request) => {
      const wire = record(
        await requestJson("/api/sync", {
          method: "POST",
          body: JSON.stringify(withWorldBody(state, request)),
        }),
      );
      if (
        wire.ok !== true ||
        typeof wire.reloadRequired !== "boolean" ||
        (wire.localSnapshotId !== undefined && !digest(wire.localSnapshotId)) ||
        (wire.warnings !== undefined &&
          (!Array.isArray(wire.warnings) ||
            wire.warnings.some((warning) => warning !== "sync.state_not_saved")))
      )
        invalid();
      return {
        ok: true,
        status: decodeCloudSyncStatus(wire.status),
        reloadRequired: wire.reloadRequired,
        ...(wire.localSnapshotId === undefined
          ? {}
          : { localSnapshotId: wire.localSnapshotId as string }),
        ...(wire.warnings === undefined
          ? {}
          : { warnings: wire.warnings as Array<"sync.state_not_saved"> }),
      };
    },
  };
}
