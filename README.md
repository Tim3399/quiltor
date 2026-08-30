# Quiltor

[Deutsch](README.md) · [English](README.en.md)

> ## Du schreibst die Geschichte. Quiltor hält die Welt zusammen.
>
> **Eine local-first Autorenwerkstatt für Menschen, die selbst schreiben wollen.**  
> Manuskript, Figuren, Beziehungen, Orte und Timeline an einem Ort – mit lokaler KI für die Arbeit **rund um** das Schreiben, niemals für das Schreiben selbst.

![Quiltor Manuskriptansicht](docs/screenshots/manuscript.png)

Quiltor ist eine Schreibumgebung für Romane und andere lange fiktionale Projekte. Statt Manuskript, Figurenlisten, Timeline, Karten und Notizen über mehrere Anwendungen zu verteilen, verbindet Quiltor sie zu einer gemeinsamen Welt.

Der lokale Assistent darf diese Welt verstehen, durchsuchen und strukturierte Änderungen vorschlagen. **Er besitzt bewusst kein Werkzeug, um Romanprosa zu schreiben, fortzusetzen oder umzuschreiben.**

**Local-first · On-device AI · macOS / Windows / Browser · Source-available**

[**Schnellstart**](#schnellstart) · [**Features**](#eine-autorenwerkstatt-statt-eines-ai-ghostwriters) · [**Technische Dokumentation**](#technische-dokumentation) · [**Releases**](https://github.com/Tim3399/quiltor/releases)

---

## Eine Autorenwerkstatt statt eines AI-Ghostwriters

Viele AI-Schreibwerkzeuge versuchen, möglichst viel vom eigentlichen Schreiben zu übernehmen. Quiltor geht bewusst in die andere Richtung.

> **AI für die Arbeit rund ums Schreiben. Nie für das Schreiben selbst.**

Du schreibst jeden Satz. Quiltor hilft dabei, dass du dich weniger mit Verwaltung beschäftigen musst:

- Figuren, Tiere, Orte, Organisationen, Objekte und Konzepte an einem Ort pflegen
- Beziehungen visualisieren und über die Zeit verändern
- Aufenthalte und Reisen von Figuren nachvollziehen
- Orte auf einer eigenen Karte anordnen und Distanzen messen
- Timeline und Lebensereignisse verwalten
- Manuskript, Kapitelnotizen und Weltwissen gemeinsam durchsuchen
- Rechtschreibung, Grammatik, Synonyme und Wortübersetzungen lokal nutzen
- vom Assistenten strukturierte Änderungen vorbereiten lassen und **selbst bestätigen**

Der Autor bleibt immer die letzte Instanz.

---

## Eine Welt statt verstreuter Notizen

Quiltor behandelt Weltwissen nicht als lose Sammlung von Textfeldern. Figuren, Orte, Beziehungen und Timeline hängen zusammen und verwenden dieselben Daten.

### Manuskript: ruhig schreiben

Der Kapitel-Editor hält sich zurück und gibt dem Text Platz. Fokusmodus, Undo/Redo, Kapitelnotizen, Versionsverlauf, diskrete Schreibhilfen und Ein-Wort-Autocomplete unterstützen den Schreibprozess, ohne ihn zu übernehmen.

Das fertige Manuskript kann als lesbares Buch-PDF im 6 × 9-Zoll-Format ausgegeben werden.
#ToDo Bild einfügen

### Figuren und Beziehungen: sehen, was zusammengehört

Figuren und andere Weltelemente leben in einem visuellen Graphen. Beziehungen können gerichtet oder ungerichtet sein, ihre Bedeutung ändern, beginnen oder enden.

![Quiltor Weltgraph](docs/screenshots/world-graph.png)

Der Graph ist keine separate Kopie deiner Daten: Timeline, Beziehungen und Elemente greifen auf denselben Zustand zu.

### Orte: die Welt räumlich verstehen

Orte bekommen eine eigene Kartenansicht und können frei positioniert werden – unabhängig davon, wo sie im Weltgraphen liegen.

Ein Lineal misst Distanzen zwischen Orten und rechnet sie über einen frei einstellbaren Maßstab in deine eigenen Einheiten um.

![Quiltor Kartenansicht der Orte mit Distanzmessung](docs/screenshots/places.png)

Aus den Präsenzdaten der Timeline entstehen automatisch:

- Aufenthaltschroniken pro Ort
- Reiseverläufe pro Figur
- zeitliche Abstände zwischen Ortswechseln

### Timeline: Beziehungen und Weltzustand verändern sich

Geschichten sind nicht statisch. Eine Freundschaft kann zerbrechen, eine Figur kann umziehen, ein Objekt kann relevant werden und eine Figur kann sterben.

Quiltor modelliert solche Änderungen entlang der Timeline, statt nur den letzten Zustand zu speichern.

![Animierte Timeline im Figurenboard](docs/screenshots/timeline-playback.png)

Die eigenständige Timeline-Seite ist für die Pflege optimiert: Zeitpunkte sortieren, Notizen hinterlegen, Beziehungszustände verändern und Lebensereignisse markieren.

![Timeline-Verwaltung](docs/screenshots/timeline-manager.png)

---

## Ein lokaler Assistent, der dein Buch nicht schreiben kann

Der Assistent arbeitet mit einem lokalen Modell über `llama.cpp` oder – auf Apple Silicon – MLX.

Er kann:

- Manuskript und Weltwissen durchsuchen
- Fragen zur Geschichte beantworten
- Quellen im Projekt zitieren
- Figuren, Orte, Beziehungen und Timeline-Zustände analysieren
- strukturierte Änderungen als Vorschläge vorbereiten
- breite Aufgaben kapitelweise in Gruppen verarbeiten

Er kann **nicht**:

- eine Szene schreiben
- ein Kapitel fortsetzen
- Prosa umschreiben
- Änderungen unbemerkt anwenden

Änderungen an Weltwissen erscheinen als prüfbare Vorschläge. Erst eine ausdrückliche Bestätigung übernimmt sie in den Projektzustand und macht sie als einen Undo-Schritt rückgängig.

Das Manuskript bleibt dabei lesbarer Kontext – nie Schreibfläche für den Assistenten.

---

## Local-first heißt: dein Projekt gehört dir

Im lokalen Betrieb braucht Quiltor keinen Cloud-Account.

Jede Welt ist eine eigene SQLite-Datenbank auf deinem Rechner. Manuskript und Profile werden zusätzlich als lesbare Markdown-Spiegel ausgegeben. Automatische lokale Sicherungen und ein Versionsverlauf gehören zum Projektmodell.

Ein Remote-Backup ist optional und kann über einen eigenen Backup-Endpunkt betrieben werden.

Auch der lokale Assistent bleibt lokal:

- Modell-Runtime auf Loopback
- keine allgemeine Cloud-AI-Abhängigkeit
- externe LanguageTool-Dienste nur nach ausdrücklichem Opt-in
- keine Manuskript-Schreibtools im Assistant oder MCP

---

## Was heute enthalten ist

| Schreiben              | Weltwissen                     | Orte                 | Zeit                      | Assistenz                |
| ---------------------- | ------------------------------ | -------------------- | ------------------------- | ------------------------ |
| Kapitel-Editor         | Figuren & weitere Elementtypen | Eigene Kartenansicht | Eigene Timeline-Seite     | Lokales LLM              |
| Fokusmodus             | Profile & eigene Felder        | Freie Positionierung | Zeitabhängige Beziehungen | Quellen im Projekt       |
| Kapitelnotizen         | Visueller Beziehungsgraph      | Distanzmessung       | Presence / Aufenthalte    | Strukturierte Vorschläge |
| Undo/Redo & Verlauf    | Gerichtete Beziehungen         | Reisechroniken       | Todeszeitpunkte           | Batch-Verarbeitung       |
| Buch-PDF               | Minimap & semantischer Zoom    | Eigener Maßstab      | Playback im Graphen       | Proposal-only MCP        |
| Deutsche Schreibhilfen | Wichtige / gepinnte Elemente   |                      |                           | Keine Prosa-Generation   |

---

## Für wen ist Quiltor?

Quiltor ist besonders interessant, wenn du:

- selbst schreiben willst und AI nicht als Ghostwriter suchst
- an längeren Romanen oder Serien arbeitest
- viele Figuren, Orte und Beziehungen im Blick behalten musst
- Timeline und Weltwissen nicht in separaten Tabellen pflegen willst
- deine Manuskripte und Weltinformationen lokal halten möchtest
- gern visuell arbeitest, aber trotzdem ein echtes Schreibprogramm brauchst

Quiltor befindet sich in aktiver Entwicklung. Der Schwerpunkt liegt auf einem ruhigen Schreibworkflow, einer zusammenhängenden fiktionalen Welt und nachvollziehbarer lokaler Assistenz.

---

# Schnellstart

Voraussetzung: **Python 3.11+**.

```bash
git clone https://github.com/Tim3399/quiltor.git
cd quiltor
python3 apps/web/server.py
```

Unter Windows heißt der Python-Befehl häufig `python` statt `python3`.

Quiltor öffnet standardmäßig `http://localhost:8000` und legt beim ersten Start eine leere Welt an. Wenn noch kein lokaler Assistent eingerichtet ist, fragt Quiltor vor einem Download nach; ohne Assistent funktioniert der Rest der Anwendung weiterhin.

Alternativ stehen CLI/Python-Pakete, Desktop-Builds und Docker-Betrieb zur Verfügung. Details folgen unten.

---

# Technische Dokumentation

Die folgenden Abschnitte beschreiben Installation, lokale Runtime, Authentifizierung, Backup, Desktop-/Docker-Betrieb, MCP, Entwicklung und Architektur.

## Inhaltsübersicht

- [Installationswege](#installationswege)
- [Lokaler Assistent und Runtime-Vertrag](#lokaler-assistent-und-runtime-vertrag)
- [MCP](#mcp)
- [Deutsche Schreibwerkzeuge](#deutsche-schreibwerkzeuge)
- [Lokaler Zugriff und Authentifizierung](#lokaler-zugriff-und-authentifizierung)
- [Desktop-App](#desktop-app)
- [Docker und Web-Demo](#docker-und-web-demo)
- [CLI](#cli)
- [Backup und Keycloak](#backup-und-keycloak)
- [Lokale Daten, Verlauf und Wiederherstellung](#lokale-daten-verlauf-und-wiederherstellung)
- [Bedienung](#bedienung)
- [Entwicklung und Qualität](#entwicklung-und-qualität)
- [Architektur](#architektur)
- [Status und Lizenz](#status-und-lizenz)

---

## Installationswege

### Direkt aus dem Repository

Der gebaute Web-Client liegt bereits in `dist/`. Für Editor und lokale Speicherung sind keine Node-Abhängigkeiten erforderlich.

```bash
git clone https://github.com/Tim3399/quiltor.git
cd quiltor
python3 apps/web/server.py
```

Weitere Startoptionen:

```bash
python3 apps/web/server.py 8080            # anderer Port
python3 apps/web/server.py 8080 --no-open  # Browser nicht automatisch öffnen
python3 apps/web/server.py --print-token   # Zugriffstoken dieses Starts anzeigen
```

### Python-Wheel / pip / pipx

Jedes [GitHub Release](https://github.com/Tim3399/quiltor/releases) enthält ein Python-Wheel.

```bash
pip install quiltor-<version>-py3-none-any.whl
quiltor
```

Das Paket benötigt Python 3.11 oder neuer. Der eigentliche Serverpfad bleibt bewusst leichtgewichtig; für das gepackte CLI wird `typer` verwendet.

Der Basis-Wheel meldet PDF-Export bewusst als nicht verfügbar, statt heimlich
eine Browser-Runtime nachzuladen. Für PDF-Export aus dem **installierten Wheel**
das geprüfte Extra installieren (URL und Version entsprechend dem Release):

```bash
python -m pip install "quiltor[browser-pdf] @ https://github.com/Tim3399/quiltor/releases/download/v<version>/quiltor-<version>-py3-none-any.whl"
```

Das Extra pinnt die auf PyPI verfügbare Python-Bibliothek Playwright 1.61.0 und
steuert einen bereits installierten Google Chrome oder Microsoft Edge; ein
System-Node.js und ein separater
Chromium-Download sind dafür nicht nötig. Fehlen Extra oder Browser, bleibt der
Export mit einer klaren Verfügbarkeitsmeldung deaktiviert.
Der selbst gehostete OCI-Host ist ein getrennter Artefaktpfad: Er verwendet die
npm-/Browser-Runtime Playwright 1.61.1 aus dem digest-gebundenen Basis-Image.
Beide Pins sind getrennt in `distribution/toolchains.json` festgeschrieben und
werden im Release-Gate gegen die tatsächlich installierten Artefakte geprüft.
Der Wheel-Host löst Web-Assets und das mitgelieferte Render-Skript ausschließlich
aus den Paketressourcen auf; er fällt nicht auf einen zufällig vorhandenen
Quellbaum zurück. Die Capability-Auswahl bleibt davon getrennt: ohne Extra wird
deterministisch der typisierte Nicht-verfügbar-Renderer verwendet.

### Entwicklung

Ein Start direkt aus dem **Quellbaum** nutzt dagegen das mitgelieferte
JavaScript-Render-Skript. Für Frontend-Entwicklung und diesen PDF-Pfad werden
Node.js, die Projektabhängigkeiten und der geprüfte Chromium benötigt:

```bash
npm install
npx playwright install chromium
npm run dev
```

Parallel:

```bash
python3 apps/web/server.py --no-open
```

Vite leitet API-Anfragen an Port 8000 weiter.

---

## Lokaler Assistent und Runtime-Vertrag

Der Assistent durchsucht Kapitel, Notizen, Profile, Elemente, Beziehungen und Timeline-Zustände als lokalen Wissenskorpus. Antworten können auf anklickbare Projektquellen verweisen.

Die Modell-Runtime verwendet:

- `llama.cpp`
- auf Apple-Silicon-Macs optional MLX

Beim ersten Start kann Quiltor die passende Runtime und das Modell nach Zustimmung automatisch einrichten. Die Daten landen bei einem direkten Repository-Start unter `runtime/` und `models/`.

Explizite Installation:

```bash
PYTHONPATH=src python3 -m quiltor.infrastructure.inference.installer
```

Eine vorhandene Runtime bzw. ein anderes GGUF-Modell kann erzwungen werden:

```bash
QUILTOR_AI_BINARY=/pfad/zu/llama-server \
QUILTOR_AI_MODEL=/pfad/zu/model.gguf \
python3 apps/web/server.py
```

Oder ein bereits laufender lokaler Endpoint:

```bash
QUILTOR_AI_URL=http://127.0.0.1:11435 python3 apps/web/server.py
```

### Runtime-Vertrag

`QUILTOR_AI_URL` ist **keine allgemeine OpenAI-Provider-Integration**. Die Runtime muss Quiltors stabilen lokalen Vertrag erfüllen:

```text
GET  /health
POST /tokenize
POST /v1/chat/completions
```

`/v1/chat/completions` muss die von Quiltor angeforderten strikten JSON-Schemas tatsächlich erzwingen.

Die gebündelten Runtime-Backends verwenden aktuell ein Kontextfenster von 8192 Tokens. Anfragen an die gebündelte Runtime bleiben auf Loopback.

### Lokalen Assistenten real testen

```bash
npm run test:assistant:local
npm run test:assistant:local -- --runs 3
npm run test:assistant:local -- --case set-presence
```

Der Test startet Runtime, Testwelt und Quiltor in einem isolierten temporären Verzeichnis und beendet die Prozesse anschließend wieder.

---

## MCP

`src/quiltor/hosts/mcp/quiltor_server.py` stellt Retrieval und Weltpflege als MCP-Server bereit.

Der Sicherheitsgrundsatz ist derselbe wie im eingebauten Assistenten:

- Lesen ist erlaubt
- Änderungen werden nur als Vorschläge erzeugt
- Anwendung erfolgt in Quiltor nach Bestätigung

Absichtlich **nicht** vorhanden sind direkte:

- Apply-Tools
- Delete-Tools
- Backup-/Filesystem-Tools
- Manuskript-Schreibtools

Die mitgelieferte `.mcp.json` konfiguriert den Server über den plattformneutralen
`quiltor-mcp`-Befehl. Nach `python -m pip install -e .` funktioniert dieselbe
Projektkonfiguration unter Windows, macOS und Linux.

---

## Deutsche Schreibwerkzeuge

Für Manuskripte mit Schreibsprache `de-DE` stehen lokal zur Verfügung:

- Wörterbuch
- Synonyme
- Wortübersetzung
- Rechtschreibprüfung
- Grammatikprüfung

Markierter Text kann nachgeschlagen werden. Einfügen, Ersetzen und Korrigieren geschieht erst nach einer ausdrücklichen Aktion und bleibt per Undo rückgängig machbar.

Das geführte Setup installiert die Sprachwerkzeuge standardmäßig:

```bash
quiltor install
```

Daten liegen unter:

```text
data/writing-assistance/
```

bei pipx/CLI-Installationen standardmäßig unter:

```text
~/.quiltor/data/writing-assistance/
```

Bestehende Daten aus dem früheren Verzeichnis `data/language/` werden beim ersten Start
automatisch und sicher übernommen; ein manueller Umzug ist nicht nötig.

LanguageTool benötigt **Java 17+**. Ohne LanguageTool bleibt die Rechtschreibprüfung des Browsers verfügbar.

Externe LanguageTool-kompatible Dienste werden ausschließlich verwendet, wenn:

```bash
QUILTOR_LANGUAGETOOL_EXTERNAL_OPT_IN=1
```

gesetzt ist. Ohne Opt-in verlassen Kapiteltexte und Suchbegriffe für diese Funktion das Gerät nicht.

Quellen, Versionen, Checksummen, Lizenzen und Attributionen stehen im Installationsmanifest und in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

---

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

| Symptom                                           | Lösung                                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `python3: command not found`                      | Unter Windows meist `python` verwenden.                                                                  |
| Assistent meldet „Lokales Modell nicht verfügbar“ | `PYTHONPATH=src python3 -m quiltor.infrastructure.inference.installer` ausführen und Server neu starten. |
| Download bricht ab                                | Installer erneut starten; vorhandene vollständige Dateien werden wiederverwendet.                        |
| Firewall/Virenscanner meldet `llama-server.exe`   | Die Binärdatei stammt aus dem offiziellen llama.cpp-Release und lauscht lokal.                           |
| Port 8000 belegt                                  | `python3 apps/web/server.py 8080`                                                                        |
| Andere Runtime / anderes Modell                   | `QUILTOR_AI_BINARY`, `QUILTOR_AI_MODEL` oder `QUILTOR_AI_URL` verwenden.                                 |

---

## Desktop-App

Quiltor kann unter macOS und Windows als eigenständige Fensteranwendung gebaut werden – ohne Browser-Tab und ohne separate Python-Installation auf dem Zielsystem.

```bash
python -m venv .venv-desktop
source .venv-desktop/bin/activate  # Windows: .venv-desktop\Scripts\activate
pip install -e ".[desktop]" pyinstaller
```

Builds:

```bash
./distribution/desktop/macos/direct/build.sh
powershell -File distribution/desktop/windows/direct/build.ps1
```

Ergebnis:

```text
macOS   distribution/artifacts/macos-direct/Quiltor-<version>.dmg
Windows distribution/artifacts/windows-direct/Quiltor-Setup-<version>.exe
```

Standardmäßig sind lokale Builds unsigniert.

macOS signiert und notarisiert automatisch, wenn gesetzt:

```text
QUILTOR_SIGN_IDENTITY
QUILTOR_NOTARY_PROFILE
```

PDF-Export nutzt einen vorhandenen Systembrowser bzw. die jeweilige Plattformimplementierung, statt unnötig einen vollständigen Browser mit jedem Desktop-Build auszuliefern.

Weitere Details und die vollständige Zielmatrix: [`distribution/README.md`](distribution/README.md)

---

## Docker und Web-Demo

Quiltor kann als kleine Mehrbenutzer-Instanz hinter einem Reverse Proxy betrieben werden. In diesem Modus authentifiziert eine bestehende Keycloak-Instanz die Nutzer; jede Person sieht nur ihre eigenen Welten.

Quiltor bringt **kein eigenes Keycloak** mit.

### Keycloak-Client für die Web-Instanz

Empfohlene Einstellungen:

- Client authentication: **on**
- Standard Flow: **on**
- Direct Access Grants: **off**
- Redirect URI: `https://<deine-domain>/auth/callback`
- PKCE: `S256`

Umgebungsvariablen:

| Variable                     | Zweck                                                       |
| ---------------------------- | ----------------------------------------------------------- |
| `QUILTOR_OIDC_ISSUER`        | Realm-Issuer, z. B. `https://kc.example.com/realms/quiltor` |
| `QUILTOR_OIDC_CLIENT_ID`     | Client-ID                                                   |
| `QUILTOR_OIDC_CLIENT_SECRET` | Client-Secret                                               |
| `QUILTOR_PUBLIC_URL`         | Öffentliche Quiltor-URL                                     |
| `QUILTOR_COOKIE_SECURE`      | `auto` / `0` / `1`                                          |
| `QUILTOR_HOST`               | Bind-Adresse                                                |
| `QUILTOR_MASTER_TOKEN`       | Nur ohne OIDC relevant                                      |
| `QUILTOR_DATA_DIR`           | Datenverzeichnis im Container                               |

Start:

```bash
cp .env.example .env
docker compose up -d
```

Der Compose-Dienst bindet standardmäßig lokal; ein bestehender Reverse Proxy kann auf Quiltor zeigen. Beispiele für Caddy und nginx liegen unter [`distribution/web/self-hosted/proxy/`](distribution/web/self-hosted/proxy/).

Optional kann der Stack Caddy selbst starten:

```bash
docker compose --profile with-caddy up -d
```

Caddy übernimmt dann TLS und leitet intern an `quiltor:8000` weiter.

Ohne Compose:

```bash
docker build ...
docker run ...
```

siehe [`Dockerfile`](Dockerfile).

Das Docker-Image enthält für den Buch-PDF-Export ausschließlich den zu
Playwright passenden Chromium Headless Shell. Firefox, WebKit, ein vollständiger
Chromium, das separate ffmpeg-Payload und die Entwicklungswerkzeuge bleiben
bewusst außerhalb des Runtime-Images. Der extrahierte Browser wird beim Build
zusätzlich gegen die festgeschriebene SHA-256-Prüfsumme geprüft.

Sitzungen liegen im Prozessspeicher. Ein Container-Neustart meldet Web-Nutzer daher ab.

### Fertige Container-Images

Ein Versions-Bump in `VERSION` auf `main` löst die Release-Pipeline aus. Images werden unter:

```text
ghcr.io/tim3399/quiltor:<version>
ghcr.io/tim3399/quiltor:latest
```

veröffentlicht.

---

## CLI

Das `quiltor`-CLI ist bei pip/pipx-Installationen verfügbar.

Standardpfad für Daten, Runtime und Modell:

```text
~/.quiltor/
```

Übersteuerbar mit:

```text
QUILTOR_HOME
```

Wichtige Befehle:

```bash
quiltor install
quiltor
quiltor run 8080
quiltor run --print-token

quiltor config set <KEY> <VALUE>
quiltor config get <KEY>
quiltor config list
quiltor config unset <KEY>
quiltor config path

quiltor --version
```

`quiltor install` führt durch die lokale Einrichtung. Keycloak ist standardmäßig optional; deutsche Schreibwerkzeuge und lokaler Assistent können direkt mit installiert werden.

Für Docker bleiben Umgebungsvariablen der primäre Konfigurationsweg.

---

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
QUILTOR_BACKUP_PUBLIC_URL=https://backup.example.com
QUILTOR_BACKUP_OIDC_SCOPE=quiltor.backup

# Quiltor
QUILTOR_BACKUP_URL=https://backup.example.com
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

---

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

---

## Bedienung

| Kürzel                             | Aktion                            |
| ---------------------------------- | --------------------------------- |
| `Cmd/Ctrl + S`                     | Sofort speichern                  |
| `Cmd/Ctrl + Shift + S`             | Backup-Dialog                     |
| `Cmd/Ctrl + F` oder `Cmd/Ctrl + K` | Suche & Befehle                   |
| `Cmd/Ctrl + Z`                     | Rückgängig                        |
| `Cmd/Ctrl + Shift + Z`             | Wiederholen                       |
| `Esc`                              | Fokus-/temporären Modus verlassen |
| `Option/Alt` beim Ziehen           | Raster vorübergehend lösen        |

---

## Entwicklung und Qualität

```bash
npm test
npm run build
python3 -m unittest discover -s tests/python -t . -v
npm run test:e2e
```

Der Build prüft unter anderem:

- TypeScript
- Design-Token-Regeln
- i18n-Schlüsselparität
- hardcodierte sichtbare UI-Texte
- gebauten Client

Browser-/E2E-Tests decken Kernworkspaces, Desktop-/Compact-Layouts, Light/Dark Mode, Autosave, Konflikte und Accessibility ab.

Internationalisierungsprüfung:

```bash
npm run check:i18n
```

Sichtbare UI-Texte und neue Sprachpakete gehören in den absichtlich gut sichtbaren Root-Ordner:

```text
locales/{de,en,...}/*.ts
```

Für beispielsweise Spanisch kommt zum neuen Ordner genau ein gut sichtbarer Import samt
`localePackages`-Eintrag in [`locales/index.ts`](locales/index.ts). Weitere Registry- oder
UI-Codeänderungen sind nicht nötig; der i18n-Check erzwingt automatisch die Übereinstimmung von
Ordnern und Registry. Die genaue Anleitung steht in [`CONTRIBUTING.md`](CONTRIBUTING.md).

README-Screenshots reproduzierbar erzeugen:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8125 node tools/documentation/capture_readme.mjs
```

---

## Architektur

```text
apps/                        sichtbare Shells und native Projektwurzeln
├── web/server.py            Source-Checkout-Bootstrap
└── mobile/{ios,android}/     native Mobile-Hosts

src/quiltor/
├── domain/story_world/      reine Weltlogik, Timeline und Validierung
├── application/             gemeinsame Use Cases und fachliche Ports
├── modules/                 Assistant, Schreibhilfe, Identität und Commerce
├── infrastructure/          SQLite, Backup, Inferenz, PDF und Plattformadapter
├── resources/sidecars/      ausgelieferte PDF-/Inferenz-Subprozesse
├── bootstrap/               Composition Root für konkrete Adapter
├── delivery/http/routes/    HTTP-Endpunkte nach Fachgebiet
└── hosts/                   Webserver, Desktop, CLI und MCP

services/backup-server/      eigenständig deploybarer Backup-Dienst
contracts/                   versionierte App- und Native-Bridge-Verträge
crates/                      portabler Rust-Core und FFI
distribution/                Zielprofile, Builds, Installer, Stores und Signierung
tools/                       Qualitäts-, Evaluations- und Dokumentationswerkzeuge

packages/client/src/
├── app/                     Composition, Shell, Session, Navigation und Overlays
├── config/                  App-Konfiguration und Branding
├── design/                  Design-Tokens und Präsentationsgrundlagen
├── i18n/                    Locale-Runtime, Provider und Katalog-Lader
├── modules/
│   ├── manuscript/          Editor und Schreibhilfen
│   ├── story-world/         Figuren, Orte, Timeline und Weltverwaltung
│   ├── assistant/           lokaler Assistent
│   ├── identity/            Anmeldung und Identität
│   ├── backup/              Wiederherstellung lokaler Sicherungen
│   ├── history/             Verlauf und Snapshots
│   ├── search/              Suche und Navigation
│   ├── notes/               verknüpfte Notizen
│   └── world-references/    Referenzprojektionen und Backlinks
├── platform/                App-Ports, HTTP-Transport und Host-Adapter
└── shared/                  ausschließlich fachneutrale Grundlagen

locales/                      leicht beitragbare UI-Sprachpakete
```

Die Abhängigkeitsrichtung ist bewusst:

```text
Hosts/Delivery → Application-Use-Cases → Domain
Bootstrap → Application-Ports + konkrete Infrastrukturadapter
Domain/Application ↛ Infrastruktur/Delivery/Hosts
```

Das normative Soll-Komponentenmodell samt Ist-Analyse steht in
[`docs/architecture/target-component-model.md`](docs/architecture/target-component-model.md).
Die freigegebene Umsetzungsreihenfolge, Komplexitäts-Trigger und Exit-Gates
stehen im
[`docs/architecture/implementation-plan.md`](docs/architecture/implementation-plan.md).

Der normale Serverpfad bleibt möglichst klein und lokal; zusätzliche Fähigkeiten werden über klar getrennte Module und Distribution-Extras ergänzt.

---

## Status und Lizenz

Quiltor befindet sich in aktiver Entwicklung.

Quiltor ist **source-available, nicht Open Source**. Der Quelltext ist öffentlich einsehbar, veränderbar und weitergebbar; kommerzielle Nutzung durch größere Organisationen ist eingeschränkt.

Es gilt wahlweise:

- [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)
- [PolyForm Small Business License 1.0.0](https://polyformproject.org/licenses/small-business/1.0.0)

Siehe [LICENSE](LICENSE).

### Kostenlos ohne Rückfrage

- nicht-kommerzielle Nutzung: private Projekte, Hobby, Studium, Lehre, Forschung, gemeinnützige Organisationen und öffentliche Einrichtungen
- kommerzielle Nutzung im Rahmen der PolyForm Small Business License: weniger als 100 Mitarbeitende/freie Mitarbeitende und weniger als 1.000.000 USD Umsatz im vorherigen Steuerjahr

Selbstständige Autorinnen und Autoren fallen praktisch immer unter diese Small-Business-Grenze.

Für kommerzielle Nutzung oberhalb dieser Grenze ist eine individuelle Vereinbarung erforderlich:

**tim.ratermann@outlook.de**

Details: [COMMERCIAL.md](COMMERCIAL.md)

Die Zusammenfassung ist unverbindlich; maßgeblich ist der englische Lizenztext in [LICENSE](LICENSE).

Release-Pakete enthalten zusätzlich Software und Modellgewichte Dritter unter eigenen Lizenzen. Siehe [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
