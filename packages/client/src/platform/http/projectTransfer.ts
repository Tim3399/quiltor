import type {
  ProjectTransferCounts,
  ProjectTransferGateway,
  ProjectTransferPreview,
} from "../application";
import { ApplicationGatewayError } from "../application";
import type { WorldInfoWireV1 } from "../contracts/v1/worlds";
import { decodeWorldInfoV1 } from "../contracts/v1/worlds";
import { currentMessages } from "./locale";
import { httpResponseError, readJson } from "./request";

const ARCHIVE_MEDIA_TYPE = "application/zip";

function invalidPreview(): never {
  throw new ApplicationGatewayError(currentMessages().errorInvalidResponse, "invalid_response", {
    category: "invalid_response",
  });
}

function count(record: Record<string, unknown>, key: keyof ProjectTransferCounts): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalidPreview();
  return Number(value);
}

function decodePreview(value: unknown): ProjectTransferPreview {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidPreview();
  const record = value as Record<string, unknown>;
  const counts = record.counts;
  const includes = record.includes;
  if (
    typeof record.title !== "string" ||
    !counts ||
    typeof counts !== "object" ||
    Array.isArray(counts) ||
    !includes ||
    typeof includes !== "object" ||
    Array.isArray(includes) ||
    (includes as Record<string, unknown>).trash !== true ||
    (includes as Record<string, unknown>).history !== false
  ) {
    invalidPreview();
  }
  const countRecord = counts as Record<string, unknown>;
  return {
    title: record.title,
    counts: {
      chapters: count(countRecord, "chapters"),
      bookChapters: count(countRecord, "bookChapters"),
      setAsideChapters: count(countRecord, "setAsideChapters"),
      trashedChapters: count(countRecord, "trashedChapters"),
      figures: count(countRecord, "figures"),
      storyboards: count(countRecord, "storyboards"),
      images: count(countRecord, "images"),
    },
    includes: { trash: true, history: false },
  };
}

async function upload(url: string, archive: Blob) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: archive,
  });
  const data = await readJson(response);
  if (!response.ok) throw httpResponseError(response, data);
  return data;
}

export function createProjectTransferHttpGateway(): ProjectTransferGateway {
  return {
    exportProject: async (worldId) => {
      const response = await fetch(
        `/api/project-transfer/export?world=${encodeURIComponent(worldId)}`,
        { cache: "no-store", headers: { Accept: ARCHIVE_MEDIA_TYPE } },
      );
      if (!response.ok) throw httpResponseError(response, await readJson(response));
      return response.blob();
    },
    preview: async (archive) => {
      const data = await upload("/api/project-transfer/preview", archive);
      if (!data || typeof data !== "object" || Array.isArray(data)) invalidPreview();
      const record = data as Record<string, unknown>;
      if (record.ok !== true) invalidPreview();
      return { ok: true, preview: decodePreview(record.preview) };
    },
    importProject: async (archive) => {
      const data = await upload("/api/project-transfer/import", archive);
      if (!data || typeof data !== "object" || Array.isArray(data)) invalidPreview();
      const record = data as Record<string, unknown>;
      if (record.ok !== true) invalidPreview();
      try {
        return { ok: true, world: decodeWorldInfoV1(record.world as WorldInfoWireV1) };
      } catch {
        invalidPreview();
      }
    },
  };
}
