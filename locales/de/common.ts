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
  errorConflict: "Der Inhalt hat sich inzwischen geändert. Lade ihn neu und versuche es erneut.",
  errorInvalidRequest: "Die Anfrage ist ungültig.",
  errorInvalidResponse: "Quiltor hat eine ungültige Antwort erhalten.",
  errorUnavailable: "Quiltor ist vorübergehend nicht erreichbar. Versuche es gleich erneut.",
  errorUnknown: "Die Aktion konnte nicht abgeschlossen werden.",
} as const;
