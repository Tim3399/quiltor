import type { ApplicationErrorCategory } from "../../shared";
import { ApplicationGatewayError } from "../application";
import { currentMessages } from "./locale";

export type HttpApplicationState = {
  activeWorldId: string;
  selectionGeneration: number;
  revisions: { manuscript: number; figures: number; storyboards: number };
};

export function createHttpApplicationState(): HttpApplicationState {
  return {
    activeWorldId: "",
    selectionGeneration: 0,
    revisions: { manuscript: 0, figures: 0, storyboards: 0 },
  };
}

export type HttpWorldSelection = {
  worldId: string;
  generation: number;
};

export function selectWorld(state: HttpApplicationState, worldId: string): void {
  state.activeWorldId = worldId;
  state.selectionGeneration += 1;
  state.revisions = { manuscript: 0, figures: 0, storyboards: 0 };
}

export function currentWorldSelection(state: HttpApplicationState): HttpWorldSelection {
  return { worldId: state.activeWorldId, generation: state.selectionGeneration };
}

export function isCurrentWorldSelection(
  state: HttpApplicationState,
  selection: HttpWorldSelection,
): boolean {
  return (
    state.activeWorldId === selection.worldId && state.selectionGeneration === selection.generation
  );
}

export function withSelectedWorldQuery(selection: HttpWorldSelection, url: string): string {
  if (!selection.worldId) return url;
  return `${url}${url.includes("?") ? "&" : "?"}world=${encodeURIComponent(selection.worldId)}`;
}

export function withWorldQuery(state: HttpApplicationState, url: string): string {
  return withSelectedWorldQuery(currentWorldSelection(state), url);
}

export function withWorldBody<T extends object>(
  state: HttpApplicationState,
  data: T,
): T & { worldId?: string } {
  return state.activeWorldId ? { ...data, worldId: state.activeWorldId } : data;
}

export function applicationCodeForHttpStatus(
  status: number | null | undefined,
): ApplicationErrorCategory {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "invalid_request";
  if (status != null && status >= 500) return "unavailable";
  return "unknown";
}

type StructuredApplicationError = {
  code: string;
  params: Readonly<Record<string, unknown>>;
  retryable: boolean;
};

function localizedApplicationErrorMessage(category: ApplicationErrorCategory): string {
  const messages = currentMessages();
  const messageByCategory = {
    unauthorized: messages.errorUnauthorized,
    forbidden: messages.errorForbidden,
    not_found: messages.errorNotFound,
    conflict: messages.errorConflict,
    invalid_request: messages.errorInvalidRequest,
    invalid_response: messages.errorInvalidResponse,
    unavailable: messages.errorUnavailable,
    unknown: messages.errorUnknown,
  } satisfies Record<ApplicationErrorCategory, string>;
  return messageByCategory[category];
}

function localizedStructuredErrorMessage(code: string | undefined): string | undefined {
  const messages = currentMessages();
  if (code === "storage.read_only") return messages.errorStorageReadOnly;
  if (code === "cloud.quota_exceeded") return messages.cloudQuotaExceeded;
  if (code === "cloud.read_only") return messages.cloudReadOnly;
  if (code === "cloud.account_expired") return messages.cloudAccountExpired;
  if (code === "sync.recovery_required") return messages.cloudRecoveryRequired;
  if (code === "sync.conflict" || code === "sync.stale_comparison")
    return messages.cloudStaleComparison;
  if (code === "storage.full") return messages.errorStorageFull;
  if (code === "storage.locked") return messages.errorStorageLocked;
  if (code === "backup.preview_failed") return messages.errorBackupPreviewFailed;
  if (code === "project_transfer.invalid_archive")
    return messages.errorProjectTransferInvalidArchive;
  if (code === "project_transfer.unsupported_version")
    return messages.errorProjectTransferUnsupportedVersion;
  if (code === "project_transfer.limit_exceeded") return messages.errorProjectTransferLimitExceeded;
  if (code === "project_transfer.invalid_asset") return messages.errorProjectTransferInvalidAsset;
  if (code === "project_transfer.publication_failed")
    return messages.errorProjectTransferPublicationFailed;
  if (code === "place_map.image_rejected") return messages.placeMapImageRejected;
  if (code === "place_map.invalid_encoding") return messages.placeMapInvalidEncoding;
  if (code === "place_map.invalid_request") return messages.placeMapInvalidRequest;
  if (code === "manuscript_import.invalid_file") return messages.errorManuscriptImportInvalidFile;
  if (code === "manuscript_import.limit_exceeded")
    return messages.errorManuscriptImportLimitExceeded;
  if (code === "manuscript_import.unsupported_content")
    return messages.errorManuscriptImportUnsupportedContent;
  if (code === "manuscript_import.invalid_selection")
    return messages.errorManuscriptImportInvalidSelection;
  if (code === "manuscript_import.preview_mismatch")
    return messages.errorManuscriptImportPreviewMismatch;
  if (code === "manuscript_import.warnings_unacknowledged")
    return messages.errorManuscriptImportWarningsUnacknowledged;
  if (code === "manuscript_import.conflicting_request")
    return messages.errorManuscriptImportConflictingRequest;
  if (code === "manuscript_import.publication_failed")
    return messages.errorManuscriptImportPublicationFailed;
  return undefined;
}

function structuredApplicationError(value: unknown): StructuredApplicationError | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  const candidate = envelope.error;
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const record = candidate as Record<string, unknown>;
  if (
    typeof record.code !== "string" ||
    !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/.test(record.code)
  ) {
    return null;
  }
  const params = record.params;
  if (
    params !== undefined &&
    (params === null || typeof params !== "object" || Array.isArray(params))
  ) {
    return null;
  }
  if (record.retryable !== undefined && typeof record.retryable !== "boolean") return null;
  return {
    code: record.code,
    params: (params as Readonly<Record<string, unknown>> | undefined) ?? {},
    retryable: record.retryable === true,
  };
}

export function httpResponseError(response: Response, data: unknown): ApplicationGatewayError {
  const category = applicationCodeForHttpStatus(response.status);
  const structured = structuredApplicationError(data);
  return new ApplicationGatewayError(
    localizedStructuredErrorMessage(structured?.code) ?? localizedApplicationErrorMessage(category),
    structured?.code ?? category,
    {
      category,
      params: structured?.params,
      retryable: structured?.retryable ?? response.status >= 500,
    },
  );
}

export async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

/** Small shared HTTP boundary. Port-specific decoders remain with their owning adapter. */
export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await readJson(response);
  if (!response.ok) throw httpResponseError(response, data);
  return data as T;
}
