import type { Manuscript } from "../../modules/manuscript";
import type { FigureState } from "../../modules/story-world";
import type { StoryboardState } from "../../modules/storyboard";
import type {
  DocumentsGateway,
  ManuscriptDocxPreset,
  ManuscriptDocxPreview,
  ManuscriptDocxWarningCode,
  ManuscriptExportPreset,
  ManuscriptExportPreview,
  ManuscriptExportWarningCode,
  ManuscriptGateway,
  StoryboardsGateway,
  StoryWorldGateway,
} from "../application";
import { ApplicationGatewayError } from "../application";
import { decodeManuscriptV1, encodeManuscriptV1 } from "../contracts/v1/manuscript";
import { decodeStoryboardsV1, encodeStoryboardsV1 } from "../contracts/v1/storyboards";
import { decodeStoryWorldV1, encodeStoryWorldV1 } from "../contracts/v1/storyWorld";
import { saveBlob } from "../fileSave";
import type { PlatformGateway } from "../PlatformGateway";
import { createDocumentTransport } from "./documentTransport";
import { currentMessages } from "./locale";
import {
  type HttpApplicationState,
  httpResponseError,
  readJson,
  withWorldBody,
  withWorldQuery,
} from "./request";

const DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const EPUB_MEDIA_TYPE = "application/epub+zip";
const EXPORT_WARNING_CODES = new Set<ManuscriptExportWarningCode>([
  "notes",
  "references",
  "folders",
  "excluded_chapters",
  "extensions",
]);
const PREVIEW_BASE_KEYS = [
  "preset",
  "revision",
  "sourceSha256",
  "fileName",
  "chapters",
  "counts",
  "warnings",
] as const;
const EPUB_LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function unicodeLength(value: string): number {
  return [...value].length;
}

function invalidDocumentResponse(): never {
  throw new ApplicationGatewayError(currentMessages().errorInvalidResponse, "invalid_response", {
    category: "invalid_response",
  });
}

function safeCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalidDocumentResponse();
  return Number(value);
}

