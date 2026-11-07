# Der lokale Assistent

Wofür der Assistent da ist, was er kann und was nicht, und wie die lokale Runtime, ein externer Endpunkt und MCP angebunden werden.

## Eine Autorenwerkstatt statt eines AI-Ghostwriters

Viele AI-Schreibwerkzeuge versuchen, möglichst viel vom eigentlichen Schreiben zu übernehmen. Quiltor geht bewusst in die andere Richtung.

> **AI für die Arbeit rund ums Schreiben. Nie für das Schreiben selbst.**

Du schreibst jeden Satz. Quiltor hilft dabei, dass du dich weniger mit Verwaltung beschäftigen musst:

- Figuren, Tiere, Orte, Organisationen, Objekte und Konzepte an einem Ort pflegen
- Beziehungen visualisieren und über die Zeit verändern
- Aufenthalte und Reisen von Figuren nachvollziehen
- Orte auf einer eigenen Karte anordnen und Distanzen messen
- Timeline und Lebensereignisse verwalten
- Ideen auf mehreren Storyboards mit Notizen, Gruppen und Verweisen planen
- Kapitel in verschachtelten Ordnern organisieren und unabhängig von ihrer Erzählreihenfolge zeitlich einordnen
- formatierte Notizen mit `@`-Referenzen verknüpfen und über Backlinks zur Quelle springen
- Manuskript, Kapitelnotizen, Weltwissen und Storyboard-Karten gemeinsam durchsuchen
- Rechtschreibung, Grammatik, Synonyme und Wortübersetzungen lokal nutzen
- vom Assistenten strukturierte Änderungen vorbereiten lassen und **selbst bestätigen**

Der Autor bleibt immer die letzte Instanz.

## Ein lokaler Assistent, der dein Buch nicht schreiben kann

Der Assistent arbeitet mit einem lokalen Modell über `llama.cpp` oder – auf Apple Silicon – MLX.

Er kann:

- Manuskript und Weltwissen durchsuchen
- Fragen zur Geschichte beantworten
- Quellen im Projekt zitieren
- Figuren, Orte, Beziehungen und Timeline-Zustände analysieren
- strukturierte Änderungen als Vorschläge vorbereiten
- breite Aufgaben kapitelweise in Gruppen verarbeiten
- die Welt aus einem Kapitel, einer Kapitelauswahl oder dem gesamten Manuskript aktualisieren helfen
- Namen und Aliasse vor dem Anlegen neuer Elemente auflösen und mehrdeutige Treffer zur Entscheidung vorlegen
- Storyboard-Notizen für reine Lesefragen abrufen, ausdrücklich als Planungskontext gekennzeichnet

Er kann **nicht**:

- eine Szene schreiben
- ein Kapitel fortsetzen
- Prosa umschreiben
- Änderungen unbemerkt anwenden

Änderungen an Weltwissen erscheinen als prüfbare Vorschläge. Erst eine ausdrückliche Bestätigung übernimmt sie in den Projektzustand und macht sie als einen Undo-Schritt rückgängig.

Das Manuskript bleibt dabei lesbarer Kontext – nie Schreibfläche für den Assistenten.

Bei der Weltanalyse werden Vorschläge nach Fachgebiet gruppiert und mit Projektquellen zur Prüfung vorgelegt. Unsichere Aussagen und Figurenbehauptungen sollen nicht ungeprüft als objektive Weltfakten übernommen werden. Storyboard-Inhalte können bereits als ausdrücklich gekennzeichneter Planungskontext gelesen werden; aus Änderungs- und Extraktionsanfragen bleibt dieser Planungskontext heraus. Eine automatische Übernahme von Storyboard-Ideen in die gesicherte Welt, eigene KI-Werkzeuge zum Bearbeiten der Planung und ein persistenter Arbeitsbereich für Kontinuitätsbefunde gehören weiterhin zur [Roadmap](TODO.md).

## Lokaler Assistent und Runtime-Vertrag

Der Assistent durchsucht Kapitel, Notizen, Profile, Elemente, Beziehungen und Timeline-Zustände als lokalen Wissenskorpus. Reine Lesefragen dürfen auch Storyboard-Notizen abrufen; deren Herkunft als Planung bleibt dabei von Manuskript und gesichertem Weltwissen getrennt. Antworten können auf anklickbare Projektquellen verweisen.

Die Weltanalyse verarbeitet ausgewählte Kapitel als Quellmaterial, löst Namen und Aliasse auf, bevor sie Objekte anlegt, und legt Änderungen zur Prüfung vor. Mehrdeutige Treffer können eine Rückfrage auslösen; erst die Bestätigung des Autors verändert die Welt.

