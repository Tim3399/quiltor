# Quiltor

[Deutsch](README.md) · [English](README.en.md)

Lokale Autorenwerkstatt für Manuskripte, Figuren, Orte und Beziehungen. Die App
läuft im Browser, speichert aber ausschließlich auf dem eigenen Rechner.

## Start

Für die tägliche Nutzung genügt Python 3, weil der gebaute Client in `dist/`
liegt:

```bash
python3 server.py
```

Die Werkstatt öffnet `http://localhost:8000`. Ein anderer Port und ein Start
ohne automatisch geöffneten Browser funktionieren weiterhin:

```bash
python3 server.py 8080 --no-open
```

## Entwicklung

```bash
npm install
npm run dev       # Vite; API wird an localhost:8000 weitergereicht
npm test
npm run build
python3 -m unittest discover -s tests/backend -v
npm run test:e2e  # benötigt den laufenden Python-Server
```

Für `npm run dev` muss parallel `python3 server.py --no-open` laufen.

## Daten und Sicherungen

Beim ersten Start ist noch keine Welt vorhanden. Beim Anlegen werden ein Titel
und die URL eines eigenen GitHub-Repositories angegeben. Jede Welt erhält eine
eigene SQLite-Datei unter `data/worlds/` und ein vollständig vom Quiltor-Code
getrenntes Git-Arbeitsverzeichnis unter `data/repositories/`. Dadurch
werden Manuskript, Figuren und Sicherungen nicht zwischen Projekten vermischt.
Der gewählte Welttitel erscheint in der App-Leiste und auf der Titelseite des
Buch-PDFs.

Für lesbare Ansichten und Sicherungen erzeugt der Server weiterhin:

- `data/manuscripts/*.md` für den lesbaren Manuskriptverlauf
- `data/profiles/*.md` für lesbare Figurenprofile
- `data/backups/*.sqlite3` als automatische Datenbankbackups

Schreibzugriffe sind revisionsgesichert: Ist im Browser noch ein älterer Stand
geöffnet, überschreibt er keine neuere Änderung, sondern zeigt einen Konflikt.
Über **Sicherungen** lassen sich vorhandene SQLite-Backups anzeigen und
wiederherstellen; direkt davor entsteht eine zusätzliche Sicherung des aktuellen
Stands.

Weltinhalte und automatische Backups bleiben lokal und werden nicht mit Git
im öffentlichen Quiltor-Repository versioniert. Beim Git-Backup werden ein
konsistenter SQLite-Snapshot und die lesbaren Markdown-Spiegel ausschließlich
in das Repository der jeweiligen Welt geschrieben. Zugangsdaten werden nicht
gespeichert. Markdown-Dateien sind keine zweite Datenquelle.

## Projektstruktur

```text
.
├── backend/
│   ├── storage.py              Schema, Migration, Revisionen und Backups
│   ├── git_backup.py           isolierte Git-Sicherung je Welt
│   └── validation.py           Prüfung eingehender API-Daten
├── src/
│   ├── app/                    globale App-Shell und Navigation
│   ├── features/
│   │   ├── manuscript/         Editor, Binder und Schreibhelfer
│   │   ├── figures/            Diagramm und Figuren-Inspector
│   │   └── tools/              Suche, Verlauf, Git und Backups
│   ├── hooks/                  Autosave sowie Undo/Redo-Zustand
│   ├── design/colors.css       alle Farb-Tokens für Hell- und Dunkelmodus
│   ├── lib/                    API und Dateiexport
│   ├── shared/ui/              zugängliche UI-Grundbausteine
│   └── types.ts                gemeinsame Domänenmodelle
├── tests/backend/              SQLite- und Migrationstests
├── data/                       Datenbanken, Spiegel und Backups
├── dist/                       gebauter Produktionsclient
├── server.py                   kompatibler Startpunkt und HTTP-API
└── package.json                Frontend-Build und Tests
```

Abhängigkeiten dürfen nur in die passende Ebene zeigen: Features verwenden
`shared`, `hooks`, `lib` und `types`, aber importieren keine anderen Features.
Das Backend kennt keine Frontendmodule. `data/` enthält keinen Anwendungscode.

## Bedienkonzept

- `Text` und `Figuren` sind getrennte Arbeitsbereiche in einer gemeinsamen
  ruhigen App-Shell.
- `Cmd/Ctrl+S` speichert sofort, `Cmd/Ctrl+Shift+S` öffnet Git.
- `Cmd/Ctrl+F` öffnet die Suche; `Cmd/Ctrl+K` zugleich die Befehlspalette.
- `Cmd/Ctrl+Z` und `Cmd/Ctrl+Shift+Z` machen Änderungen rückgängig bzw. wiederholen
  sie, solange kein Eingabefeld den nativen Textverlauf übernimmt.
- `Esc` beendet Fokus- und temporäre Verbindungsmodi.
- Alle Mausaktionen besitzen sichtbare Schaltflächen oder Tastaturalternativen.

Die App lädt für ihre normale Bedienung keine Fonts oder UI-Bibliotheken aus
dem Internet. Die Druckansicht verwendet ein 6×9-Zoll-Buchformat; für einen
reproduzierbaren professionellen PDF-Satz wäre weiterhin eine eigene
Satz-Pipeline sinnvoll.

Die Browsertests prüfen Desktop und Tablet, Autosave samt Konflikterkennung
sowie die Kernansichten automatisiert gegen WCAG A/AA. Automatische Prüfungen
ersetzen keine manuelle Tastatur- und Screenreader-Abnahme.

Alle projektdefinierten Farben liegen ausschließlich in `src/design/colors.css`.
`npm run check:colors` verhindert Farbliterale in Komponenten, Styles und
Dokumenten; der Produktionsbuild führt diese Prüfung automatisch aus.
