// Truly generic, domain-independent UI vocabulary — not tied to any single feature area.
// Feature-specific phrasing (even if reused across features) belongs in shared.ts instead.
export const common = {
  ready: 'Bereit', name: 'Name', unknown: 'Unbekannt', untitled: 'Ohne Titel', loading: 'Lade …',
} as const;
