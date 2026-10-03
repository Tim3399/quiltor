import type { Manuscript } from "../../modules/manuscript";
import type { FigureState } from "../../modules/story-world";
import type { StoryboardState } from "../../modules/storyboard";
import type {
  DocumentsGateway,
  ManuscriptDocxPreset,
  ManuscriptDocxPreview,
  ManuscriptDocxWarningCode,
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
const DOCX_WARNING_CODES = new Set<ManuscriptDocxWarningCode>([
  "notes",
  "references",
  "folders",
  "excluded_chapters",
  "extensions",
]);
const PREVIEW_KEYS = [
  "preset",
  "revision",
  "sourceSha256",
  "fileName",
  "chapters",
  "counts",
  "warnings",
] as const;

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

function decodeManuscriptDocxPreview(
  value: unknown,
  expectedPreset: ManuscriptDocxPreset,
): ManuscriptDocxPreview {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidDocumentResponse();
  const record = value as Record<string, unknown>;
  const expectedFileName =
    expectedPreset === "editor" ? "Quiltor-Manuskript.docx" : "Quiltor-Normseite.docx";
  if (
    !hasExactKeys(record, PREVIEW_KEYS) ||
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
    record.warnings.length > DOCX_WARNING_CODES.size
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
  const seenWarnings = new Set<ManuscriptDocxWarningCode>();
  const warnings = record.warnings.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalidDocumentResponse();
    const warning = value as Record<string, unknown>;
    if (!hasExactKeys(warning, ["code", "count"])) invalidDocumentResponse();
    if (!DOCX_WARNING_CODES.has(warning.code as ManuscriptDocxWarningCode))
      invalidDocumentResponse();
    const code = warning.code as ManuscriptDocxWarningCode;
    if (seenWarnings.has(code)) invalidDocumentResponse();
    seenWarnings.add(code);
    const count = safeCount(warning.count);
    if (count < 1) invalidDocumentResponse();
    return { code, count };
  });
  return {
    preset: expectedPreset,
    revision: Number(record.revision),
    sourceSha256: record.sourceSha256,
    fileName: expectedFileName,
    chapters,
    counts,
    warnings,
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

  const previewManuscriptDocx = async (preset: ManuscriptDocxPreset) => {
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
    return { ok: true as const, preview: decodeManuscriptDocxPreview(record.preview, preset) };
  };

  const renderManuscriptDocx = async (
    preview: ManuscriptDocxPreview,
    acknowledgedWarnings: ManuscriptDocxWarningCode[],
  ) => {
    const response = await fetch(withWorldQuery(state, "/api/manuscript-export/docx"), {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: DOCX_MEDIA_TYPE },
      body: JSON.stringify({
        preset: preview.preset,
        revision: preview.revision,
        sourceSha256: preview.sourceSha256,
        acknowledgedWarnings: [...acknowledgedWarnings],
      }),
    });
    if (!response.ok) throw httpResponseError(response, await readJson(response));
    if (
      response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !==
      DOCX_MEDIA_TYPE
    ) {
      invalidDocumentResponse();
    }
    const blob = await response.blob();
    if (!blob.size) invalidDocumentResponse();
    return blob;
  };

  const saveManuscriptDocx = async (
    blob: Blob,
    fileName: ManuscriptDocxPreview["fileName"],
  ): Promise<"saved" | "cancelled"> => {
    const result = await platform.files.save(fileName, blob);
    if (result.status === "saved" || result.status === "cancelled") return result.status;
    throw new Error(result.error || currentMessages().exportFailed);
  };

  return {
    renderBookPdf,
    saveBookPdf,
    bookPdf: async () => saveBookPdf(await renderBookPdf()),
    previewManuscriptDocx,
    renderManuscriptDocx,
    saveManuscriptDocx,
  };
}
