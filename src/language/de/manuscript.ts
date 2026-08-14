// Ein gespeicherter Textstand heißt durchgehend „Fassung“ -- nicht Version, nicht Stand.
// Das Hilfspanel heißt überall „Schreibhilfe“, egal ob im Inspector oder im Fokusmodus.
export const manuscript = {
  manuscript: 'Manuskript', chapter: 'Kapitel', chapters: 'Kapitel', chapterText: 'Kapiteltext', chapterTitle: 'Kapiteltitel', words: 'Wörter', totalWords: 'Wörter gesamt', characters: 'Zeichen', standardPages: 'Normseiten',
  navigation: 'Navigation', details: 'Details', focus: 'Fokus', versions: 'Fassungen', exportManuscript: 'Exportieren', exportOptions: 'Exportoptionen', bookPdf: 'Buch-PDF', creatingPdf: 'Erzeuge PDF …',
  undoManuscript: 'Manuskript rückgängig', redoManuscript: 'Manuskript wiederholen', closeNavigation: 'Kapitelnavigation schließen', closeInspector: 'Inspector schließen',
  chapterNote: 'Kapitelnotiz', moveUp: 'Nach oben', moveDown: 'Nach unten', chapterMarkdown: 'Kapitel als Markdown', deleteChapter: 'Kapitel löschen',
  figuresPlaces: 'Figuren & Orte', ownTerms: 'Eigene Begriffe', specialCharacters: 'Sonderzeichen', addTerm: 'Begriff hinzufügen', newTerm: 'Neuer Begriff',
  previousVersion: 'Frühere Fassung', nextToCurrent: 'Direkt neben dem aktuellen Text', state: 'Fassung', loadingVersion: 'Fassung wird geladen …', noVersion: 'Noch keine gespeicherte Fassung vorhanden.', closeVersions: 'Kapitelfassungen schließen',
  writingAid: 'Schreibhilfe', openWritingAid: 'Schreibhilfe öffnen', closeWritingAid: 'Schreibhilfe schließen', writingAidPanelLabel: 'Schreibhilfe im Fokusmodus', leaveFocus: 'Fokusmodus verlassen',
  newChapterTitle: 'Kapitel {n}', startWritingPlaceholder: 'Schreib los …', versionLoadError: 'Die Fassung konnte nicht geladen werden.', chapterNotYetExisting: 'Dieses Kapitel existierte in dieser Fassung noch nicht.',
  noChapterYet: 'Noch kein Kapitel', createFirstChapter: 'Erstes Kapitel anlegen', chapterInspectorLabel: 'Kapitel-Inspector', chapterNotePlaceholder: 'Notiz zum Kapitel', removeTerm: '{word} entfernen',
  focusChapterPickerLabel: 'Kapitelauswahl im Fokusmodus', selectChapters: 'Kapitel auswählen', closeChapterPicker: 'Kapitelauswahl schließen', openChapterPicker: 'Kapitelauswahl öffnen',
  novelLabel: 'Roman', untitledWorld: 'Unbenannte Welt', manuscriptVersionLabel: 'Manuskriptfassung', deleteChapterDescription: '„{title}“ wird aus dem Manuskript entfernt.', bookPdfError: 'Das Buch-PDF konnte nicht erzeugt werden.',
  ambiguousMentions: 'Mehrdeutige Verknüpfungen', worldObject: 'Weltobjekt',
  orphanedMentionsRemoved: '{count} verwaiste Verknüpfungen wurden entfernt.', updateEntityMentions: 'Manuskript aktualisieren?', updateEntityMentionsDescription: '„{from}“ wurde in „{to}“ umbenannt. Sollen alle verknüpften Vorkommen im Manuskript ersetzt werden?', updateMentions: 'Vorkommen ersetzen',
} as const;
