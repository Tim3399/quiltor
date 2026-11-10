# Installation und Betrieb

Wie Quiltor gestartet, installiert und betrieben wird: aus dem Quellcode, als Python-Paket, als Desktop-App, mit Docker und über die CLI.

## Schnellstart

Ohne technische Vorkenntnisse: [Installation und erste Schreibaufgaben](../ERSTE-SCHRITTE.md).
Die folgenden Befehle beschreiben den Start aus dem Quellcode.

Voraussetzung: **Python 3.12+**.

```bash
git clone https://github.com/Tim3399/quiltor.git
cd quiltor
python3 apps/web/server.py
```

Unter Windows mit installiertem Python-Launcher: `py -3.12 apps/web/server.py`.

Quiltor öffnet standardmäßig `http://localhost:8000`. Lege in der Weltauswahl mit **Neue Welt** dein erstes Projekt an. Der Start wartet nicht auf eine KI-Einrichtung und lädt kein Modell herunter. Den optionalen Assistenten richtest du später ausdrücklich in dessen Seitenleiste ein.

Öffne die Welt, wähle im Manuskript ein Kapitel oder lege eines an und beginne zu schreiben.
Den optionalen Backup-Endpunkt kannst du leer lassen. Modelldownload und Einrichtung des
Assistenten sind für diesen Weg nicht erforderlich. Die gemeinsame Suche findet Kapitel
und Weltelemente; die Analyse lässt sich später für das aktive Kapitel oder eine ausdrücklich
ausgewählte Kapitelmenge starten.

Alternativ stehen CLI/Python-Pakete, Desktop-Builds und Docker-Betrieb zur Verfügung. Details folgen unten.

## Plattformstand

Build-Profile beschreiben den Stand der Umsetzung. Sie versprechen nicht, dass es für jedes Release ein Artefakt gibt.

| Ziel                              | Stand                                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Browser / selbst gehostetes Web   | Python-HTTP-Host, eingecheckter Web-Client, Docker/OCI-Build und optionales OIDC implementiert                       |
| Python-Paket / CLI / MCP          | Wheel, Source-Archiv und CLI implementiert; das Basis-Paket hat keinen PDF-Renderer, `browser-pdf` gibt es als Extra |
| macOS direkt, Apple Silicon       | Lokale Desktop-App und DMG-Build implementiert; der gehostete Release-Job ist derzeit inaktiv                        |
| Windows direkt, x86_64            | Lokale Desktop-App und Installer-Build implementiert; der gehostete Release-Job ist derzeit inaktiv                  |
| Linux AppImage                    | Distributionsprofil (`scaffold`); keine fertige AppImage-Pipeline                                                    |
| macOS App Store / Microsoft Store | Distributions- und Metadatenprofile (`scaffold`); keine fertigen Store-Builds                                        |
| iOS / Android                     | Native Host-, Bridge- und Distributionsprofile vorbereitet; noch keine ausführbare mobile App                        |

Die gehosteten Jobs für macOS und Windows brauchen eigene Aktivierungsmarker unter
[`distribution/release-targets/`](../../distribution/release-targets/). Beide Marker fehlen derzeit.
Der Python-Web-Host läuft auch unter Linux; das ist unabhängig vom unfertigen nativen AppImage-Ziel.

Ein Distributionsprofil allein bedeutet keine veröffentlichte App. Maßgeblich sind die [Zielmatrix](../../distribution/README.md), die [Release-Aktivierung](../../distribution/release-targets/README.md) und die tatsächlich vorhandenen Release-Artefakte.

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

