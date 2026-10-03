export type ManuscriptDocxPreset = "editor" | "normseite";
export type ManuscriptDocxWarningCode =
  | "notes"
  | "references"
  | "folders"
  | "excluded_chapters"
  | "extensions";

export interface ManuscriptDocxPreview {
  preset: ManuscriptDocxPreset;
  revision: number;
  sourceSha256: string;
  fileName: "Quiltor-Manuskript.docx" | "Quiltor-Normseite.docx";
  chapters: Array<{ id: string; title: string; words: number; excerpt: string }>;
  counts: {
    manuscriptChapters: number;
    manuscriptWords: number;
    exportedChapters: number;
    exportedWords: number;
  };
  warnings: Array<{ code: ManuscriptDocxWarningCode; count: number }>;
}

export interface DocumentsGateway {
  renderBookPdf(): Promise<Blob>;
  saveBookPdf(blob: Blob): Promise<void>;
  /** Compatibility wrapper for callers that still render and save in one step. */
  bookPdf(): Promise<void>;
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
