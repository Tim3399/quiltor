export const manuscriptExport = {
  manuscriptExportEditorAction: "DOCX for editing",
  manuscriptExportNormseiteAction: "DOCX as standard page",
  manuscriptExportTitle: "Review DOCX content",
  manuscriptExportPreviewLoading: "Reviewing the saved manuscript …",
  manuscriptExportRefreshPreview: "Reload preview",
  manuscriptExportContentPreview: "Content preview",
  manuscriptExportChapterPreview: "Exported chapter preview",
  manuscriptExportEditorDescription:
    "Editorial copy: A4, Times New Roman 12 pt, and 1.5 line spacing.",
  manuscriptExportNormseiteDescription:
    "Standard page: A4, Courier New 12 pt, target 30 lines × 60 characters, without hyphenation.",
  manuscriptExportScope:
    "Exports chapter titles, body text, bold, italic, and scene-separator text in book order. World data, history, notes, and book layout are excluded.",
  manuscriptExportPagination:
    "This previews content. Open the DOCX in a compatible program to see the final page layout and page numbers.",
  manuscriptExportNoExtras:
    "No title page or automatic chapter numbering is added. Existing author titles, including numbers, are preserved.",
  manuscriptExportManuscriptChapters: "Manuscript chapters",
  manuscriptExportExportedChapters: "Exported chapters",
  manuscriptExportManuscriptWords: "Manuscript words",
  manuscriptExportExportedWords: "Exported words",
  manuscriptExportCountsHelp: "Word counts cover chapter body text and exclude headings.",
  manuscriptExportChapterWords: "{count} words",
  manuscriptExportWarnings: "Review before download",
  manuscriptExportWarningsHelp:
    "These contents remain in the project but are not included in the DOCX file.",
  manuscriptExportWarningNotes: "Chapter notes not included",
  manuscriptExportWarningReferences: "References not included",
  manuscriptExportWarningFolders: "Folder headings not included",
  manuscriptExportWarningExcludedChapters: "Chapters excluded from the book",
  manuscriptExportWarningExtensions: "Additional data not included",
  manuscriptExportWarningCount: "{label}: {count}",
  manuscriptExportAcknowledge: "All displayed notices have been reviewed",
  manuscriptExportDownload: "Download DOCX",
  manuscriptExportRendering: "Creating DOCX …",
  manuscriptExportDownloaded: "The DOCX file was handed off for saving.",
  manuscriptExportPreviewFailed: "The content preview could not be loaded.",
  manuscriptExportRenderFailed: "The DOCX file could not be created.",
  manuscriptExportSaveFailed: "The DOCX file could not be saved.",
  errorManuscriptExportInvalidRequest: "The export request is invalid.",
  errorManuscriptExportEmptyBook: "The book view has no chapters to export.",
  errorManuscriptExportInvalidContent: "The manuscript has content that cannot be exported safely.",
  errorManuscriptExportLimitExceeded: "The manuscript is too large for this DOCX export.",
  errorManuscriptExportPreviewMismatch:
    "The manuscript changed after the preview. Load a fresh preview.",
  errorManuscriptExportWarningsUnacknowledged:
    "Review and acknowledge every displayed notice before downloading.",
} as const;