Die Release-Pipeline baut ein Python-Wheel und ein Source-Archiv für [GitHub Releases](https://github.com/Tim3399/quiltor/releases). Das gewünschte Paket aus den tatsächlich vorhandenen Release-Artefakten installieren; eine Veröffentlichung auf PyPI ist derzeit nicht eingerichtet.

```bash
pip install quiltor-<version>-py3-none-any.whl
quiltor
```

Das Paket benötigt Python 3.12 oder neuer. Die Kernabhängigkeiten enthalten `typer` für die CLI und `PyJWT[crypto]` für die OIDC-Prüfung.

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
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -e . ruff==0.16.4
npm ci
npx playwright install chromium
npm start
```

Unter Windows die Umgebung mit `py -3.12 -m venv .venv` anlegen und mit `.\.venv\Scripts\Activate.ps1` aktivieren. Danach dieselben Installations- und npm-Befehle verwenden. Die editable Installation stellt auch die CLI-/MCP-Einstiegspunkte und die Abhängigkeiten der Backend-Tests bereit.

`npm start` fährt beide Hälften hoch – den API-Server auf 8010 und Vite auf 5173 –,
wartet, bis beide antworten, und beendet beide gemeinsam mit Strg+C. Vite leitet
API-Anfragen an Port 8010 weiter; ohne den Server lädt die Seite und meldet nur, sie sei
nicht erreichbar. Der normale Anwendungs- und Docker-Port bleibt **8000**.

Wer die Hälften einzeln braucht, startet sie weiterhin selbst:

```bash
npm run dev
```

```bash
python3 apps/web/server.py 8010 --no-open
```

Unter Windows `py -3.12 apps/web/server.py 8010 --no-open` verwenden.
`QUILTOR_API_PORT` und `QUILTOR_DEV_PORT` übersteuern die Ports des Entwicklungsstarts;
`PLAYWRIGHT_BASE_URL` übersteuert das Ziel der Produkttests.

## Desktop-App

Quiltor kann unter macOS und Windows als eigenständige Fensteranwendung gebaut werden – ohne Browser-Tab und ohne separate Python-Installation auf dem Zielsystem. Die direkten Profile unterstützen derzeit macOS auf Apple Silicon und Windows x86_64.

Den Desktop-Host für die Entwicklung direkt aus den Quellen starten:

```bash
python3.12 -m venv .venv-desktop
source .venv-desktop/bin/activate
python -m pip install -e ".[desktop]"
quiltor-desktop
```

Unter Windows die Umgebung mit `py -3.12` erstellen und mit `.\.venv-desktop\Scripts\Activate.ps1` aktivieren. Für PDF-Export dort zusätzlich `python -m pip install -e ".[desktop,browser-pdf]"` ausführen.

Installer-Builds benötigen eine separate saubere Umgebung mit der exakten CPython-Version und den Build-Werkzeugen aus [`distribution/toolchains.json`](../../distribution/toolchains.json). Den Bootstrap-Lock und anschließend genau den Lock für das jeweilige Ziel installieren; die Paketierung verarbeitet `src/` direkt und benötigt keine editable Installation:

```bash
python -m pip install --require-hashes -r distribution/python-build-bootstrap.lock
```

Für macOS arm64:

```bash
python -m pip install --require-hashes --no-build-isolation -r distribution/desktop/macos/direct/requirements.lock
```

Für Windows x86_64:

```powershell
python -m pip install --require-hashes --no-build-isolation -r distribution/desktop/windows/direct/requirements.lock
```

Nach `npm ci` den passenden Build ausführen:

```bash
./distribution/desktop/macos/direct/build.sh
powershell -File distribution/desktop/windows/direct/build.ps1
```

Ergebnis:

```text
macOS   distribution/artifacts/macos-direct/Quiltor-<version>.dmg
Windows distribution/artifacts/windows-direct/Quiltor-Setup-<version>.exe
```

Standardmäßig sind lokale Builds unsigniert. Der Windows-Installer benötigt Inno Setup; ohne dieses Werkzeug erzeugt das Skript nur das unverpackte Anwendungsverzeichnis.

Die direkten Desktop-Jobs sind in der gehosteten Release-Pipeline erst nach der jeweiligen [Aktivierung](../../distribution/release-targets/README.md) verfügbar. Die beiden Aktivierungsmarker fehlen derzeit.

macOS signiert und notarisiert automatisch, wenn gesetzt:

```text
QUILTOR_SIGN_IDENTITY
QUILTOR_NOTARY_PROFILE
```

PDF-Export nutzt einen vorhandenen Systembrowser bzw. die jeweilige Plattformimplementierung, statt unnötig einen vollständigen Browser mit jedem Desktop-Build auszuliefern.

Weitere Details und die vollständige Zielmatrix: [`distribution/README.md`](../../distribution/README.md)

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

Realm, Rollen und Sitzung:

- Realm `quiltor` mit dem Client-Scope `quiltor-roles`. Der Scope legt die Realm-Rollen in den flachen Claim `roles` des ID-Tokens; nur dieser Claim zählt, `realm_access` und `resource_access` liest Quiltor nicht.
- Den KI-Assistenten nutzen nur Konten mit der Rolle `premium` (einstellbar über `QUILTOR_PREMIUM_ROLE`). Ohne sie antwortet der Server `403 assistant.premium_required`, und die Oberfläche zeigt einen Hinweis.
- Rollen werden bei jedem Token-Refresh neu gelesen. Eine vergebene oder entzogene Rolle wirkt ohne neue Anmeldung. Gelesen werden sie aus dem ID-Token der Refresh-Antwort: Schickt Keycloak beim Refresh kein ID-Token mit, bleiben die bisherigen Rollen stehen, und ein Entzug wirkt erst bei der nächsten Anmeldung. Mit dem Scope `openid` liefert Keycloak das ID-Token standardmäßig mit; der Mapper des Scopes `quiltor-roles` braucht „Add to ID token“.
- Die Sitzungsdauer bestimmt das Realm (Leerlauf und Höchstdauer). Beendet Keycloak die Sitzung, antwortet Quiltor beim nächsten Refresh `401`. Ungespeicherter Text bleibt im Editor und als Entwurf auf dem Gerät, bis man sich in einem neuen Tab wieder anmeldet.

Umgebungsvariablen:

| Variable                          | Zweck                                                       |
| --------------------------------- | ----------------------------------------------------------- |
| `QUILTOR_OIDC_ISSUER`             | Realm-Issuer, z. B. `https://kc.example.com/realms/quiltor` |
| `QUILTOR_OIDC_CLIENT_ID`          | Client-ID                                                   |
| `QUILTOR_OIDC_CLIENT_SECRET`      | Client-Secret                                               |
| `QUILTOR_PUBLIC_URL`              | Öffentliche Quiltor-URL                                     |
| `QUILTOR_COOKIE_SECURE`           | `auto` / `0` / `1`                                          |
| `QUILTOR_HOST`                    | Bind-Adresse                                                |
| `QUILTOR_MASTER_TOKEN`            | Nur ohne OIDC relevant                                      |
| `QUILTOR_DATA_DIR`                | Datenverzeichnis im Container                               |
| `QUILTOR_PREMIUM_ROLE`            | Rolle für den KI-Assistenten; Standard `premium`            |
| `QUILTOR_ASSISTANT_MAX_OPEN_JOBS` | Offene Assistenten-Aufträge je Konto (1–100); Standard `3`  |

Start:

```bash
cp .env.example .env
docker compose up -d
```

Der Compose-Dienst bindet standardmäßig lokal; ein bestehender Reverse Proxy kann auf Quiltor zeigen. Beispiele für Caddy und nginx liegen unter [`distribution/web/self-hosted/proxy/`](../../distribution/web/self-hosted/proxy/).

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

siehe [`Dockerfile`](../../Dockerfile).

Das Docker-Image enthält für den Buch-PDF-Export ausschließlich den zu
Playwright passenden Chromium Headless Shell. Firefox, WebKit, ein vollständiger
Chromium, das separate ffmpeg-Payload und die Entwicklungswerkzeuge bleiben
bewusst außerhalb des Runtime-Images. Der extrahierte Browser wird beim Build
zusätzlich gegen die festgeschriebene SHA-256-Prüfsumme geprüft.

Sitzungen liegen im Prozessspeicher. Ein Container-Neustart meldet Web-Nutzer daher ab.

Wo das Server-Log liegt, wie man eine Fehler-ID darin findet und wie man Log-Level und Logdatei setzt, steht in [`docs/operations/logging.md`](../operations/logging.md) (englisch).

### Fertige Container-Images

Ein Versions-Bump in `VERSION` auf `main` löst die Release-Pipeline aus. Images werden unter:

```text
ghcr.io/tim3399/quiltor:<version>
ghcr.io/tim3399/quiltor:latest
```

veröffentlicht. Welche Version tatsächlich verfügbar ist, zeigen die Release-Assets und die abgeschlossenen Workflow-Läufe.

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

Modelle lassen sich getrennt davon ablegen, etwa um sie mit anderen Werkzeugen zu teilen:

```text
QUILTOR_MODELS_DIR
```

Der Ordner muss existieren (Quiltor legt ihn nicht an) und enthält `gguf/*.gguf` für llama.cpp
sowie `mlx/<modell>/` mit `config.json` für MLX. Ohne die Variable bleibt alles unter
`QUILTOR_HOME/models`. Runtime und llama-server bleiben in jedem Fall unter `QUILTOR_HOME`;
vorhandene Modelle werden nicht verschoben.

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
