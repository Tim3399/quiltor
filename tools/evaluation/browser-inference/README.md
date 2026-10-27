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