function decodeManuscriptExportPreview(
  value: unknown,
  expectedPreset: ManuscriptExportPreset,
): ManuscriptExportPreview {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidDocumentResponse();
  const record = value as Record<string, unknown>;
  const expectedFileName =
    expectedPreset === "editor"
      ? "Quiltor-Manuskript.docx"
      : expectedPreset === "normseite"
        ? "Quiltor-Normseite.docx"
        : "Quiltor-Manuskript.epub";
  const expectedKeys =
    expectedPreset === "epub" ? [...PREVIEW_BASE_KEYS, "metadata"] : PREVIEW_BASE_KEYS;
  if (
    !hasExactKeys(record, expectedKeys) ||
    record.preset !== expectedPreset ||
    record.fileName !== expectedFileName ||
    !Number.isSafeInteger(record.revision) ||
    Number(record.revision) < 0 ||
    typeof record.sourceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.sourceSha256) ||
    !Array.isArray(record.chapters) ||
    record.chapters.length < 1 ||
    record.chapters.length > 10_000 ||
    !record.counts ||
    typeof record.counts !== "object" ||
    Array.isArray(record.counts) ||
    !Array.isArray(record.warnings) ||
    record.warnings.length > EXPORT_WARNING_CODES.size
  ) {
    invalidDocumentResponse();
  }
  const chapterIds = new Set<string>();
  const chapters = record.chapters.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalidDocumentResponse();
    const chapter = value as Record<string, unknown>;
    if (
      !hasExactKeys(chapter, ["id", "title", "words", "excerpt"]) ||
      typeof chapter.id !== "string" ||
      unicodeLength(chapter.id) < 1 ||
      unicodeLength(chapter.id) > 200 ||
      typeof chapter.title !== "string" ||
      unicodeLength(chapter.title) > 1000 ||
      typeof chapter.excerpt !== "string" ||
      unicodeLength(chapter.excerpt) > 280
    ) {
      invalidDocumentResponse();
    }
    if (chapterIds.has(chapter.id)) invalidDocumentResponse();
    chapterIds.add(chapter.id);
    return {
      id: chapter.id,
      title: chapter.title,
      words: safeCount(chapter.words),
      excerpt: chapter.excerpt,
    };
  });
  const countsRecord = record.counts as Record<string, unknown>;
  if (
    !hasExactKeys(countsRecord, [
      "manuscriptChapters",
      "manuscriptWords",
      "exportedChapters",
      "exportedWords",
    ])
  ) {
    invalidDocumentResponse();
  }
  const counts = {
    manuscriptChapters: safeCount(countsRecord.manuscriptChapters),
    manuscriptWords: safeCount(countsRecord.manuscriptWords),
    exportedChapters: safeCount(countsRecord.exportedChapters),
    exportedWords: safeCount(countsRecord.exportedWords),
  };
  let exportedWords = 0;
  for (const chapter of chapters) {
    if (exportedWords > Number.MAX_SAFE_INTEGER - chapter.words) invalidDocumentResponse();
    exportedWords += chapter.words;
  }
  if (
    counts.exportedChapters !== chapters.length ||
    counts.exportedWords !== exportedWords ||
    counts.manuscriptChapters < counts.exportedChapters ||
    counts.manuscriptWords < counts.exportedWords
  ) {
    invalidDocumentResponse();
  }
  const seenWarnings = new Set<ManuscriptExportWarningCode>();
  const warnings = record.warnings.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalidDocumentResponse();
    const warning = value as Record<string, unknown>;
    if (!hasExactKeys(warning, ["code", "count"])) invalidDocumentResponse();
    if (!EXPORT_WARNING_CODES.has(warning.code as ManuscriptExportWarningCode))
      invalidDocumentResponse();
    const code = warning.code as ManuscriptExportWarningCode;
    if (seenWarnings.has(code)) invalidDocumentResponse();
    seenWarnings.add(code);
    const count = safeCount(warning.count);
    if (count < 1) invalidDocumentResponse();
    return { code, count };
  });
  const base = {
    preset: expectedPreset,
    revision: Number(record.revision),
    sourceSha256: record.sourceSha256,
    fileName: expectedFileName,
    chapters,
    counts,
    warnings,
  };
  if (expectedPreset !== "epub") return base as ManuscriptDocxPreview;
  if (!record.metadata || typeof record.metadata !== "object" || Array.isArray(record.metadata)) {
    invalidDocumentResponse();
  }
  const metadata = record.metadata as Record<string, unknown>;
  if (
    !hasExactKeys(metadata, ["title", "author", "language"]) ||
    typeof metadata.title !== "string" ||
    !metadata.title.trim() ||
    unicodeLength(metadata.title) > 1000 ||
    metadata.title !== metadata.title.trim() ||
    typeof metadata.author !== "string" ||
    unicodeLength(metadata.author) > 1000 ||
    metadata.author !== metadata.author.trim() ||
    typeof metadata.language !== "string" ||
    unicodeLength(metadata.language) > 64 ||
    !EPUB_LANGUAGE.test(metadata.language)
  ) {
    invalidDocumentResponse();
  }
  return {
    ...base,
    preset: "epub",
    fileName: "Quiltor-Manuskript.epub",
    metadata: {
      title: metadata.title as string,
      author: metadata.author as string,
      language: metadata.language as string,
    },
  };
}

export function createManuscriptHttpGateway(state: HttpApplicationState): ManuscriptGateway {
  return createDocumentTransport<Manuscript>(state, {
    url: "/api/manuscript",
    kind: "manuscript",
    decode: decodeManuscriptV1,
    encode: encodeManuscriptV1,
  });
}

export function createStoryWorldHttpGateway(state: HttpApplicationState): StoryWorldGateway {
  return createDocumentTransport<FigureState>(state, {
    url: "/api/state",
    kind: "figures",
    decode: decodeStoryWorldV1,
    encode: encodeStoryWorldV1,
  });
}

