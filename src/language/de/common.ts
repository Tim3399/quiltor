// Truly generic, domain-independent UI vocabulary — not tied to any single feature area.
// Feature-specific phrasing (even if reused across features) belongs in shared.ts instead.
export const common = {
  ready: 'Bereit', cancel: 'Abbrechen', name: 'Name', unknown: 'Unbekannt', untitled: 'Ohne Titel', loading: 'Lade …', delete: 'Löschen',
  continue: 'Fortfahren', back: 'Zurück', next: 'Weiter', yes: 'Ja', no: 'Nein', ok: 'OK', confirm: 'Bestätigen', edit: 'Bearbeiten', add: 'Hinzufügen', remove: 'Entfernen', save: 'Speichern', close: 'Schließen',
} as const;
