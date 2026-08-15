// The surface holding the characters is called the “character board” throughout -- never
// diagram. Edges are “relationships” (in shared.ts), never “connections”.
export const figures = {
  figuresWorld: 'Characters & world', figure: 'Character', animal: 'Animal', organisation: 'Organization', object: 'Object', place: 'Place', concept: 'Concept', connect: 'Connect', profiles: 'Profiles', import: 'Import',
  undoDiagram: 'Undo character board change', redoDiagram: 'Redo character board change', selectElement: 'Select an element', selectElementHelp: 'Select an element on the board to edit its profile and relationships.',
  selection: 'Selection', card: 'Card', profile: 'Profile', kind: 'Type', category: 'Role / category', shortDescription: 'Short description', accent: 'Accent', neutral: 'Neutral', green: 'Green', gold: 'Gold', rose: 'Rose',
  customFields: 'Custom fields', fieldName: 'Field name', content: 'Content', lineStyle: 'Line style', normal: 'Normal', dashed: 'Dashed', bloodline: 'Bloodline', deleteConnection: 'Delete relationship', deleteConnectionDescription: 'The relationship to “{name}” will be removed – including every state it holds at individual moments.',
  newFigureName: 'New character', newConceptName: 'New concept', newAnimalName: 'New animal', newOrganisationName: 'New organization', newObjectName: 'New object',
  nodeRoleLabel: 'Role', animalRoleLabel: 'Kind / role', organisationRoleLabel: 'Kind / function', objectRoleLabel: 'Kind / meaning',
  important: 'Important', deceased: 'Deceased', connectDirectedHelp: 'Connect right to left for a directed relationship, or center to center for an undirected one.', relationExists: 'This relationship already exists and has been opened in the inspector.', invalidDiagramFile: 'This file does not contain a valid character board.',
  element: 'Element', figuresAndRelationsLabel: 'Characters and relationships', grid: 'Grid', arrangeGrid: 'Arrange', connectModeHint: 'Right to left: directed · Center to center: undirected',
  createElementMenu: 'Create element', figureViewMenu: 'View', figureManageMenu: 'Manage', elementActions: 'Element actions', openInInspector: 'Open in inspector', showGrid: 'Show grid', hideGrid: 'Hide grid', showTimeline: 'Show timeline', hideTimeline: 'Hide timeline', showPaths: 'Show paths', hidePaths: 'Hide paths',
  figureInspectorLabel: 'Character inspector', inspector: 'Inspector', closeSelection: 'Close selection', closeMessage: 'Close message',
  deleteElement: 'Delete element', deleteElementDescription: '“{name}” and every relationship to it will be removed.', importDiagram: 'Import character board', importDiagramDescription: '{nodes} elements and {edges} relationships will replace the current state. A backup is created automatically first.', importAction: 'Import',
  unmarkImportant: 'Remove important marker', markImportant: 'Mark as important', unpinPosition: 'Release position', pinPosition: 'Pin position', diesHere: 'Dies here',
  customField: 'Custom field', removeCustomField: 'Remove custom field', noRelationshipsYet: 'No relationships yet.', reverseDirectionTo: 'Reverse direction: {from} to {to}', undirectedRelation: 'Undirected relationship', appliesHere: 'Applies here', notActiveHere: 'Not active here',
  relationToName: 'Relationship to {name}', nameRelationship: 'Name relationship', relationEndsHere: 'Relationship ends here', relationStartsHere: 'Begins from here', deleteKind: 'Delete {kind}',
  placeSinceMoment: 'Place since “{title}”', placeInitial: 'Place (initial state)', unchanged: 'Unchanged', noPlace: 'No place', createPlaceFirst: 'Create a place first.',
  profileAge: 'Age', profileRoleInStory: 'Role in the story', profileAppearance: 'Appearance', profileBackground: 'Background & backstory', profileVoice: 'Voice & manner of speech', profileNotes: 'Notes',
} as const;
