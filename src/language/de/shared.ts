// Formulierungen, die mehrere Bereiche teilen. Generische Substantive und Zustände stehen in
// common.ts, generische Aktionsverben in menus.ts. Alles, was nur ein Bereich braucht, bleibt
// in dessen eigener Datei -- hier landet nur, was sonst doppelt gepflegt werden müsste.
export const shared = {
  closeDialog: 'Dialog schließen',
  themeChoice: 'Darstellung', themeSystem: 'System', themeLight: 'Hell', themeDark: 'Dunkel',
  // Das Halten schützt nur noch die zwei Aktionen, die keine Rückholmöglichkeit haben. Es steht
  // deshalb keine Sekundenzahl mehr im Text: der Fortschrittsbalken zeigt die kurze Dauer, und eine
  // genannte Zahl war bei anderthalb Sekunden ohnehin nur auf- oder abgerundet.
  holdAriaLabel: '{label} – gedrückt halten zum Bestätigen', holdToConfirm: '{label} · gedrückt halten', keepHolding: 'Weiter halten …',
  undoHint: 'Lässt sich mit {shortcut} rückgängig machen.',
  unsaved: 'Ungespeichert', saving: 'Speichert …', saved: 'Gespeichert', notSaved: 'Nicht gespeichert', saveFailed: 'Speichern fehlgeschlagen',
  // Fällt an, wenn ein Export den Speicherort nicht erreicht -- im Browser praktisch nie, in der
  // Desktop-App immer dann, wenn die native Speichern-Brücke die Datei nicht schreiben konnte.
  exportFailed: 'Der Export konnte nicht gespeichert werden.',
  saveConflict: 'Die Seite wurde in einem anderen Tab geändert. Lade sie neu, bevor du weiterschreibst.',
  timeline: 'Timeline', moment: 'Zeitpunkt', moments: 'Zeitpunkte', newMoment: 'Neuer Zeitpunkt', addMoment: 'Zeitpunkt hinzufügen', deleteMoment: 'Zeitpunkt löschen',
  relationship: 'Beziehung', relationships: 'Beziehungen', directed: 'Gerichtet', undirected: 'Ungerichtet', reverseDirection: 'Richtung umkehren',
  newPlace: 'Neuer Ort', copyName: '{name} – Kopie', removeDeathMarker: 'Todesmarkierung entfernen',
  optionalDate: 'Datum (optional)', optionalNote: 'Notiz (optional)', searchTerm: 'Suchbegriff',
  // Zähler stehen als ganze Formulierung im Katalog, damit die Komponente Zahl und Wort nicht
  // selbst zusammensetzen muss -- im Englischen ist die Kleinschreibung sonst nicht steuerbar.
  nElements: '{n} Elemente', nRelationships: '{n} Beziehungen', nMoments: '{n} Zeitpunkte', nChanges: '{n} Änderungen', nPlaces: '{n} Orte',
} as const;
