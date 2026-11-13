// Die Wahl der KI-Engine im Assistenten (T-61). Teil 7 hat die Texte der KI im Browser, T-264 ergänzt die des eigenen Schlüssels.
export const assistantClientAi = {
  assistantEngineLabel: "KI-Engine",
  assistantEngineServer: "Server-KI",
  assistantEngineBrowser: "Im Browser",
  assistantEngineOwnKey: "Eigener Schlüssel",
  errorAssistantClientJobRunning:
    "In einem anderen Tab läuft schon ein Auftrag mit deiner eigenen Engine. Warte, bis er fertig ist.",
  errorAssistantClientAiDisabled: "Auf diesem Server kann der Assistent nur die Server-KI nutzen.",
  webllmTitle: "KI im Browser",
  webllmChecking: "Prüfe, ob das Modell schon auf diesem Gerät liegt …",
  webllmAbsent:
    "Das Modell ist noch nicht auf diesem Gerät. Es ist etwa 2,5 GB groß und bleibt danach im Browser gespeichert.",
  webllmDownload: "Modell herunterladen",
  webllmDownloading: "Lade das Modell …",
  webllmCached: "Das Modell liegt auf diesem Gerät und wird beim ersten Auftrag geladen.",
  webllmReady: "Das Modell ist geladen und rechnet auf diesem Gerät.",
  webllmRemoveModel: "Modell entfernen",
  webllmError: "Das Modell ließ sich nicht laden: {error}",
};
