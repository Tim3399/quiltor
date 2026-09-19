// Truly generic, domain-independent UI vocabulary — not tied to any single feature area.
// Feature-specific phrasing (even if reused across features) belongs in shared.ts instead.
export const common = {
  ready: "Bereit",
  name: "Name",
  unknown: "Unbekannt",
  untitled: "Ohne Titel",
  loading: "Lade …",
  cut: "Ausschneiden",
  copy: "Kopieren",
  clipboardRefused:
    "Die Zwischenablage hat den Text nicht angenommen — nichts wurde ausgeschnitten.",
  errorUnauthorized: "Bitte melde dich an, um fortzufahren.",
  errorForbidden: "Du darfst diese Aktion nicht ausführen.",
  errorNotFound: "Der angeforderte Inhalt wurde nicht gefunden.",
  errorConflict:
    "Die gespeicherte Fassung hat sich geändert. Bewahre deinen Entwurf auf und vergleiche ihn mit der gespeicherten Fassung.",
  errorInvalidRequest: "Die Anfrage ist ungültig.",
  errorInvalidResponse: "Quiltor hat eine ungültige Antwort erhalten.",
  errorUnavailable: "Quiltor ist vorübergehend nicht erreichbar. Versuche es gleich erneut.",
  errorStorageReadOnly:
    "Speicher ist schreibgeschützt. Rette den Entwurf, prüfe die Schreibrechte und versuche es erneut.",
  errorStorageFull:
    "Nicht genug Speicherplatz. Rette den Entwurf, schaffe Platz und versuche es erneut.",
  errorStorageLocked:
    "Das Projekt ist gerade für Schreibzugriffe gesperrt. Dein Entwurf bleibt erhalten. Versuche es erneut oder rette den Entwurf.",
  errorBackupPreviewFailed:
    "Die Sicherung konnte nicht für die Vorschau geöffnet werden. Sie wurde möglicherweise beschädigt.",
  errorUnknown: "Die Aktion konnte nicht abgeschlossen werden.",
} as const;
