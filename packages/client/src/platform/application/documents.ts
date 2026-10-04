export type ManuscriptDocxPreset = "editor" | "normseite";
export type ManuscriptExportPreset = ManuscriptDocxPreset | "epub";
export type ManuscriptExportWarningCode =
  | "notes"
  | "references"
  | "folders"
  | "excluded_chapters"
  | "extensions";
export type ManuscriptDocxWarningCode = ManuscriptExportWarningCode;

interface ManuscriptExportPreviewBase {
  revision: number;
  sourceSha256: string;
  chapters: Array<{ id: string; title: string; words: number; excerpt: string }>;
  counts: {
    manuscriptChapters: number;
    manuscriptWords: number;
    exportedChapters: number;
    exportedWords: number;
  };
  warnings: Array<{ code: ManuscriptExportWarningCode; count: number }>;
}

export interface ManuscriptDocxPreview extends ManuscriptExportPreviewBase {
  preset: ManuscriptDocxPreset;
  fileName: "Quiltor-Manuskript.docx" | "Quiltor-Normseite.docx";
}

export interface ManuscriptEpubPreview extends ManuscriptExportPreviewBase {
  preset: "epub";
  fileName: "Quiltor-Manuskript.epub";
  metadata: { title: string; author: string; language: string };
}

export type ManuscriptExportPreview = ManuscriptDocxPreview | ManuscriptEpubPreview;

export interface DocumentsGateway {
  renderBookPdf(): Promise<Blob>;
  saveBookPdf(blob: Blob): Promise<void>;
  /** Compatibility wrapper for callers that still render and save in one step. */
  bookPdf(): Promise<void>;
  previewManuscriptExport(
    preset: ManuscriptExportPreset,
  ): Promise<{ ok: true; preview: ManuscriptExportPreview }>;
  renderManuscriptExport(
    preview: ManuscriptExportPreview,
    acknowledgedWarnings: ManuscriptExportWarningCode[],
  ): Promise<Blob>;
  saveManuscriptExport(
    blob: Blob,
    fileName: ManuscriptExportPreview["fileName"],
  ): Promise<"saved" | "cancelled">;
  /** DOCX compatibility aliases retained for existing callers. */
  previewManuscriptDocx(
    preset: ManuscriptDocxPreset,
  ): Promise<{ ok: true; preview: ManuscriptDocxPreview }>;
  renderManuscriptDocx(
    preview: ManuscriptDocxPreview,
    acknowledgedWarnings: ManuscriptDocxWarningCode[],
  ): Promise<Blob>;
  saveManuscriptDocx(
    blob: Blob,
    fileName: ManuscriptDocxPreview["fileName"],
  ): Promise<"saved" | "cancelled">;
}
