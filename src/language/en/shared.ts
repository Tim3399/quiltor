// Wording shared by more than one area. Generic nouns and states live in common.ts, generic
// action verbs in menus.ts. Anything only one area needs stays in its own feature file -- only
// what would otherwise be maintained twice belongs here.
export const shared = {
  closeDialog: 'Close dialog',
  themeChoice: 'Theme', themeSystem: 'System', themeLight: 'Light', themeDark: 'Dark',
  holdSecondsAriaLabel: '{label} – hold for {n} seconds', holdToConfirm: '{label} · hold {n}s', keepHolding: 'Keep holding · {n}',
  unsaved: 'Unsaved', saving: 'Saving …', saved: 'Saved', notSaved: 'Not saved', saveFailed: 'Save failed',
  saveConflict: 'The page was changed in another tab. Reload it before writing on.',
  timeline: 'Timeline', moment: 'Moment', moments: 'Moments', newMoment: 'New moment', addMoment: 'Add moment', deleteMoment: 'Delete moment',
  relationship: 'Relationship', relationships: 'Relationships', directed: 'Directed', undirected: 'Undirected', reverseDirection: 'Reverse direction',
  newPlace: 'New place', copyName: '{name} – copy', removeDeathMarker: 'Remove death marker',
  optionalDate: 'Date (optional)', optionalNote: 'Note (optional)', searchTerm: 'Search term',
  // Counters carry the whole phrase so components never concatenate number and word themselves
  // -- otherwise English lower-casing is not controllable from the catalog.
  nElements: '{n} elements', nRelationships: '{n} relationships', nMoments: '{n} moments', nChanges: '{n} changes', nPlaces: '{n} places',
} as const;
