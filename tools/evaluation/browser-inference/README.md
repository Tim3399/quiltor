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
