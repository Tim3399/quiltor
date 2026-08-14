// Formulierungen, die mehrere Bereiche teilen. Generische Substantive und Zustände stehen in
// common.ts, generische Aktionsverben in menus.ts. Alles, was nur ein Bereich braucht, bleibt
// in dessen eigener Datei -- hier landet nur, was sonst doppelt gepflegt werden müsste.
export const shared = {
  closeDialog: 'Dialog schließen',
  themeChoice: 'Darstellung', themeSystem: 'System', themeLight: 'Hell', themeDark: 'Dunkel',
  holdSecondsAriaLabel: '{label} – {n} Sekunden halten', holdToConfirm: '{label} · {n} Sek. halten', keepHolding: 'Weiter halten · {n}',
  unsaved: 'Ungespeichert', saving: 'Speichert …', saved: 'Gespeichert', notSaved: 'Nicht gespeichert', saveFailed: 'Speichern fehlgeschlagen',
  saveConflict: 'Die Seite wurde in einem anderen Tab geändert. Lade sie neu, bevor du weiterschreibst.',
  timeline: 'Timeline', moment: 'Zeitpunkt', moments: 'Zeitpunkte', newMoment: 'Neuer Zeitpunkt', addMoment: 'Zeitpunkt hinzufügen', deleteMoment: 'Zeitpunkt löschen',
  relationship: 'Beziehung', relationships: 'Beziehungen', directed: 'Gerichtet', undirected: 'Ungerichtet', reverseDirection: 'Richtung umkehren',
  newPlace: 'Neuer Ort', copyName: '{name} – Kopie', removeDeathMarker: 'Todesmarkierung entfernen',
  optionalDate: 'Datum (optional)', optionalNote: 'Notiz (optional)', searchTerm: 'Suchbegriff',
  // Zähler stehen als ganze Formulierung im Katalog, damit die Komponente Zahl und Wort nicht
  // selbst zusammensetzen muss -- im Englischen ist die Kleinschreibung sonst nicht steuerbar.
  nElements: '{n} Elemente', nRelationships: '{n} Beziehungen', nMoments: '{n} Zeitpunkte', nChanges: '{n} Änderungen', nPlaces: '{n} Orte',
} as const;
