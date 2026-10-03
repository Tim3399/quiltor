import type {
  ManuscriptImportChapter,
  ManuscriptImportFormat,
  ManuscriptImportGateway,
  ManuscriptImportMark,
  ManuscriptImportPreview,
  ManuscriptImportSelection,
  ManuscriptImportSource,
  ManuscriptImportWarningCode,
} from "../application";
import { ApplicationGatewayError, MANUSCRIPT_IMPORT_MAX_BYTES } from "../application";
import type { WorldInfoWireV1 } from "../contracts/v1/worlds";
import { decodeWorldInfoV1 } from "../contracts/v1/worlds";
import { currentMessages } from "./locale";
import { httpResponseError, readJson } from "./request";

const WARNING_CODES = new Set<ManuscriptImportWarningCode>([
  "images",
  "hyperlinks",
  "headers_footers",
  "footnotes_endnotes",
  "comments",
  "numbering",
  "fields",
  "formatting",
]);
const FORMATS = new Set<ManuscriptImportFormat>(["docx", "markdown", "txt"]);

function invalidResponse(): never {
  throw new ApplicationGatewayError(currentMessages().errorInvalidResponse, "invalid_response", {
    category: "invalid_response",
  });
}

function safeCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalidResponse();
  return Number(value);
}

function boundedTitle(value: unknown, max: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim() !== value ||
    [...value].length > max
  ) {
    invalidResponse();
  }
  return value;
}

function isUtf16Boundary(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return true;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}

function sourceIndexes(value: unknown): number[] {
  if (!Array.isArray(value) || !value.length) invalidResponse();
  const indexes = value.map((item) => safeCount(item));
  if (new Set(indexes).size !== indexes.length) invalidResponse();
  if (indexes.some((item, index) => index > 0 && item <= indexes[index - 1])) invalidResponse();
  return indexes;
}

function marks(value: unknown, text: string): ManuscriptImportMark[] {
  if (!Array.isArray(value)) invalidResponse();
  const previousEnd = new Map<"bold" | "italic", number>();
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) invalidResponse();
    const mark = item as Record<string, unknown>;
    const from = safeCount(mark.from);
    const to = safeCount(mark.to);
    if (
      to <= from ||
      to > text.length ||
      !isUtf16Boundary(text, from) ||
      !isUtf16Boundary(text, to) ||
      (mark.kind !== "bold" && mark.kind !== "italic")
    ) {
      invalidResponse();
    }
    const kind: "bold" | "italic" = mark.kind;
    if (from < (previousEnd.get(kind) ?? -1)) invalidResponse();
    previousEnd.set(kind, to);
    return { from, to, kind };
  });
}

function folderPath(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 8) invalidResponse();
  return value.map((item) => boundedTitle(item, 1000));
}

function chapter(value: unknown): ManuscriptImportChapter {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidResponse();
  const record = value as Record<string, unknown>;
  if (typeof record.body !== "string" || record.body.length > 10_000_000) invalidResponse();
  const body = record.body;
  return {
    sourceIndexes: sourceIndexes(record.sourceIndexes),
    title: boundedTitle(record.title, 1000),
    folderPath: folderPath(record.folderPath),
    body,
    marks: marks(record.marks, body),
  };
}

function formatMatchesFileName(format: ManuscriptImportFormat, fileName: string): boolean {
  const lower = fileName.toLocaleLowerCase("en-US");
  if (format === "docx") return lower.endsWith(".docx");
  if (format === "markdown") return lower.endsWith(".md") || lower.endsWith(".markdown");
  return lower.endsWith(".txt");
}

