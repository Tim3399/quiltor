export const manuscriptImport = {
  manuscriptImportButton: "Manuskript importieren",
  manuscriptImportTitle: "Manuskript importieren",
  manuscriptImportIntro:
    "Wähle ein DOCX-, Markdown- oder Textmanuskript. Quiltor prüft Text, Kapitel und Formatierungen, bevor ein neues Projekt erstellt wird.",
  manuscriptImportFile: "Manuskriptdatei",
  manuscriptImportFileHelp:
    "Unterstützt werden .docx, .md, .markdown und .txt bis 8 MiB. Textdateien dürfen UTF-8 oder UTF-16 mit BOM verwenden.",
  manuscriptImportTooLarge: "Die Manuskriptdatei ist größer als 8 MiB.",
  manuscriptImportPreviewLoading: "Manuskript wird geprüft …",
  manuscriptImportPreviewTitle: "Geprüfte Importvorschau",
  manuscriptImportProjectTitle: "Projekttitel",
  manuscriptImportCounts: "Textvergleich",
  manuscriptImportCountsHelp:
    "Gezählt wird der Text im Hauptdokument einschließlich Kapitelüberschriften. Gewarnte Fußnoten, Kommentare sowie Kopf- und Fußzeilen sind nicht enthalten; geänderte Überschriften können das Ergebnis verändern.",
  manuscriptImportSourceWords: "Wörter in der Quelldatei",
  manuscriptImportImportedWords: "Wörter im neuen Projekt",
  manuscriptImportSourceParagraphs: "Absätze in der Quelldatei",
  manuscriptImportImportedParagraphs: "Absätze im neuen Projekt",
  manuscriptImportChapters: "Kapitelvorschau",
  manuscriptImportChapterTitle: "Titel von Kapitel {number}",
  manuscriptImportFolderPath: "Ordnerpfad für Kapitel {number}",
  manuscriptImportFolderPathHint:
    "Optional. Verschachtelte Ordner mit Schrägstrichen trennen, zum Beispiel Teil 1/Reise. Höchstens 8 Ordner.",
  manuscriptImportFolderPathInvalid:
    "Verwende höchstens 8 nicht leere Ordnernamen mit jeweils höchstens 1000 Zeichen.",
  manuscriptImportMergePrevious: "Mit vorherigem Kapitel zusammenführen",
  manuscriptImportSplitChapter: "Kapitel {number} teilen",
  manuscriptImportSplitBefore: "Vor Absatz {number} teilen: {excerpt}",
  manuscriptImportEmptyUnit: "Leerer Absatz",
  manuscriptImportNewChapterTitle: "Neues Kapitel {number}",
  manuscriptImportReviewChapter: "Kapiteltext prüfen: {title}",
  manuscriptImportRefreshRequired:
    "Die Aufteilung, ein Titel oder ein Ordnerpfad wurde geändert. Prüfe die aktualisierte Vorschau vor dem Import.",
  manuscriptImportRefreshPreview: "Vorschau aktualisieren",
  manuscriptImportWarnings: "Nicht vollständig übertragbare Inhalte",
  manuscriptImportWarningsIntro:
    "Diese Inhalte werden nicht vollständig übernommen. Bestätige jede Kategorie nach der Prüfung.",
  manuscriptImportWarningAcknowledge: "{label}: {count} erkannt und geprüft",
  manuscriptImportWarningImages: "Bilder",
  manuscriptImportWarningHyperlinks: "Hyperlinks",
  manuscriptImportWarningHeadersFooters: "Kopf- und Fußzeilen",
  manuscriptImportWarningFootnotesEndnotes: "Fuß- und Endnoten",
  manuscriptImportWarningComments: "Kommentare",
  manuscriptImportWarningNumbering: "Automatische Nummerierung",
  manuscriptImportWarningFields: "Word-Felder",
  manuscriptImportWarningFormatting: "Weitere Formatierungen",
  manuscriptImportWarningImagesHelp: "Bilder werden nicht in das neue Projekt übernommen.",
  manuscriptImportWarningHyperlinksHelp:
    "Der sichtbare Linktext bleibt erhalten; das Linkziel wird nicht übernommen.",
  manuscriptImportWarningHeadersFootersHelp:
    "Texte aus Kopf- und Fußzeilen werden nicht übernommen.",
  manuscriptImportWarningFootnotesEndnotesHelp:
    "Fuß- und Endnoten werden nicht in den Manuskripttext übernommen.",
  manuscriptImportWarningCommentsHelp: "Word-Kommentare werden nicht übernommen.",
  manuscriptImportWarningNumberingHelp:
    "Listen und automatische Nummerierungen werden als Text ohne automatische Nummerierung übernommen.",
  manuscriptImportWarningFieldsHelp:
    "Bei Word-Feldern bleibt nur der gespeicherte sichtbare Text erhalten.",
  manuscriptImportWarningFormattingHelp:
    "Fett und Kursiv bleiben im Kapiteltext erhalten. Die Formatierung von Kapiteltiteln sowie andere Textstile entfallen.",
  manuscriptImportCreatesNew:
    "Der Import erstellt ein neues Projekt. Bestehende Projekte und die Quelldatei bleiben unverändert.",
  manuscriptImportAction: "Als neues Projekt importieren",
  manuscriptImporting: "Neues Projekt wird erstellt …",
  manuscriptImportOpenAction: "Importiertes Projekt öffnen",
  manuscriptImportOpenFailed:
    "Das Projekt wurde erstellt, konnte aber noch nicht geöffnet werden. Öffne dasselbe Projekt erneut; es wird nicht doppelt importiert.",
  errorManuscriptImportInvalidFile:
    "Die Manuskriptdatei ist ungültig, beschädigt, verschlüsselt oder mit einer nicht unterstützten Textcodierung gespeichert. Es wurde kein Projekt erstellt.",
  errorManuscriptImportLimitExceeded:
    "Die Manuskriptdatei überschreitet die zulässige Größe oder enthält zu viele Daten.",
  errorManuscriptImportUnsupportedContent:
    "Die Manuskriptdatei enthält eine Struktur, die Quiltor nicht sicher übernehmen kann. Vereinfache sie und versuche es erneut.",
  errorManuscriptImportInvalidSelection:
    "Die gewählte Kapitelaufteilung oder Ordnerreihenfolge ist ungültig. Kapitel desselben Ordners müssen zusammenbleiben; prüfe Absätze und Ordnerpfade.",
  errorManuscriptImportPreviewMismatch:
    "Die Datei oder Vorschau hat sich geändert. Prüfe eine neue Vorschau, bevor du importierst.",
  errorManuscriptImportWarningsUnacknowledged:
    "Bestätige alle angezeigten Einschränkungen, bevor du importierst.",
  errorManuscriptImportConflictingRequest:
    "Dieser Importversuch passt nicht mehr zur geprüften Datei. Wähle die Datei erneut aus.",
  errorManuscriptImportPublicationFailed:
    "Das neue Projekt konnte nicht vollständig erstellt werden. Bestehende Projekte bleiben unverändert; du kannst den Import erneut versuchen.",
} as const;
