# Sync, Backup und lokale Daten

Wo deine Projekte liegen, wie Zugriff und Anmeldung funktionieren und wie ein Backup-Server mit Keycloak angebunden wird.

## Local-first heißt: dein Projekt gehört dir

Im lokalen Betrieb braucht Quiltor keinen Cloud-Account.

**Lokal und kostenlos im Rahmen der [Lizenz](../../README.md#status-und-lizenz). Kein Abo zum Schreiben.**

Jede Welt ist eine eigene SQLite-Datenbank auf deinem Rechner. Manuskript und Profile werden zusätzlich als lesbare Markdown-Spiegel ausgegeben. Automatische lokale Sicherungen und ein Versionsverlauf gehören zum Projektmodell.

Ein Remote-Backup ist optional und kann über einen eigenen Backup-Endpunkt betrieben werden.

Der kostenlose manuelle Projekttransfer als `.quiltor` überträgt den aktuellen
Projektinhalt einschließlich zurückgestellter Kapitel, Kapitelpapierkorb und benötigter
Bilder. Der Import erstellt eine neue Welt. Frühere Sicherungen und der Versionsverlauf
sind ausdrücklich nicht enthalten; für deren Wiederherstellung gibt es die Sicherungs-
und Verlaufsfunktionen. Der gewöhnliche Buchexport enthält nur Kapitel im Buch.

Eine erfolgreiche lokale Speicherung, eine wiederherstellbare Sicherung und eine Übertragung
an einen Backup-Server sind getrennte Vorgänge. Unter **Mehr → Versionen & Sicherungen**
gleicht im Reiter **Mit anderen Geräten abgleichen** die Schaltfläche **Jetzt synchronisieren**
ein Projekt mit einem kompatiblen Cloud-Endpunkt ab.
Bei konkurrierenden Änderungen oder Löschung gegen Offline-Bearbeitung bleiben die Fassungen
erhalten und erfordern eine ausdrückliche Auswahl. Es gibt keine automatische Übertragung
im Hintergrund und keine automatische Textzusammenführung. Ein ausgefallener Cloud-Endpunkt
sperrt den lokalen Editor nicht. Einrichtungen und Betriebsgrenzen beschreibt die
[Anleitung zum Cloud-Dienst](../../services/backup-server/README.md).

Ein kostenpflichtiges gehostetes Cloud-Angebot mit festem Preis, Kontingent und
Aufbewahrungsfrist ist noch nicht festgelegt. Daher gibt es hier auch keine Zusage zu
Kündigungsfristen, Ende-zu-Ende-Verschlüsselung oder Hostingregionen. Die Bedingungen eines
selbst betriebenen Endpunkts bestimmt dessen Betreiber. Bei einem gehosteten Webbetrieb
liegen die Projektdaten auf dem jeweiligen Server; das ist ein anderer Speicherort als
die lokale Werkstatt auf deinem Rechner.

Auch der lokale Assistent bleibt lokal:

- Modell-Runtime auf Loopback
- keine allgemeine Cloud-AI-Abhängigkeit
- externe LanguageTool-Dienste nur nach ausdrücklichem Opt-in
- keine Manuskript-Schreibtools im Assistant oder MCP

## Lokaler Zugriff und Authentifizierung

Es gibt keinen Modus „Authentifizierung aus“. Jede Anfrage besitzt eine Identität; lokal ist diese Identität einfach die Person an diesem Rechner.

Ohne `QUILTOR_OIDC_ISSUER` gilt die **lokale Identität**:

- ein Nutzer
- keine Login-Seite
- keine Kontenverwaltung

Zugriff wird in dieser Reihenfolge erkannt:

1. `Authorization: Bearer <token>` – für Skripte und MCP
2. `?token=<token>` – einmaliger Browser-Einstieg; die Weiterleitung entfernt den Parameter wieder
3. Loopback-Verbindung – Standardfall für Desktop-App, CLI und `python3 apps/web/server.py`

Das automatisch generierte Token:

- entsteht bei jedem Prozessstart neu
- lebt nur im Arbeitsspeicher
- wird nicht auf die Festplatte geschrieben
- wird nur mit `--print-token` ausgegeben

| Variable               | Zweck                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `QUILTOR_MASTER_TOKEN` | Gibt das Token fest vor. Für Tests bzw. Instanzen ohne Loopback-Bindung. Nicht in `~/.quiltor/config.env` speichern. |
| `QUILTOR_HOST`         | Bind-Adresse; Standard `127.0.0.1`.                                                                                  |

Eine Instanz auf `0.0.0.0` ohne OIDC kann sich nicht auf die lokale Loopback-Identität verlassen und verlangt daher ein Token. Für dauerhafte Web-Bereitstellung ist OIDC/Keycloak der vorgesehene Weg.

### Problembehebung

| Symptom                                           | Lösung                                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `python3: command not found`                      | Unter Windows den installierten Python-Launcher mit `py -3.12` verwenden, in einer aktivierten virtuellen Umgebung `python`. |
| Assistent meldet „Lokales Modell nicht verfügbar“ | `PYTHONPATH=src python3 -m quiltor.infrastructure.inference.installer` ausführen und Server neu starten.                     |
| Download bricht ab                                | Installer erneut starten; vorhandene vollständige Dateien werden wiederverwendet.                                            |
| Firewall/Virenscanner meldet `llama-server.exe`   | Die Binärdatei stammt aus dem offiziellen llama.cpp-Release und lauscht lokal.                                               |
| Port 8000 belegt                                  | `python3 apps/web/server.py 8080`                                                                                            |
| Andere Runtime / anderes Modell                   | `QUILTOR_AI_BINARY`, `QUILTOR_AI_MODEL` oder `QUILTOR_AI_URL` verwenden.                                                     |

## Backup und Keycloak

Keycloak kommt in zwei voneinander getrennten Rollen vor:

|           | Login an Quiltor                     | Backup-Endpunkt                                |
| --------- | ------------------------------------ | ---------------------------------------------- |
| Zweck     | Mehrbenutzer-Webinstanz              | Zugriff auf Remote-Backup                      |
| Pflicht   | Nein                                 | Für den bereitgestellten Backup-Endpunkt ja    |
| Client    | vertraulich                          | Backup-Server vertraulich + Quiltor öffentlich |
| Redirect  | `<QUILTOR_PUBLIC_URL>/auth/callback` | `http://127.0.0.1/*`                           |
| Variablen | `QUILTOR_OIDC_*`                     | `QUILTOR_BACKUP_OIDC_*`                        |

Die beiden Wege dürfen dieselbe Realm verwenden, sind aber technisch getrennt.

### Backup-Server: vertraulicher Client

Beispielname:

```text
quiltor-backup-server
```

Einstellungen:

- Client authentication: on
- Standard Flow: off
- Direct Access Grants: off

Der Backup-Server validiert eingehende Access-Tokens über Keycloak Token Introspection.

### Quiltor: öffentlicher Backup-Client

Beispiel:

```text
quiltor-desktop
```

Einstellungen:

- Client authentication: off
- Standard Flow: on
- Direct Access Grants: off
- PKCE: `S256`
- Redirect URI: `http://127.0.0.1/*`

Der wechselnde Loopback-Port ist beabsichtigt. Native Anwendungen sollen nach RFC 8252 dynamische Loopback-Ports verwenden können; deshalb darf der Keycloak-Client nicht auf einen einzigen festen Port eingeschränkt werden.

### Scope `quiltor.backup`

Der bereitgestellte Backup-Endpunkt verlangt standardmäßig den Scope:

```text
quiltor.backup
```

Dadurch reicht nicht irgendein gültiges Token derselben Realm. Nur ein Token, das für diesen Zugriff vorgesehen ist, wird akzeptiert.

Optional kann zusätzlich eine Realm-Rolle verwendet werden, um den Scope nur ausgewählten Konten verfügbar zu machen.

### Backup-Server-Variablen

| Variable                            | Zweck                                       |
| ----------------------------------- | ------------------------------------------- |
| `QUILTOR_BACKUP_OIDC_ISSUER`        | Realm-Issuer                                |
| `QUILTOR_BACKUP_OIDC_CLIENT_ID`     | Client-ID des Backup-Servers                |
| `QUILTOR_BACKUP_OIDC_CLIENT_SECRET` | Client-Secret für Introspection             |
| `QUILTOR_BACKUP_PUBLIC_URL`         | Öffentliche URL des Backup-Endpunkts        |
| `QUILTOR_BACKUP_OIDC_SCOPE`         | Benötigter Scope; Standard `quiltor.backup` |

Fehlen notwendige Authentifizierungswerte, startet der Backup-Endpunkt bewusst nicht.

Beispiel:

```bash
# Backup-Server
QUILTOR_BACKUP_OIDC_ISSUER=https://kc.example.com/realms/quiltor
QUILTOR_BACKUP_OIDC_CLIENT_ID=quiltor-backup-server
QUILTOR_BACKUP_OIDC_CLIENT_SECRET=...
QUILTOR_BACKUP_PUBLIC_URL=https://backup.quiltor.app
QUILTOR_BACKUP_OIDC_SCOPE=quiltor.backup

# Quiltor
QUILTOR_BACKUP_URL=https://backup.quiltor.app
QUILTOR_BACKUP_CLIENT_ID=quiltor-desktop
```

Der Client muss den Keycloak-Issuer des Backup-Dienstes nicht doppelt konfigurieren. Der Endpoint veröffentlicht seine Autorisierungsinformationen über:

```text
GET /.well-known/oauth-protected-resource
```

Quiltor liest diese Metadaten vor dem Login.

### Backup-Fehlerdiagnose

| Symptom                                              | Wahrscheinliche Ursache                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| Keycloak-Fehlerseite, Quiltor erhält keinen Callback | Loopback-Redirect fehlt oder ist auf einen festen Port beschränkt          |
| Endpoint antwortet 401                               | Token fehlt oder ist abgelaufen                                            |
| Endpoint antwortet 403                               | Token ist gültig, trägt aber nicht den erforderlichen Scope                |
| Introspection schlägt fehl                           | Token und `QUILTOR_BACKUP_OIDC_ISSUER` gehören zu unterschiedlichen Realms |

## Lokale Daten, Verlauf und Wiederherstellung

- Jede Welt besitzt eine eigene SQLite-Datei unter `data/worlds/`.
- SQLite ist die maßgebliche Datenquelle.
- Manuskript- und Profil-Spiegel liegen je Welt unter `data/manuscripts/<welt-id>/` und `data/profiles/<welt-id>/`.
- Automatische SQLite-Sicherungen sind lokal wiederherstellbar.
- Revisionsprüfungen schützen vor Überschreiben durch veraltete Browser-Tabs.
- Jede Welt führt einen lokalen Versionsverlauf.
- Snapshots sind inhaltsadressiert; unveränderte Kapitel müssen nicht erneut gespeichert werden.
- Remote-Backup ist optional.
- Weltinhalte, Modelle, Backups und Verlauf werden nicht öffentlich versioniert.

### Hinweise beim Upgrade älterer Versionen

Aktuelle Builds verwenden immer eine Identität. Lokal übernimmt die lokale Identität; nicht auf Loopback gebundene Instanzen ohne OIDC benötigen ein Token.

Markdown-Spiegel sind inzwischen pro Welt organisiert. Ältere flache Spiegeldateien werden nicht als maßgebliche Datenquelle betrachtet; SQLite bleibt autoritativ.

Der Server besitzt keinen globalen Zustand „diese Welt ist gerade geöffnet“. Eine Wiederherstellung muss daher nicht erst einen prozessweiten Open-World-State schließen.
