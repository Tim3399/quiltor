export const manuscriptExport = {
  manuscriptExportEditorAction: "DOCX fürs Lektorat",
  manuscriptExportNormseiteAction: "DOCX als Normseite",
  manuscriptEpubAction: "EPUB für E-Reader",
  manuscriptExportTitle: "DOCX-Inhalt prüfen",
  manuscriptExportPreviewLoading: "Gespeicherten Manuskriptstand prüfen …",
  manuscriptExportRefreshPreview: "Vorschau neu laden",
  manuscriptExportContentPreview: "Inhaltsvorschau",
  manuscriptExportChapterPreview: "Vorschau der exportierten Kapitel",
  manuscriptExportEditorDescription:
    "Lektoratsfassung: A4, Times New Roman 12 pt und 1,5-facher Zeilenabstand.",
  manuscriptExportNormseiteDescription:
    "Normseite: A4, Courier New 12 pt, Ziel 30 Zeilen × 60 Zeichen und keine Silbentrennung.",
  manuscriptExportScope:
    "Exportiert werden Kapiteltitel, Text, Fett, Kursiv und Szenentrenner in der Reihenfolge der Buchansicht. Weltwissen, Verlauf, Notizen und Buchlayout werden nicht exportiert.",
  manuscriptExportPagination:
    "Dies ist eine Inhaltsvorschau. Das endgültige Seitenlayout und die Seitenzahlen siehst du nach dem Öffnen in einem DOCX-Programm.",
  manuscriptExportNoExtras:
    "Es gibt kein Titelblatt und keine automatische Kapitelnummerierung. Vorhandene Kapiteltitel einschließlich eigener Nummern bleiben erhalten.",
  manuscriptExportManuscriptChapters: "Kapitel im Manuskript",
  manuscriptExportExportedChapters: "Exportierte Kapitel",
  manuscriptExportManuscriptWords: "Wörter im Manuskript",
  manuscriptExportExportedWords: "Exportierte Wörter",
  manuscriptExportCountsHelp: "Wortzahlen beziehen sich auf den Kapiteltext ohne Überschriften.",
  manuscriptExportChapterWords: "{count} Wörter",
  manuscriptExportWarnings: "Vor dem Download prüfen",
  manuscriptExportWarningsHelp:
    "Diese Inhalte bleiben im Projekt, werden aber nicht in die DOCX-Datei übernommen.",
  manuscriptExportWarningNotes: "Nicht enthaltene Kapitelnotizen",
  manuscriptExportWarningReferences: "Nicht enthaltene Verknüpfungen",
  manuscriptExportWarningFolders: "Nicht enthaltene Ordnerüberschriften",
  manuscriptExportWarningExcludedChapters: "Nicht im Buch enthaltene Kapitel",
  manuscriptExportWarningExtensions: "Nicht enthaltene Zusatzdaten",
  manuscriptExportWarningCount: "{label}: {count}",
  manuscriptExportAcknowledge: "Alle angezeigten Hinweise wurden geprüft",
  manuscriptExportDownload: "DOCX herunterladen",
  manuscriptExportRendering: "DOCX wird erstellt …",
  manuscriptExportDownloaded: "Die DOCX-Datei wurde zum Speichern übergeben.",
  manuscriptExportPreviewFailed: "Die Inhaltsvorschau konnte nicht geladen werden.",
  manuscriptExportRenderFailed: "Die DOCX-Datei konnte nicht erstellt werden.",
  manuscriptExportSaveFailed: "Die DOCX-Datei konnte nicht gespeichert werden.",
  manuscriptEpubTitle: "EPUB-Inhalt prüfen",
  manuscriptEpubDescription:
    "Das EPUB passt Textfluss und Darstellung an den E-Reader an. Schrift, Schriftgröße und Seitenaufteilung wählt die lesende Person im Gerät.",
  manuscriptEpubScope:
    "Exportiert werden Kapiteltitel, Manuskripttext, Fett, Kursiv und Szenentrenner in der Reihenfolge der Buchansicht.",
  manuscriptEpubPagination:
    "Die Vorschau zeigt Inhalt und Reihenfolge. Schriftgröße sowie Zeilen- und Seitenumbrüche richten sich nach dem Lesegerät; Kapitel bleiben gegliedert. Eine feste Seitenzahl wie im Druck gibt es nicht.",
  manuscriptEpubNoExtras:
    "Untertitel, Reihe, Band und Titelblattgestaltung werden in diesem EPUB nicht übernommen.",
  manuscriptEpubMetadata: "Buchangaben",
  manuscriptEpubMetadataHelp:
    "Titel und Autor kannst du in der Buchgestaltung ändern. Die Sprache wird aus dem gespeicherten Manuskript übernommen.",
  manuscriptEpubMetadataTitle: "Titel",
  manuscriptEpubMetadataAuthor: "Autor",
  manuscriptEpubMetadataLanguage: "Sprache",
  manuscriptEpubMetadataNoAuthor: "Nicht angegeben",
  manuscriptEpubWarningsHelp:
    "Diese Inhalte bleiben im Projekt, werden aber nicht in die EPUB-Datei übernommen.",
  manuscriptEpubDownload: "EPUB herunterladen",
  manuscriptEpubRendering: "EPUB wird erstellt …",
  manuscriptEpubDownloaded: "Die EPUB-Datei wurde zum Speichern übergeben.",
  manuscriptEpubRenderFailed: "Die EPUB-Datei konnte nicht erstellt werden.",
  manuscriptEpubSaveFailed: "Die EPUB-Datei konnte nicht gespeichert werden.",
  errorManuscriptEpubInvalidContent:
    "Das Manuskript enthält Inhalte, die nicht sicher als EPUB exportiert werden können.",
  errorManuscriptEpubLimitExceeded: "Das Manuskript ist für diesen EPUB-Export zu groß.",
  errorManuscriptExportInvalidRequest: "Die Exportanfrage ist ungültig.",
  errorManuscriptExportEmptyBook: "Die Buchansicht enthält keine exportierbaren Kapitel.",
  errorManuscriptExportInvalidContent:
    "Das Manuskript enthält Inhalte, die nicht sicher als DOCX exportiert werden können.",
  errorManuscriptExportLimitExceeded: "Das Manuskript ist für diesen DOCX-Export zu groß.",
  errorManuscriptExportPreviewMismatch:
    "Das Manuskript hat sich seit der Vorschau geändert. Lade eine neue Vorschau.",
  errorManuscriptExportWarningsUnacknowledged:
    "Prüfe und bestätige alle angezeigten Hinweise vor dem Download.",
} as const;
