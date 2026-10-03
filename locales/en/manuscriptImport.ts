export const manuscriptImport = {
  manuscriptImportButton: "Import manuscript",
  manuscriptImportTitle: "Import manuscript",
  manuscriptImportIntro:
    "Choose a DOCX, Markdown, or text manuscript. Quiltor checks its text, chapters, and formatting before creating a new project.",
  manuscriptImportFile: "Manuscript file",
  manuscriptImportFileHelp:
    "Supports .docx, .md, .markdown, and .txt up to 8 MiB. Text files may use UTF-8 or BOM-marked UTF-16.",
  manuscriptImportTooLarge: "The manuscript file is larger than 8 MiB.",
  manuscriptImportPreviewLoading: "Checking manuscript …",
  manuscriptImportPreviewTitle: "Reviewed import preview",
  manuscriptImportProjectTitle: "Project title",
  manuscriptImportCounts: "Text comparison",
  manuscriptImportCountsHelp:
    "Counts cover main-document text including chapter headings. Warned footnotes, comments, headers, and footers are excluded; edited headings can change the result.",
  manuscriptImportSourceWords: "Words in the source file",
  manuscriptImportImportedWords: "Words in the new project",
  manuscriptImportSourceParagraphs: "Paragraphs in the source file",
  manuscriptImportImportedParagraphs: "Paragraphs in the new project",
  manuscriptImportChapters: "Chapter preview",
  manuscriptImportChapterTitle: "Title of chapter {number}",
  manuscriptImportFolderPath: "Folder path for chapter {number}",
  manuscriptImportFolderPathHint:
    "Optional. Separate nested folders with slashes, for example Part 1/Journey. At most 8 folders.",
  manuscriptImportFolderPathInvalid:
    "Use at most 8 nonempty folder names of at most 1,000 characters each.",
  manuscriptImportMergePrevious: "Merge with previous chapter",
  manuscriptImportSplitChapter: "Split chapter {number}",
  manuscriptImportSplitBefore: "Split before paragraph {number}: {excerpt}",
  manuscriptImportEmptyUnit: "Empty paragraph",
  manuscriptImportNewChapterTitle: "New chapter {number}",
  manuscriptImportReviewChapter: "Review chapter text: {title}",
  manuscriptImportRefreshRequired:
    "The split, a title, or a folder path changed. Review the refreshed preview before importing.",
  manuscriptImportRefreshPreview: "Refresh preview",
  manuscriptImportWarnings: "Content that cannot be transferred completely",
  manuscriptImportWarningsIntro:
    "These contents will not be preserved completely. Confirm each category after reviewing it.",
  manuscriptImportWarningAcknowledge: "{label}: {count} detected and reviewed",
  manuscriptImportWarningImages: "Images",
  manuscriptImportWarningHyperlinks: "Hyperlinks",
  manuscriptImportWarningHeadersFooters: "Headers and footers",
  manuscriptImportWarningFootnotesEndnotes: "Footnotes and endnotes",
  manuscriptImportWarningComments: "Comments",
  manuscriptImportWarningNumbering: "Automatic numbering",
  manuscriptImportWarningFields: "Word fields",
  manuscriptImportWarningFormatting: "Other formatting",
  manuscriptImportWarningImagesHelp: "Images are omitted from the new project.",
  manuscriptImportWarningHyperlinksHelp:
    "Visible link text is retained; the link target is omitted.",
  manuscriptImportWarningHeadersFootersHelp: "Header and footer text is omitted.",
  manuscriptImportWarningFootnotesEndnotesHelp:
    "Footnotes and endnotes are omitted from the manuscript text.",
  manuscriptImportWarningCommentsHelp: "Word comments are omitted.",
  manuscriptImportWarningNumberingHelp:
    "Lists and automatic numbering are retained as text without automatic numbering.",
  manuscriptImportWarningFieldsHelp: "Only the stored visible text of Word fields is retained.",
  manuscriptImportWarningFormattingHelp:
    "Bold and italic are retained in chapter text. Formatting in chapter titles and other text styles are omitted.",
  manuscriptImportCreatesNew:
    "Import creates a new project. Existing projects and the source file remain unchanged.",
  manuscriptImportAction: "Import as new project",
  manuscriptImporting: "Creating new project …",
  manuscriptImportOpenAction: "Open imported project",
  manuscriptImportOpenFailed:
    "The project was created but could not be opened yet. Open the same project again; it will not be imported twice.",
  errorManuscriptImportInvalidFile:
    "The manuscript file is invalid, damaged, encrypted, or uses unsupported text encoding. No project was created.",
  errorManuscriptImportLimitExceeded:
    "The manuscript file exceeds the allowed size or contains too much data.",
  errorManuscriptImportUnsupportedContent:
    "The manuscript file contains a structure Quiltor cannot import safely. Simplify it and try again.",
  errorManuscriptImportInvalidSelection:
    "The selected chapter split or folder order is invalid. Chapters in the same folder must stay together; check paragraphs and folder paths.",
  errorManuscriptImportPreviewMismatch:
    "The file or preview changed. Review a fresh preview before importing.",
  errorManuscriptImportWarningsUnacknowledged:
    "Confirm every displayed limitation before importing.",
  errorManuscriptImportConflictingRequest:
    "This import attempt no longer matches the reviewed file. Choose the file again.",
  errorManuscriptImportPublicationFailed:
    "The new project could not be created completely. Existing projects remain unchanged; you can retry the import.",
} as const;