function decodePreview(value: unknown, expectedFileName: string): ManuscriptImportPreview {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidResponse();
  const record = value as Record<string, unknown>;
  if (
    !FORMATS.has(record.format as ManuscriptImportFormat) ||
    record.fileName !== expectedFileName ||
    typeof record.sourceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.sourceSha256) ||
    !Array.isArray(record.units) ||
    !record.units.length ||
    !Array.isArray(record.chapters) ||
    !record.chapters.length ||
    !record.counts ||
    typeof record.counts !== "object" ||
    Array.isArray(record.counts) ||
    !Array.isArray(record.warnings)
  ) {
    invalidResponse();
  }
  const format = record.format as ManuscriptImportFormat;
  if (!formatMatchesFileName(format, expectedFileName)) invalidResponse();
  const title = boundedTitle(record.title, 100);
  const units = record.units.map((value, expectedIndex) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalidResponse();
    const unit = value as Record<string, unknown>;
    const index = safeCount(unit.index);
    if (
      index !== expectedIndex ||
      typeof unit.text !== "string" ||
      unit.text.length > 10_000_000 ||
      typeof unit.isHeading !== "boolean"
    ) {
      invalidResponse();
    }
    return {
      index,
      text: unit.text,
      marks: marks(unit.marks, unit.text),
      isHeading: unit.isHeading,
    };
  });
  const chapters = record.chapters.map(chapter);
  const flattenedIndexes = chapters.flatMap((item) => item.sourceIndexes);
  if (
    flattenedIndexes.length !== units.length ||
    flattenedIndexes.some((item, index) => item !== index)
  ) {
    invalidResponse();
  }
  const warningCodes = new Set<ManuscriptImportWarningCode>();
  const warnings = record.warnings.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalidResponse();
    const warning = value as Record<string, unknown>;
    if (!WARNING_CODES.has(warning.code as ManuscriptImportWarningCode)) invalidResponse();
    const code = warning.code as ManuscriptImportWarningCode;
    if (warningCodes.has(code)) invalidResponse();
    warningCodes.add(code);
    const count = safeCount(warning.count);
    if (count < 1) invalidResponse();
    return { code, count };
  });
  const counts = record.counts as Record<string, unknown>;
  const sourceParagraphs = safeCount(counts.sourceParagraphs);
  if (sourceParagraphs !== units.length) invalidResponse();
  return {
    format,
    fileName: expectedFileName,
    sourceSha256: record.sourceSha256,
    title,
    units,
    chapters,
    counts: {
      sourceWords: safeCount(counts.sourceWords),
      sourceParagraphs,
      importedWords: safeCount(counts.importedWords),
      importedParagraphs: safeCount(counts.importedParagraphs),
    },
    warnings,
  };
}

function defaultRequestId(): string {
  const id = globalThis.crypto?.randomUUID?.();
  if (id) return id;
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (!bytes.some(Boolean)) {
    for (let index = 0; index < bytes.length; index++) bytes[index] = Math.random() * 256;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function base64(content: Blob): Promise<string> {
  const bytes = new Uint8Array(await content.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return globalThis.btoa(binary);
}

function selectionBody(selection: ManuscriptImportSelection | undefined) {
  return selection
    ? {
        title: selection.title,
        chapters: selection.chapters.map((item) => ({
          sourceIndexes: [...item.sourceIndexes],
          title: item.title,
          folderPath: [...item.folderPath],
        })),
      }
    : undefined;
}

async function post(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readJson(response);
  if (!response.ok) throw httpResponseError(response, data);
  return data;
}

function assertSource(source: ManuscriptImportSource) {
  if (
    source.size > MANUSCRIPT_IMPORT_MAX_BYTES ||
    source.content.size > MANUSCRIPT_IMPORT_MAX_BYTES
  ) {
    throw new ApplicationGatewayError(
      currentMessages().manuscriptImportTooLarge,
      "manuscript_import.limit_exceeded",
      { category: "invalid_request" },
    );
  }
}

export function createManuscriptImportHttpGateway(
  createRequestId: () => string = defaultRequestId,
): ManuscriptImportGateway {
  return {
    createRequestId,
    preview: async (source, selection) => {
      assertSource(source);
      const data = await post("/api/manuscript-import/v2/preview", {
        fileName: source.fileName,
        dataBase64: await base64(source.content),
        ...(selection ? { selection: selectionBody(selection) } : {}),
      });
      if (!data || typeof data !== "object" || Array.isArray(data)) invalidResponse();
      const record = data as Record<string, unknown>;
      if (record.ok !== true) invalidResponse();
      return { ok: true, preview: decodePreview(record.preview, source.fileName) };
    },
    importManuscript: async (request) => {
      assertSource(request.source);
      const data = await post("/api/manuscript-import/v2/import", {
        fileName: request.source.fileName,
        dataBase64: await base64(request.source.content),
        sourceSha256: request.sourceSha256,
        title: request.title,
        chapters: request.chapters.map((item) => ({
          sourceIndexes: [...item.sourceIndexes],
          title: item.title,
          folderPath: [...item.folderPath],
        })),
        acknowledgedWarnings: [...request.acknowledgedWarnings],
        requestId: request.requestId,
      });
      if (!data || typeof data !== "object" || Array.isArray(data)) invalidResponse();
      const record = data as Record<string, unknown>;
      if (record.ok !== true) invalidResponse();
      try {
        return { ok: true, world: decodeWorldInfoV1(record.world as WorldInfoWireV1) };
      } catch {
        invalidResponse();
      }
    },
  };
}