Die Modell-Runtime verwendet:

- `llama.cpp`
- auf Apple-Silicon-Macs optional MLX

Bei der ausdrücklich gestarteten KI-Einrichtung kann Quiltor die passende Runtime und das Modell herunterladen. Die Daten landen bei einem direkten Repository-Start unter `runtime/` und `models/`.

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

Ohne API-Schlüssel spricht Quiltor mit `QUILTOR_AI_URL` den lokalen Vertrag der mitgelieferten Runtime:

```text
GET  /health
POST /tokenize
POST /v1/chat/completions
```

`/v1/chat/completions` muss die von Quiltor angeforderten strikten JSON-Schemas tatsächlich erzwingen.

Es gibt drei Fälle:

- **Externer Endpunkt** (`QUILTOR_AI_URL` mit `QUILTOR_AI_KEY` oder `QUILTOR_AI_KEY_FILE`): Quiltor startet nichts und schickt den Schlüssel des Anbieters.
- **`QUILTOR_AI_URL` ohne Schlüssel:** Die Adresse nennt eine Runtime, die schon läuft. Quiltor startet keine eigene und schickt keinen Schlüssel. Wer diese Runtime startet, sichert sie selbst ab, etwa mit `--api-key`.
- **Ohne `QUILTOR_AI_URL`:** Quiltor startet die Runtime selbst (llama-server oder die MLX-Bridge). Sie bekommt bei jedem Start einen zufälligen Schlüssel über ihre Umgebung und beantwortet ohne ihn nur `/health`. Diesen Schlüssel erzeugt Quiltor intern; es gibt dafür keine Einstellung.

### Externer KI-Endpunkt (OpenAI-kompatibel)

Mit einem API-Schlüssel spricht Quiltor einen OpenAI-kompatiblen Anbieter an, etwa OpenAI, OpenRouter oder Anthropics OpenAI-kompatiblen Endpunkt. Dann startet keine lokale Runtime.

| Variable                | Zweck                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `QUILTOR_AI_URL`        | Basis-URL ohne `/v1`, z. B. `https://api.openai.com`. Mit Schlüssel Pflicht und nur `https` (oder `http` auf `127.0.0.1`/`localhost`), ohne Benutzerinfo, Query oder Fragment. |
| `QUILTOR_AI_KEY`        | API-Schlüssel des Anbieters. Schaltet den externen Modus ein.                                                                                                                  |
| `QUILTOR_AI_KEY_FILE`   | Alternativ: Datei, die den Schlüssel enthält (z. B. ein Docker-Secret). Nicht zusammen mit `QUILTOR_AI_KEY`.                                                                   |
| `QUILTOR_AI_MODEL_NAME` | Feld `model` im Request, z. B. `gpt-4o-mini`. Standard `local`.                                                                                                                |
| `QUILTOR_AI_JSON_MODE`  | `json_object`, wenn der Anbieter `response_format: json_schema` stillschweigend ignoriert (Anthropic).                                                                         |

Im externen Modus gilt:

- Jeder Aufruf trägt `Authorization: Bearer`, Weiterleitungen werden nicht verfolgt.
- Die Verfügbarkeit prüft `GET /v1/models`, Token werden geschätzt (kein `/tokenize`).
- Lehnt der Anbieter striktes `json_schema` ab, fragt Quiltor einmal mit `json_object` und dem Schema im Prompt nach und bleibt danach dabei. Die Antwort prüft Quiltor weiter gegen das Schema.
- Der Schlüssel erscheint weder im Status noch im Log noch in Fehlermeldungen.
- Ein Schlüssel ohne `QUILTOR_AI_URL`, eine `http`-URL zu einem fremden Host oder beide Schlüsselquellen zugleich verhindern den Start.

Beispiel:

```bash
QUILTOR_AI_URL=https://api.openai.com \
QUILTOR_AI_KEY_FILE=/run/secrets/quiltor_ai_key \
QUILTOR_AI_MODEL_NAME=gpt-4o-mini \
python3 apps/web/server.py
```

Die gebündelten Runtime-Backends verwenden aktuell ein Kontextfenster von 8192 Tokens. Anfragen an die gebündelte Runtime bleiben auf Loopback.

### Lokalen Assistenten real testen

```bash
npm run test:assistant:local
npm run test:assistant:local -- --runs 3
npm run test:assistant:local -- --case set-presence
```

Der Test startet Runtime, Testwelt und Quiltor in einem isolierten temporären Verzeichnis und beendet die Prozesse anschließend wieder.

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
