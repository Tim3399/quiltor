// Truly generic, domain-independent UI vocabulary — not tied to any single feature area.
// Feature-specific phrasing (even if reused across features) belongs in shared.ts instead.
export const common = {
  ready: 'Ready', cancel: 'Cancel', name: 'Name', unknown: 'Unknown', untitled: 'Untitled', loading: 'Loading …', delete: 'Delete',
  continue: 'Continue', back: 'Back', next: 'Next', yes: 'Yes', no: 'No', ok: 'OK', confirm: 'Confirm', edit: 'Edit', add: 'Add', remove: 'Remove', save: 'Save', close: 'Close',
} as const;
