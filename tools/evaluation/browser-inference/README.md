# Browser inference measurements (T-54)

A spike, not product code. Nothing here is imported by `packages/client`, `src/quiltor` or
`dist/`. It answers three questions before anyone decides to run the assistant's model in the
browser (see the T-54 brief and advice A-2 in the team knowledge base).

| Measurement        | Question                                                                  | Owner    |
| ------------------ | ------------------------------------------------------------------------- | -------- |
| 1. Schema fidelity | Does the grammar engine WebLLM bundles (XGrammar) keep our real schemas?  | D-T-54-1 |
| 2. Context 8k      | Can WebLLM run the prebuilt Qwen3-4B with an 8192-token window by option? | D-T-54-2 |
| 3. Performance     | Load, prefill and decode times on the user's own hardware                 | D-T-54-2 |

## Shared files

- `versions.json`: the pinned WebLLM version, the XGrammar version it bundles and the model ID.
  Every part reads its versions from here.
- `export_schemas.py` writes `schemas/*.json` from `quiltor.modules.assistant.schemas`:

  ```bash
  PYTHONPATH=src py -3.12 tools/evaluation/browser-inference/export_schemas.py
  npx biome format --write tools/evaluation/browser-inference/schemas
  ```

## Measurement 1: schema fidelity

XGrammar `0.1.27` is what `@mlc-ai/web-llm@0.2.86` bundles (its `package.json` pins `@mlc-ai/web-xgrammar` to `0.1.27`, built from `mlc-ai/xgrammar`; the PyPI `xgrammar==0.1.27` is the same release line). `schema_fidelity.py` compiles the four schemas exactly as WebLLM does (`compile_json_schema` with defaults), feeds hand-built valid and invalid instances through a `GrammarMatcher` token by token using the Qwen3 tokenizer, and compares with `jsonschema`. No model and no browser are needed.

```bash
py -3.12 -m venv .venv-fidelity
.venv-fidelity/Scripts/python -m pip install -r tools/evaluation/browser-inference/requirements-fidelity.txt
.venv-fidelity/Scripts/python tools/evaluation/browser-inference/schema_fidelity.py --out report.json
```

The first run downloads `tokenizer.json` of `Qwen/Qwen3-4B` (11 MB, pinned by sha256) into the temp directory. The venv is for this measurement only; the project venv must not get torch. Results and their reading: `quiltor-kb/dev/D-T-54-1.md`.

## Measurements 2 and 3: the test page

`index.html` runs Quiltor's real assistant request with WebLLM in the browser and reports load,
prefill and decode times, token counts, schema validity, browser, GPU and memory.

