import type { WorldInfo } from "../../modules/story-world";

export const MANUSCRIPT_IMPORT_MAX_BYTES = 8 * 1024 * 1024;

export type ManuscriptImportFormat = "docx" | "markdown" | "txt";

export type ManuscriptImportWarningCode =
  | "images"
  | "hyperlinks"
  | "headers_footers"
  | "footnotes_endnotes"
  | "comments"
  | "numbering"
  | "fields"
  | "formatting";

export interface ManuscriptImportMark {
  from: number;
  to: number;
  kind: "bold" | "italic";
}

export interface ManuscriptImportChapter {
  sourceIndexes: number[];
  title: string;
  folderPath: string[];
  body: string;
  marks: ManuscriptImportMark[];
}

export interface ManuscriptImportUnit {
  index: number;
  text: string;
  marks: ManuscriptImportMark[];
  isHeading: boolean;
}

export interface ManuscriptImportSelection {
  title: string;
  chapters: Array<{ sourceIndexes: number[]; title: string; folderPath: string[] }>;
}

export interface ManuscriptImportPreview {
  format: ManuscriptImportFormat;
  fileName: string;
  sourceSha256: string;
  title: string;
  units: ManuscriptImportUnit[];
  chapters: ManuscriptImportChapter[];
  counts: {
    sourceWords: number;
    sourceParagraphs: number;
    importedWords: number;
    importedParagraphs: number;
  };
  warnings: Array<{ code: ManuscriptImportWarningCode; count: number }>;
}

export interface ManuscriptImportSource {
  fileName: string;
  size: number;
  content: Blob;
}

export interface ManuscriptImportRequest extends ManuscriptImportSelection {
  source: ManuscriptImportSource;
  sourceSha256: string;
  acknowledgedWarnings: ManuscriptImportWarningCode[];
  requestId: string;
}

export interface ManuscriptImportGateway {
  createRequestId(): string;
  preview(
    source: ManuscriptImportSource,
    selection?: ManuscriptImportSelection,
  ): Promise<{ ok: true; preview: ManuscriptImportPreview }>;
  importManuscript(request: ManuscriptImportRequest): Promise<{ ok: true; world: WorldInfo }>;
}
