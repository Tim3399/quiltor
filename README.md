# Quiltor

[Deutsch](README.md) · [English](README.en.md)

> Eine lokale Autorenwerkstatt für Manuskript, Weltwissen und zeitabhängige Beziehungen – entwickelt, um das Schreiben einfacher zu machen, nicht um es zu ersetzen.

![Quiltor Manuskriptansicht](docs/screenshots/manuscript.png)

Quiltor verbindet einen ruhigen Kapitel-Editor mit einem visuellen Weltgraphen, einer echten Timeline und einem lokalen Rechercheassistenten. Jede Welt bleibt als eigene SQLite-Datenbank auf deinem Rechner. Git-Backups sind optional, aber empfohlen.

## Was Quiltor kann

| Schreiben | Welt aufbauen | Zeit verwalten |
| --- | --- | --- |
| Kapitel-Editor und Fokusmodus | Figuren, Tiere, Orte, Organisationen, Objekte und Konzepte | Eigener Timeline-Arbeitsbereich |
| Diskrete Schreibhilfen und Ein-Wort-Autocomplete | Gerichtete und ungerichtete Beziehungen | Beziehungsstatus je Zeitpunkt |
| Kapitelnotizen, Versionen und Undo/Redo | Raster, Minimap und semantischer Zoom | Richtung, Bezeichnung und Aktivität verändern |
| Buch-PDF im lesbaren 6 × 9-Zoll-Format | Profile, eigene Felder und wichtige Elemente | Todeszeitpunkte und animierte Wiedergabe |

### Ein Weltgraph statt verstreuter Notizen

Elemente besitzen feste Positionen, während Beziehungen über die Zeit erscheinen, verschwinden oder ihre Bedeutung ändern. Das Board unterstützt ein dezentes Raster, freie Positionierung, automatische Ausrichtung, Minimap und einen reduzierten Übersichtszoom.

![Quiltor Weltgraph](docs/screenshots/world-graph.png)

### Timeline direkt im Board

Der Zeitstreifen spielt die Entwicklung der Welt ab, ohne Elemente oder Kamera zu verschieben. Frühere Beziehungswerte werden vererbt, bis ein Zeitpunkt sie ausdrücklich überschreibt.

![Animierte Timeline im Figurenboard](docs/screenshots/timeline-playback.png)

### Timeline gezielt verwalten

Die eigenständige Timeline-Seite ist für Pflege statt Visualisierung optimiert: Zeitpunkte sortieren, Notizen hinterlegen, Beziehungen aktivieren, umbenennen oder umkehren und Lebensereignisse markieren. Board und Timeline verwenden dieselben Daten – es gibt keine doppelte Wahrheit.

![Timeline-Verwaltung](docs/screenshots/timeline-manager.png)

## Lokaler Assistent und RAG

Der Assistent durchsucht Kapitel, Notizen, Profile, Elemente, Beziehungen und sämtliche Timeline-Stände als lokalen Wissenskorpus. Antworten verweisen auf anklickbare Quellen. Das Manuskript ist lesbarer Kontext; der Assistent besitzt bewusst kein Werkzeug zum Schreiben, Fortsetzen oder Verändern von Prosa.

Änderungen an Elementen, Beziehungen und Timeline werden ausschließlich als strukturierte Vorschläge erzeugt. Erst eine ausdrückliche Bestätigung übernimmt sie als einen rückgängig machbaren Undo-Schritt.

Die Modell-Runtime verwendet `llama.cpp`. Runtime und GGUF-Modell können lokal mitgeliefert oder konfiguriert werden:

```bash
QUILTOR_AI_BINARY=/pfad/zu/llama-server \
QUILTOR_AI_MODEL=/pfad/zu/model.gguf \
python3 server.py
```

Alternativ lässt sich ein vorhandener lokaler Endpoint über `QUILTOR_AI_URL` verwenden. Alle Anfragen bleiben auf Loopback.

### MCP inklusive

`mcp/quiltor_server.py` stellt Retrieval und Weltpflege zusätzlich als MCP-Server bereit. Schreibähnliche Tools erzeugen nur bestätigungspflichtige Vorschläge. Es gibt absichtlich keine direkten Apply-, Delete-, Git-, Datei- oder Manuskript-Schreibtools.

