// Der Assistent spricht durchgehend in der ersten Person und nennt sich nie selbst „Quiltor“.
export const assistant = {
  localOnlySuggestions: "Lokal · nur Vorschläge",
  newChat: "Neuer Chat",
  closeAssistant: "Assistent schließen",
  sourcesIndexed: "{n} Quellen indexiert",
  sourcesScopeDescription: "Welt, Manuskript, Steckbriefe, Beziehungen und Timeline",
  localModelUnavailable: "Lokales Modell nicht erreichbar",
  retry: "Erneut versuchen",
  installAssistant: "Jetzt einrichten",
  installingAssistant: "Wird eingerichtet … {percent}%",
  installAssistantError: "Einrichtung fehlgeschlagen: {error}",
  assistantGreeting: "Was soll ich in der Welt nachtragen?",
  assistantGreetingBody:
    "Ich kann Figuren und Beziehungen vorbereiten, Zeitpunkte anlegen und deine Welt mit Quellenangabe auswerten.",
  findMissingFigures: "Fehlende Figuren finden",
  findMissingFiguresPrompt:
    "Lege aus meinen vorhandenen Notizen fehlende Figuren als Vorschläge an.",
  checkTimeline: "Timeline prüfen",
  checkTimelinePrompt: "Prüfe die Beziehungen und Timeline auf Lücken oder Widersprüche.",
  requestAborted: "Anfrage abgebrochen.",
  pickChaptersIndividually: "Kapitel einzeln auswählen",
  runInChapterGroups: "In Kapitel-Gruppen ausführen",
  nProposals: "{n} Vorschläge",
  applyAll: "Alle übernehmen",
  packageOnlyTogetherHelp:
    "Dieser Vorschlag gehört zu einem atomaren Paket und wird nur gemeinsam übernommen.",
  applied: "Übernommen",
  inPackage: "Im Paket",
  apply: "Übernehmen",
  agentTraceSteps: "Ablauf ({n} Schritte)",
  processingChapterGroups: "Kapitel-Gruppen werden verarbeitet …",
  assistantSearchingWorld: "Ich durchsuche deine Welt …",
  contextNChaptersForced: "Kontext: Kapitelauswahl ({n})",
  contextEntireWorld: "Kontext: gesamte Welt",
  resetSelection: "Auswahl zurücksetzen",
  messageToAssistantLabel: "Nachricht an den lokalen Assistenten",
  messagePlaceholder: "Figur anlegen, Beziehung ändern, Timeline prüfen …",
  cancelRequest: "Anfrage abbrechen",
  sendMessage: "Nachricht senden",
  manuscriptReadOnlyNote:
    "Das Manuskript ist nur lesbarer Kontext. Änderungen daran werden nie automatisch angewendet.",
  newChatConfirmDescription:
    "Der aktuelle Gesprächsverlauf wird gelöscht. Das kann nicht rückgängig gemacht werden.",
  startNewChat: "Neuer Chat starten",
  sources: "Quellen",
  createElementLabel: "Element anlegen · {name}",
  withoutName: "Ohne Namen",
  updateElementLabel: "Element ergänzen · {name}",
  createMomentLabel: "Zeitpunkt anlegen · {title}",
  createRelationshipLabel: "Beziehung anlegen · {from} ↔ {to}",
  updateRelationshipStateLabel: "Beziehungsstand ändern · {label}",
  statusFallback: "Status",
  rearrangeElementsLabel: "Elemente thematisch neu anordnen",
  setDeathMomentLabel: "Todeszeitpunkt setzen · {name}",
  newPrefix: "Neu",
  defaultElementName: "Neues Element",
  // Vom Backend erzeugter, deterministischer Antworttext (siehe src/quiltor/modules/assistant/*.py) -- das
  // Backend schickt ein Tripel aus messageKey/messageParams/messageItems statt fertigem Text,
  // damit diese Datei für jede Sprache die einzige Quelle bleibt, nicht nur für LLM-Antworten.
  whichElementDoYouMean: "Welches Element meinst du?",
  duplicateElementExists:
    "„{name}“ existiert bereits. Deshalb habe ich kein doppeltes Element vorgeschlagen. Du kannst stattdessen den vorhandenen Steckbrief oder seine Beziehungen ergänzen.",
  broadScopeMessage:
    "Das betrifft alle {chapterCount} Kapitel. Eine einzelne Anfrage bekäme dafür entweder nicht genug Kontext oder nicht genug Antwortraum. Ich kann stattdessen kapitelweise in Gruppen durchgehen, lokal geschätzt {minMinutes}-{maxMinutes} Minuten. Wähle einzelne Kapitel aus, oder lass mich in Gruppen durchgehen.",
  proseRefusal:
    "Ich schreibe oder vervollständige keine Romanprosa. Ich kann die geplante Szene aber anhand deiner Welt analysieren, Widersprüche finden, beteiligte Figuren und Beziehungen ordnen oder ihre Konsequenzen als Notizen vorbereiten.",
  proposalPreparedGeneric: "Ich habe die gewünschte Änderung als prüfbaren Vorschlag vorbereitet.",
  unsourcedManuscriptNote:
    "Hinweis: Diese manuskriptbezogene Aussage ist ohne gültige Quellenangabe unbelegt.",
  taskIncompleteMissing:
    "Ich konnte die Aufgabe noch nicht vollständig als sicheren Vorschlag vorbereiten. Es fehlen: {items}. Es wurde nichts angewendet.",
  proposalsPreparedOne:
    "1 Änderung als prüfbarer Vorschlag vorbereitet. Es wurde noch nichts angewendet.",
  proposalsPreparedMany:
    "{n} zusammengehörige Änderungen als prüfbarer Vorschlag vorbereitet. Es wurde noch nichts angewendet.",
  auditFoundIssues:
    "Strukturell vollständig geprüft: {relationships} Beziehungen mit {relationshipStates} Zeitständen, {elements} Elemente, {timelineMoments} Zeitpunkte und {presenceEntries} Anwesenheits-Einträge. Gefunden: {items}. Es wurde nichts geändert.",
  auditNoIssues:
    "Strukturell vollständig geprüft: {relationships} Beziehungen mit {relationshipStates} Zeitständen, {elements} Elemente, {timelineMoments} Zeitpunkte und {presenceEntries} Anwesenheits-Einträge. Keine technischen Widersprüche gefunden. Ob Richtung und Beschriftung inhaltlich zur Geschichte passen, ist damit nicht geprüft; dafür müssen konkrete Manuskriptstellen als Belege ausgewertet werden.",
  issueMissingEndpoint: "Beziehung {id} hat einen fehlenden Endpunkt",
  issueDuplicateRelationship: "Beziehung {id} ist strukturell doppelt",
  issueMissingMoment: "Beziehung {id} verweist auf einen fehlenden Zeitpunkt {momentId}",
  issueDuplicateMomentState: "Beziehung {id} hat mehrere Stände am selben Zeitpunkt {momentId}",
  issuePresenceBackward:
    "{name} wechselt laut Anwesenheit den Ort, aber das Zieldatum liegt vor dem Ausgangsdatum",
  issuePresenceSameDay: "{name} wechselt laut Anwesenheit am selben Tag den Ort",
  kindCreateElement: "neues Element",
  kindUpdateElement: "Element aktualisieren",
  kindCreateTimelineMoment: "neuer Zeitpunkt",
  kindCreateRelationship: "neue Beziehung",
  kindSetRelationshipAtMoment: "Beziehungsstand ändern",
  kindMarkDeceased: "Todeszeitpunkt setzen",
  kindArrangeElements: "Elemente anordnen",
  kindSetPresence: "Anwesenheit setzen",
  duplicateElementIssue: "doppeltes Element",
  duplicateMomentIssue: "doppelter Zeitpunkt",
  batchSummary:
    "{chapters} Kapitel in {groups} Gruppen verarbeitet, {proposals} Vorschläge vorbereitet. Jeder Vorschlag kann einzeln geprüft und übernommen werden.",
  chapterGroupLabel: "Kapitel {index}/{total}: {titles}",
} as const;
