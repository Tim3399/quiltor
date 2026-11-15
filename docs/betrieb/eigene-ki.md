# Eigene KI

Der Assistent kann eine Antwort auf zwei Wegen rechnen lassen:

- **Server-KI:** das Modell, das du als Betreiber auf dem Server einrichtest (lokale Runtime
  oder ein externer, OpenAI-kompatibler Endpunkt, siehe [Der lokale Assistent](../assistent.md)).
  Im Mehrnutzerbetrieb braucht ein Konto dafür die Premium-Rolle (`QUILTOR_PREMIUM_ROLE`).
- **KI im Browser (WebLLM):** ein Modell, das im Browser der Nutzerin oder des Nutzers läuft,
  auf deren eigener Grafikkarte (WebGPU). Der Server baut den Prompt und prüft die Antwort wie
  bei der Server-KI; nur das Rechnen findet im Browser statt. Dafür braucht es keine
  Premium-Rolle und kein Modell auf dem Server.

Ein eigener Schlüssel für einen Cloud-Anbieter ist für eine spätere Version geplant. In dieser
Version gibt es ihn nicht.

## Ein- und ausschalten

`QUILTOR_ASSISTANT_CLIENT_AI` steuert, ob Aufträge auf einer eigenen KI laufen dürfen.

| Wert              | Wirkung                                                                                                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| leer oder `1`     | an (Standard)                                                                                                                                                                                                          |
| `0`               | aus: `GET /api/capabilities` meldet `instance.clientAi: false`, `GET /api/assistant/status` meldet keine `clientEngines`, ein Auftrag mit eigener KI und die Relay-Routen antworten `403 assistant.client_ai_disabled` |
| jeder andere Wert | Der Start bricht ab.                                                                                                                                                                                                   |

`QUILTOR_ASSISTANT_CLIENT_JOBS` begrenzt, wie viele solche Aufträge ein Prozess gleichzeitig
führt. Jedes Konto hat höchstens einen zur Zeit.

## Fristen

Der Server reicht jeden Modellaufruf an den Browser weiter und wartet auf dessen Antwort. Die
Fristen dafür lassen sich einstellen. Ein Wert außerhalb der Grenzen bricht den Start ab, mit
einer Meldung, die Namen und Grenzen nennt.

| Variable                                        | Bedeutung                                           | Standard | Grenzen     |
| ----------------------------------------------- | --------------------------------------------------- | -------- | ----------- |
| `QUILTOR_ASSISTANT_RELAY_ANSWER_SECONDS_WEBLLM` | Sekunden für eine Antwort der KI im Browser         | 300      | 30 bis 3600 |
| `QUILTOR_ASSISTANT_RELAY_ANSWER_SECONDS_CLOUD`  | Sekunden für eine Antwort eines Cloud-Anbieters     | 120      | 10 bis 600  |
| `QUILTOR_ASSISTANT_RELAY_JOB_MINUTES`           | Minuten für einen ganzen Auftrag, über alle Aufrufe | 20       | 1 bis 120   |

Ein langsamer Rechner braucht für ein großes Modell mehr Zeit pro Antwort. Erhöhe dann die
Frist für WebLLM, statt den ganzen Auftrag länger laufen zu lassen.

## Hinter einem Reverse-Proxy

Der Browser holt seine Aufrufe über `/api/assistant/relay/next`. Die Anfrage bleibt bis zu
25 Sekunden offen, bis ein Aufruf bereitsteht. Der Lese-Timeout des Proxys muss deshalb
mindestens 30 Sekunden betragen. Der Standard von nginx (`proxy_read_timeout 60s`) und der
von Caddy reichen. Wer einen eigenen Wert setzt, bleibt bei 30 Sekunden oder mehr.

Eine Antwort des Browsers (`/api/assistant/relay/answer`) darf höchstens 256 KiB groß sein. Der
eigene Client prüft das vor dem Senden. Schickt ein fremder Client mehr, lehnt der Server ab,
ohne den Rest zu lesen. Je nach System sieht dieser Client dann statt `413` einen
abgebrochenen Verbindungsaufbau (unter Windows etwa Fehler 10053). Das ist so gewollt: Der
Server liest keine unbegrenzten Daten, nur um eine Ablehnung höflich zuzustellen.

## Content-Security-Policy und der Modell-Download

Die KI im Browser lädt ihr Modell beim ersten Mal direkt von Hugging Face und die
Modellbibliotheken von GitHub. Dafür erlaubt die Policy in `connect-src` genau diese Hosts:

- `https://huggingface.co`: Verzeichnis und Metadaten der Modelle.
- `https://*.cdn.hf.co`: die Modelldateien. Hugging Face liefert sie über regionale CDN-Hosts
  wie `us.aws.cdn.hf.co` oder `eu-west-3.aws.cdn.hf.co` aus und nennt diese Hosts selbst
  veränderlich. Eine feste Liste würde bei jedem Wechsel brechen, und zwar zuerst für
  Nutzerinnen und Nutzer in anderen Regionen. Das ist die einzige Wildcard der Policy.
- `https://cdn-lfs-us-1.hf.co` und `https://cdn-lfs-eu-1.hf.co`: ältere Speicher-Hosts für
  große Dateien.
- `https://raw.githubusercontent.com`: die Modellbibliotheken (`.wasm`).

Die xethub-Hosts von Hugging Face (etwa `cas-bridge.xethub.hf.co`) fehlen bewusst. Sie wurden
beim Download nicht beobachtet und stehen nicht mehr in der Host-Tabelle von Hugging Face.

Weil Hugging Face die Hosts wechseln kann, gibt es einen Ausweg, falls der Download an der
Policy scheitert (in der Browser-Konsole als CSP-Verletzung sichtbar):

```bash
QUILTOR_CSP_CONNECT_EXTRA="https://neuer-host.example.org"
```

Die Variable nimmt `https://`-Origins ohne Pfad und ohne Wildcard, getrennt durch Leerzeichen,
und hängt sie an `connect-src` an. Als letzter Ausweg meldet `QUILTOR_CSP=report-only`
Verletzungen nur, statt sie zu blockieren.

## Protokoll

Jede Antwort des Assistenten wird mit der Art der Engine protokolliert, die sie gerechnet hat:
`server`, `webllm` oder `cloud`. Das steht als erster Schritt im Verlauf der Antwort
(`agentTrace`) und als Feld `engine` im Interaktionsprotokoll der Welt. Ein Modellname oder ein
Schlüssel wird nie gespeichert. Ältere Einträge, die vor dieser Version entstanden sind, gelten
als `server`.