Die mitgelieferte `.mcp.json` konfiguriert den Server automatisch für Clients, die projektbezogene MCP-Konfiguration unterstützen.

## Schnellstart

Der gebaute Client liegt in `dist/`; für Editor und lokale Speicherung genügt Python 3:

```bash
git clone https://github.com/Tim3399/quiltor.git
cd quiltor
python3 server.py
```

Quiltor öffnet [http://localhost:8000](http://localhost:8000). Alternativ:

```bash
python3 server.py 8080 --no-open
```

Beim ersten Start legst du eine leere Welt an. Ein Repository bei GitHub, GitLab, Gitea oder einem anderen Git-Anbieter ist optional. Zugangsdaten speichert Quiltor nicht; verwendet wird deine lokal konfigurierte Git-Authentifizierung.

Für Entwicklung und PDF-Export werden Node.js und die Projektabhängigkeiten benötigt:

```bash
npm install
npm run dev
```

Parallel dazu läuft `python3 server.py --no-open`; Vite leitet API-Anfragen an Port 8000 weiter.

## Lokal heißt lokal

- Jede Welt besitzt eine eigene SQLite-Datei unter `data/worlds/`.
- SQLite ist die einzige maßgebliche Datenquelle.
- Markdown-Spiegel machen Manuskript und Profile außerhalb der App lesbar.
- Automatische SQLite-Sicherungen sind lokal wiederherstellbar.
- Revisionsprüfungen verhindern, dass ein alter Browser-Tab neuere Änderungen überschreibt.
- Git-Backups liegen vollständig getrennt vom Quiltor-Quellcode.
- Weltinhalte, Modelle, Backups und Repositories werden nicht öffentlich versioniert.

## Bedienung

| Kürzel | Aktion |
| --- | --- |
| `Cmd/Ctrl + S` | Sofort speichern |
| `Cmd/Ctrl + Shift + S` | Git-Dialog öffnen |
| `Cmd/Ctrl + F` | Kapitel, Elemente und Zeitpunkte durchsuchen |
| `Cmd/Ctrl + K` | Befehlspalette öffnen |
| `Cmd/Ctrl + Z` | Rückgängig |
| `Cmd/Ctrl + Shift + Z` | Wiederholen |
| `Esc` | Fokus- oder temporären Modus verlassen |
| `Option/Alt` beim Ziehen | Raster vorübergehend lösen |

## Entwicklung und Qualität

```bash
npm test
npm run build
python3 -m unittest discover -s tests/backend -v
npm run test:e2e
```

Der Build prüft TypeScript und verhindert Farbliterale außerhalb von `src/design/colors.css`. Browsertests decken Desktop und kompakte Ansichten, Light/Dark Mode, Autosave, Konflikte und die Kernansichten gegen WCAG A/AA ab.

Demo-Screenshots lassen sich reproduzierbar gegen einen separaten Testserver erzeugen:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8125 node scripts/capture-readme.mjs
```

## Architektur

```text
backend/                    SQLite, Backups, Retrieval, Assistant, Git
mcp/                        Read- und Proposal-only MCP-Server
src/
├── app/                    App-Shell und Navigation
├── design/colors.css       sämtliche Light-/Dark-Farbtokens
├── features/
│   ├── manuscript/         Editor, Fokusmodus und Schreibhilfen
│   ├── figures/            Weltgraph und Beziehungslogik
│   ├── timeline/           Timeline-Verwaltung
│   ├── assistant/          lokaler Chat, Quellen und Vorschläge
│   ├── tools/              Suche, Verlauf, Git und Backups
│   └── worlds/             Weltwahl und Erstellung
├── hooks/                  Autosave, Theme und Undo/Redo
├── i18n/                   deutsche und englische Oberfläche
├── lib/                    API und Exporte
└── shared/ui/              wiederverwendbare UI-Bausteine
```

## Status und Lizenz

Quiltor befindet sich in aktiver Entwicklung. Es wurde noch keine Open-Source-Lizenz gewählt; bis dahin bleibt der Quellcode urheberrechtlich geschützt und kann zur Ansicht und privaten Evaluierung genutzt werden.