export function createStoryboardsHttpGateway(state: HttpApplicationState): StoryboardsGateway {
  return createDocumentTransport<StoryboardState>(state, {
    url: "/api/storyboards",
    kind: "storyboards",
    decode: decodeStoryboardsV1,
    encode: encodeStoryboardsV1,
  });
}

export function createDocumentsHttpGateway(
  state: HttpApplicationState,
  platform: PlatformGateway,
): DocumentsGateway {
  const renderBookPdf = async (): Promise<Blob> => {
    const response = await fetch("/api/book.pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(withWorldBody(state, {})),
    });
    if (!response.ok) throw httpResponseError(response, await readJson(response));
    return response.blob();
  };

  const saveBookPdf = (blob: Blob): Promise<void> =>
    saveBlob(
      platform,
      `Quiltor-Buchfassung-${new Date().toISOString().slice(0, 10)}.pdf`,
      blob,
      currentMessages().exportFailed,
    );

  const previewManuscriptExport = async (preset: ManuscriptExportPreset) => {
    const response = await fetch(withWorldQuery(state, "/api/manuscript-export/preview"), {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset }),
    });
    const data = await readJson(response);
    if (!response.ok) throw httpResponseError(response, data);
    if (!data || typeof data !== "object" || Array.isArray(data)) invalidDocumentResponse();
    const record = data as Record<string, unknown>;
    if (!hasExactKeys(record, ["ok", "preview"]) || record.ok !== true) invalidDocumentResponse();
    return { ok: true as const, preview: decodeManuscriptExportPreview(record.preview, preset) };
  };

  const renderManuscriptExport = async (
    preview: ManuscriptExportPreview,
    acknowledgedWarnings: ManuscriptExportWarningCode[],
  ) => {
    const mediaType = preview.preset === "epub" ? EPUB_MEDIA_TYPE : DOCX_MEDIA_TYPE;
    const endpoint = preview.preset === "epub" ? "epub" : "docx";
    const response = await fetch(withWorldQuery(state, `/api/manuscript-export/${endpoint}`), {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: mediaType },
      body: JSON.stringify({
        preset: preview.preset,
        revision: preview.revision,
        sourceSha256: preview.sourceSha256,
        acknowledgedWarnings: [...acknowledgedWarnings],
      }),
    });
    if (!response.ok) throw httpResponseError(response, await readJson(response));
    if (response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== mediaType) {
      invalidDocumentResponse();
    }
    const blob = await response.blob();
    if (!blob.size) invalidDocumentResponse();
    return blob;
  };

  const saveManuscriptExport = async (
    blob: Blob,
    fileName: ManuscriptExportPreview["fileName"],
  ): Promise<"saved" | "cancelled"> => {
    const result = await platform.files.save(fileName, blob);
    if (result.status === "saved" || result.status === "cancelled") return result.status;
    throw new Error(result.error || currentMessages().exportFailed);
  };

  const previewManuscriptDocx = async (preset: ManuscriptDocxPreset) => {
    const result = await previewManuscriptExport(preset);
    return { ok: true as const, preview: result.preview as ManuscriptDocxPreview };
  };
  const renderManuscriptDocx = (
    preview: ManuscriptDocxPreview,
    acknowledgedWarnings: ManuscriptDocxWarningCode[],
  ) => renderManuscriptExport(preview, acknowledgedWarnings);
  const saveManuscriptDocx = (blob: Blob, fileName: ManuscriptDocxPreview["fileName"]) =>
    saveManuscriptExport(blob, fileName);

  return {
    renderBookPdf,
    saveBookPdf,
    bookPdf: async () => saveBookPdf(await renderBookPdf()),
    previewManuscriptExport,
    renderManuscriptExport,
    saveManuscriptExport,
    previewManuscriptDocx,
    renderManuscriptDocx,
    saveManuscriptDocx,
  };
}
