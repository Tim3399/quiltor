export const tools = {
  searchCommands: 'Search & commands', searchPlaceholder: 'Chapters, text, characters, places …', command: 'Command',
  snapshotSave: 'Save working state', target: 'Target', changed: 'Changed', files: 'files', notConfigured: 'Not configured', snapshotMessage: 'What changed?', saveOnly: 'Save locally only', saveAndUpload: 'Save & upload', technicalDetails: 'Technical details',
  loadingBackupStatus: 'Loading status …', done: 'Done.',
  comparison: 'Comparison', byWord: 'By word', byLine: 'By line', allFiles: 'All files', textOnly: 'Text only', states: 'States', sinceCommit: 'Since last save', workingState: 'Working state', noChanges: 'No changes', newFiles: 'New files',
  database: 'Database', statWords: '+{added} / -{removed} words', statLines: '+{added} / -{removed} lines', binaryChange: 'Changed, content not shown here.',
  restore: 'Restore', restoreBackup: 'Restore backup', noBackup: 'No backup available yet.', backupAutoNote: 'SQLite backups are created automatically, at most every five minutes.', restoreConfirmDescription: 'The current state is backed up first, then completely replaced by this backup.', backupPreviewDescription: 'Local SQLite backup · {size}', backupSelectTitle: 'Select a backup', backupSelectDescription: 'Select a backup on the left to review and restore it.',
  switchToManuscript: 'Switch to manuscript', switchToFigures: 'Switch to character board', switchToTimeline: 'Switch to timeline', switchToPlaces: 'Switch to places', toggleFocus: 'Toggle focus mode', noSearchResults: 'No matching content or commands found.',
} as const;
