// Die Fläche mit den Figuren heißt durchgehend „Figurenboard“ -- nicht Diagramm, nicht
// Figurendiagramm. Kanten heißen „Beziehung“ (in shared.ts), nie „Verbindung“.
export const figures = {
  figuresWorld: 'Figuren & Welt', figure: 'Figur', animal: 'Tier', organisation: 'Organisation', object: 'Objekt', place: 'Ort', concept: 'Konzept', connect: 'Verbinden', profiles: 'Steckbriefe', import: 'Import',
  undoDiagram: 'Figurenboard rückgängig', redoDiagram: 'Figurenboard wiederholen', selectElement: 'Element auswählen', selectElementHelp: 'Wähle ein Element im Board, um Steckbrief und Beziehungen zu bearbeiten.',
  selection: 'Auswahl', card: 'Karte', profile: 'Steckbrief', kind: 'Art', category: 'Rolle / Kategorie', shortDescription: 'Kurzbeschreibung', accent: 'Akzent', neutral: 'Neutral', green: 'Grün', gold: 'Gold', rose: 'Rosa',
  customFields: 'Eigene Felder', fieldName: 'Feldname', content: 'Inhalt', lineStyle: 'Linienstil', normal: 'Normal', dashed: 'Gestrichelt', bloodline: 'Blutlinie', deleteConnection: 'Beziehung löschen', deleteConnectionDescription: 'Die Beziehung zu „{name}“ wird entfernt – samt aller Stände, die sie an einzelnen Zeitpunkten hat.',
  newFigureName: 'Neue Figur', newConceptName: 'Neues Konzept', newAnimalName: 'Neues Tier', newOrganisationName: 'Neue Organisation', newObjectName: 'Neues Objekt',
  nodeRoleLabel: 'Rolle', animalRoleLabel: 'Art / Rolle', organisationRoleLabel: 'Art / Funktion', objectRoleLabel: 'Art / Bedeutung',
  important: 'Wichtig', deceased: 'Verstorben', connectDirectedHelp: 'Verbinde rechts mit links für eine gerichtete Beziehung oder Mitte mit Mitte für eine ungerichtete.', relationExists: 'Diese Beziehung existiert bereits und wurde im Inspector geöffnet.', invalidDiagramFile: 'Diese Datei enthält kein gültiges Figurenboard.',
  element: 'Element', figuresAndRelationsLabel: 'Figuren und Beziehungen', grid: 'Raster', arrangeGrid: 'Anordnen', connectModeHint: 'Rechts → links: gerichtet · Mitte ↔ Mitte: ungerichtet',
  createElementMenu: 'Element erstellen', figureViewMenu: 'Ansicht', figureManageMenu: 'Verwalten', elementActions: 'Elementaktionen', openInInspector: 'Im Inspector öffnen', showGrid: 'Raster einblenden', hideGrid: 'Raster ausblenden', showTimeline: 'Zeit einblenden', hideTimeline: 'Zeit ausblenden', showPaths: 'Wege einblenden', hidePaths: 'Wege ausblenden',
  figureInspectorLabel: 'Figuren-Inspector', inspector: 'Inspector', closeSelection: 'Auswahl schließen', closeMessage: 'Meldung schließen',
  deleteElement: 'Element löschen', deleteElementDescription: '„{name}“ und alle Beziehungen dorthin werden entfernt.', importDiagram: 'Figurenboard importieren', importDiagramDescription: '{nodes} Elemente und {edges} Beziehungen ersetzen den aktuellen Stand. Vorher wird automatisch gesichert.', importAction: 'Importieren',
  unmarkImportant: 'Wichtig-Markierung entfernen', markImportant: 'Als wichtig markieren', unpinPosition: 'Position lösen', pinPosition: 'Position fixieren', diesHere: 'Stirbt hier',
  customField: 'Eigenes Feld', removeCustomField: 'Eigenes Feld entfernen', noRelationshipsYet: 'Noch keine Beziehungen.', reverseDirectionTo: 'Richtung umkehren: {from} nach {to}', undirectedRelation: 'Ungerichtete Beziehung', appliesHere: 'Gilt hier', notActiveHere: 'Hier nicht aktiv',
  relationToName: 'Beziehung zu {name}', nameRelationship: 'Beziehung benennen', relationEndsHere: 'Beziehung endet hier', relationStartsHere: 'Ab hier beginnen', deleteKind: '{kind} löschen',
  placeSinceMoment: 'Ort ab „{title}“', placeInitial: 'Ort (Ausgangslage)', unchanged: 'Unverändert', noPlace: 'Kein Ort', createPlaceFirst: 'Lege zuerst einen Ort an.',
  profileAge: 'Alter', profileRoleInStory: 'Rolle in der Geschichte', profileAppearance: 'Aussehen', profileBackground: 'Herkunft & Vorgeschichte', profileVoice: 'Stimme & Sprechweise', profileNotes: 'Notizen',
} as const;
