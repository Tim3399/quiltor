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
- Without WebGPU the page says so and stops before any download.
- Opening: `npx serve tools/evaluation/browser-inference` (tested end to end) or a double-click on
  `index.html` (`file://`; the WebLLM import and the browser cache work there, a full run was only
  tested over http).

### Anleitung (für Tester)

1. Öffne den Ordner `tools/evaluation/browser-inference` und starte dort
   `npx serve .` – oder doppelklicke `index.html`. Nimm ein aktuelles **Chrome oder Edge**.
2. Die Seite prüft zuerst WebGPU. Steht dort eine rote Meldung, kann dein Browser die Messung
   nicht ausführen – schick uns diese Meldung.
3. Wähle „Kontext 8192 Tokens – dieselbe Anfrage“ und klicke **„Messung starten“**.
4. Beim ersten Mal lädt der Browser etwa **2,5 GB** herunter. Lass den Tab offen, bis unten
   „Fertig“ steht (je nach Leitung 5–15 Minuten, danach dauert eine Antwort 1–3 Minuten).
5. Klicke noch einmal „Messung starten“ – jetzt kommt das Modell aus dem Speicher.
6. Wenn du magst, wiederhole das mit den beiden anderen Optionen (4096 schlägt absichtlich fehl,
   das ist ein Ergebnis).
7. Klicke **„Ergebnis kopieren“** und schicke den kopierten Text per Nachricht an Tim.
