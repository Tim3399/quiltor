// Truly generic, domain-independent UI vocabulary — not tied to any single feature area.
// Feature-specific phrasing (even if reused across features) belongs in shared.ts instead.
export const common = {
  ready: "Bereit",
  name: "Name",
  unknown: "Unbekannt",
  untitled: "Ohne Titel",
  toolbarMoreActions: "Weitere Aktionen",
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
  errorStorageSchemaNewer:
    "Diese Daten stammen aus einer neueren Quiltor-Version. Aktualisiere Quiltor und versuche es erneut. Dein aktueller Stand bleibt unverändert.",
  errorBackupPreviewFailed:
    "Die Sicherung konnte nicht für die Vorschau geöffnet werden. Sie wurde möglicherweise beschädigt.",
  errorBackupContentIntegrity:
    "Diese Version ist beschädigt und lässt sich nicht wiederherstellen. Dein aktueller Stand ist unverändert.",
  errorBackupContentUnavailable:
    "Der Inhalt dieser Version konnte nicht abgerufen werden. Dein aktueller Stand ist unverändert.",
  errorSyncForbiddenHosted:
    "Auf diesem Server gibt es keinen Abgleich mit anderen Geräten. Deine Versionen liegen bereits auf dem Server.",
  errorWorldPreview:
    "Die Beispielwelt wird erst gesichert und abgeglichen, wenn du etwas an ihr änderst.",
  errorExampleWorldFailed: "Die Beispielwelt konnte nicht geöffnet werden.",
  errorWorldQuota:
    "Du hast die Höchstzahl an Welten oder den Speicherplatz für deine Welten erreicht. Lösche eine Welt oder leere den Papierkorb, um eine neue anzulegen.",
  errorServerBusy: "Der Server ist gerade ausgelastet. Versuche es gleich erneut.",
  errorInstallForbiddenHosted:
    "Auf diesem Server richtet der Betreiber Erweiterungen ein. Hier lässt sich nichts nachinstallieren.",
  errorSyncTargetInvalid:
    "Diese Adresse passt nicht. Gib eine Adresse mit https:// ein, zum Beispiel https://abgleich.example.org.",
  errorUnknown: "Die Aktion konnte nicht abgeschlossen werden.",
} as const;
