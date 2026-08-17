// Truly generic, domain-independent UI vocabulary — not tied to any single feature area.
// Feature-specific phrasing (even if reused across features) belongs in shared.ts instead.
export const common = {
  ready: 'Ready', name: 'Name', unknown: 'Unknown', untitled: 'Untitled', loading: 'Loading …',
  cut: 'Cut', copy: 'Copy',
  clipboardRefused: 'The clipboard refused the text — nothing was cut.',
} as const;
