// Die Wahl der KI-Engine im Assistenten (T-61). Teil 7 hat die Texte der KI im Browser, T-264 ergänzt die des eigenen Schlüssels.
export const assistantClientAi = {
  assistantEngineLabel: "KI-Engine",
  assistantEngineServer: "Server-KI",
  // Ohne Identität rechnet das Server-Modell auf dem Rechner der Autorin (T-275).
  assistantEngineLocal: "Auf diesem Rechner",
  assistantEngineServerLocked: "Die Server-KI steht nur mit Premium-Berechtigung zur Verfügung.",
  assistantEngineBrowser: "Im Browser",
  // Kopf des Assistenten, wenn keine Engine nutzbar ist: gehostet, ohne Premium, ohne WebGPU (D-T-275-F1).
  assistantEngineNone: "Keine KI verfügbar",
  // Gehostet ohne WebGPU (Safari, Firefox, ältere Geräte): Die KI im Browser fehlt im Umschalter (D-T-275-F1).
  assistantEngineBrowserUnsupported:
    "Die KI im Browser braucht WebGPU, und dieser Browser bietet es nicht an. Ein aktueller Browser mit WebGPU auf einem Gerät mit Grafikchip kann es.",
  assistantEngineOwnKey: "Eigener Schlüssel",
  errorAssistantClientJobRunning:
    "In einem anderen Tab läuft schon ein Auftrag mit deiner eigenen Engine. Warte, bis er fertig ist.",
  errorAssistantClientAiDisabled: "Auf diesem Server kann der Assistent nur die Server-KI nutzen.",
  // Fehler eines Auftrags auf der eigenen Engine (D-T-61-30). Der rohe Code der Engine erscheint nie im Gespräch.
  assistantEngineErrorModelNotLoaded:
    "Das Modell für die KI im Browser liegt noch nicht auf diesem Gerät. Lade es zuerst oben unter „KI im Browser“ herunter.",
  assistantEngineErrorUnavailable:
    "Die KI im Browser konnte nicht antworten. Versuche es noch einmal oder lade die Seite neu.",
  assistantEngineErrorClientUnavailable:
    "Dieser Browser hat den Auftrag nicht übernommen. Lass den Tab mit dem Assistenten geöffnet und versuche es noch einmal.",
  assistantEngineErrorProvider:
    "Der Anbieter hat die Anfrage abgelehnt. Prüfe deinen Schlüssel und versuche es noch einmal.",
  assistantEngineErrorContextTooLarge:
    "Die Anfrage ist zu groß für das Modell im Browser. Wähle weniger Kapitel aus.",
  assistantEngineErrorUnknown: "Die eigene Engine konnte den Auftrag nicht ausführen.",
  webllmTitle: "KI im Browser",
  webllmChecking: "Prüfe, ob das Modell schon auf diesem Gerät liegt …",
  webllmAbsent:
    "Das Modell ist noch nicht auf diesem Gerät. Es ist etwa 2,5 GB groß und bleibt danach im Browser gespeichert.",
  webllmDownload: "Modell herunterladen",
  webllmDownloading: "Lade das Modell …",
  webllmCached: "Das Modell liegt auf diesem Gerät und wird beim ersten Auftrag geladen.",
  webllmReady: "Das Modell ist geladen und rechnet auf diesem Gerät.",
  webllmReadyStatus: "Im Browser · geladen",
  webllmModelActions: "Modell-Aktionen",
  webllmRemoveModel: "Modell entfernen",
  webllmError: "Das Modell ließ sich nicht laden: {error}",
};