- `export_prompt.py` writes `prompt.json` (and the same data as `prompt.js`, which the page
  loads, because a page opened from `file://` cannot fetch JSON). It runs the product pipeline
  (`quiltor.modules.assistant.completion.complete_request`) on the synthetic evaluation world
  ("Quiltor AI Testwelt", chapters tc01–tc08, question about Corvin's loyalty to Iven) and
  records the first request the server sends to `/v1/chat/completions`. That request is the
  read-tool step, so its `response_format` is the tool-step schema, which wraps `reply_schema`.

  ```bash
  PYTHONPATH=src py -3.12 tools/evaluation/browser-inference/export_prompt.py
  ```

  | Variant | Prompt tokens (Qwen3 tokenizer) | Content                                |
  | ------- | ------------------------------- | -------------------------------------- |
  | `base`  | 4276                            | the request alone                      |
  | `long`  | 5063                            | the same request after 8 earlier turns |

  After a re-export, run `npx biome format --write tools/evaluation/browser-inference` as for
  the schemas.

- WebLLM is pinned to exactly 0.2.86 through an import map with an `integrity` entry
  (`sha384-HegQbcXEuX71lg9KuPsNblVYf0qx8SYwjMgeIdIaUisFt2g5p4IHo6YtxdUtZP25`). The hash was
  computed from `lib/index.js` as served by both jsdelivr and unpkg (identical), and Edge reports
  the same value when the hash in the page is changed and the bundle is blocked. Import-map
  integrity needs Chrome or Edge 127 or newer.
- The model is WebLLM's prebuilt `Qwen3-4B-q4f16_1-MLC` entry. Its `mlc-chat-config.json`, wasm
  library and `tokenizer.json` carry `integrity` hashes through WebLLM's own option. The weight
  shards cannot: WebLLM 0.2.86 has no integrity option for them.
- Without WebGPU, or with a software adapter (SwiftShader, WARP, llvmpipe, any adapter flagged
  `isFallbackAdapter`), the page says so and stops before any download.
- Each run also records `navigator.storage.persisted()` and `estimate()` before and after,
  the first load and the load from the cache as separate values, and, on request, the SHA-256
  of every file WebLLM keeps in the Cache API (`webllm/config`, `webllm/wasm`, `webllm/model`).
- WebLLM's `time_to_first_token_s` includes the grammar setup, which runs overlapped with the
  prefill, so the page reports `grammarInitSeconds`, `grammarPerTokenSeconds` and
  `prefillNetSeconds` (prefill minus setup, a lower bound for the pure prefill) separately.
  The adapter is requested with `powerPreference: "high-performance"`, as WebLLM does.
- Measurement 2: the 8192 window is a runtime option. WebLLM 0.2.86 builds the model config in
  `MLCEngine.reloadInternal` (`lib/index.js`, line 18243) as `{...mlc-chat-config.json,
...modelRecord.overrides, ...chatOpts}`. The prebuilt entry overrides `context_window_size`
  to 4096, the model's own config says 40960, and `CreateMLCEngine(id, config,
{ context_window_size: 8192 })` wins over both. The wasm library is `_cs1k`, which fixes the
  prefill chunk, not the window.
- Opening: only over http, `npx serve .` inside the folder. From `file://` (a double-click)
  Chrome and Edge do not keep the model between starts, so every start downloads 2.5 GB again;
  the page shows a warning there and disables "Messung starten".
- "Modell vom Rechner entfernen" unloads a running engine, calls
  `deleteModelAllInfoInCache(MODEL_ID, appConfig)` with the same `appConfig` as the load, and
  reports `estimate()` before and after plus `hasModelInCache` (copied JSON: `removal`).

### Anleitung (für Tester)

1. Öffne PowerShell und gib diese zwei Befehle nacheinander ein (jeweils mit Enter). Statt
   `<Quiltor-Ordner>` setzt du den Pfad ein, in dem dein Quiltor-Checkout liegt:

   ```powershell
   cd <Quiltor-Ordner>\tools\evaluation\browser-inference
   npx serve .
   ```

   Rufe die Adresse auf, die serve anzeigt (meist `http://localhost:3000`), in einem aktuellen
   **Chrome oder Edge**. Lass das PowerShell-Fenster offen, solange du misst. Bitte **nicht**
   `index.html` doppelklicken: Dann lädt der Browser das Modell bei jedem Start neu herunter.

2. Die Seite prüft zuerst WebGPU. Steht dort eine rote Meldung, kann dein Browser die Messung
   nicht ausführen – schick uns diese Meldung.
3. Wähle „Kontext 8192 Tokens – dieselbe Anfrage“ und klicke **„Messung starten“**.
4. Beim ersten Mal lädt der Browser etwa **2,5 GB** herunter. Lass den Tab offen, bis unten
   „Fertig“ steht (je nach Leitung 5–15 Minuten, danach dauert eine Antwort 1–3 Minuten).
5. Klicke noch einmal „Messung starten“ – jetzt kommt das Modell aus dem Speicher.
6. Wenn du magst, wiederhole das mit den beiden anderen Optionen (4096 schlägt absichtlich fehl,
   das ist ein Ergebnis).
7. Wenn du magst, klicke **„Prüfsummen der Modelldateien berechnen“** und warte, bis oben die
   Anzahl der Dateien steht.
8. Klicke **„Ergebnis kopieren“** und schicke den kopierten Text per Nachricht an Tim.
9. Zum Schluss klicke **„Modell vom Rechner entfernen“**. Darunter steht dann „Modell entfernt –
   belegter Speicher jetzt … MB“. Prüfe, dass die Zahl deutlich kleiner ist als vorher (etwa
   2,5 GB weniger) und dort „Das Modell ist nicht mehr gespeichert.“ steht. Danach beendest du
   serve, indem du im PowerShell-Fenster Strg+C drückst.
