// A stored text state is called a “version” throughout. The helper panel is the “writing aid”
// everywhere, whether it appears in the inspector or in focus mode.
export const manuscript = {
  manuscript: 'Manuscript', chapter: 'Chapter', chapters: 'Chapters', newChapter: 'New chapter', chapterText: 'Chapter text', chapterTitle: 'Chapter title', words: 'Words', totalWords: 'words total', characters: 'Characters', standardPages: 'Standard pages',
  navigation: 'Navigation', focus: 'Focus', versions: 'Versions', exportManuscript: 'Export', exportOptions: 'Export options', bookPdf: 'Book PDF', creatingPdf: 'Creating PDF …',
  undoManuscript: 'Undo manuscript change', redoManuscript: 'Redo manuscript change', closeNavigation: 'Close chapter navigation', resizeWritingAid: 'Drag to resize the writing aid',
  chapterNote: 'Chapter note', chapterActions: 'Chapter actions', moveUp: 'Move up', moveDown: 'Move down', chapterMarkdown: 'Chapter as Markdown', deleteChapter: 'Delete chapter',
  figuresPlaces: 'Characters & places', ownTerms: 'Custom terms', specialCharacters: 'Special characters', addTerm: 'Add term', newTerm: 'New term',
  manageTerms: 'Manage', ownTermsEmpty: 'No custom terms yet.', ownTermsIntro: 'Custom terms count as correctly spelled for the grammar check and are ready to insert while you write.', chooseSymbols: 'Choose special characters',
  previousVersion: 'Previous version', nextToCurrent: 'Shown beside the current text', state: 'Version', loadingVersion: 'Loading version …', noVersion: 'No saved version yet.', closeVersions: 'Close chapter versions',
  writingAid: 'Writing aid', openWritingAid: 'Open writing aid', closeWritingAid: 'Close writing aid', writingAidPanelLabel: 'Writing aid (focus mode)', leaveFocus: 'Leave focus mode',
  newChapterTitle: 'Chapter {n}', startWritingPlaceholder: 'Start writing …', versionLoadError: 'The version could not be loaded.', chapterNotYetExisting: 'This chapter did not exist yet in this version.',
  noChapterYet: 'No chapter yet', createFirstChapter: 'Create first chapter', chapterNotePlaceholder: 'Note on this chapter', removeTerm: 'Remove {word}',
  focusChapterPickerLabel: 'Chapter picker (focus mode)', selectChapters: 'Select chapters', closeChapterPicker: 'Close chapter picker', openChapterPicker: 'Open chapter picker',
  novelLabel: 'Novel', untitledWorld: 'Untitled world', manuscriptVersionLabel: 'Manuscript version', deleteChapterDescription: '“{title}” will be removed from the manuscript.', bookPdfError: 'The book PDF could not be generated.',
  ambiguousMentions: 'Ambiguous links', worldObject: 'World object',
  orphanedMentionsRemoved: '{count} orphaned links were removed.', updateEntityMentions: 'Update manuscript?', updateEntityMentionsDescription: '“{from}” was renamed to “{to}”. Replace all linked occurrences in the manuscript?', updateMentions: 'Replace occurrences',
} as const;
