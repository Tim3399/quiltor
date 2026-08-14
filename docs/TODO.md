# TODO

Backlog items not yet scheduled or designed in detail.

## Embedding-based retrieval for the local assistant

`backend/knowledge.py::retrieve()` is currently a hand-rolled lexical scorer (token
overlap + log-count weighting + exact-phrase bonus + title bonus + one hop of graph
expansion). Deliberately chosen so far for determinism/testability and because
`build_knowledge()` rebuilds the whole corpus fresh on every `/api/assistant/chat`
request — cheap for lexical scoring, not for embeddings.

Known gap: misses paraphrases/synonyms with no literal word overlap (e.g. a "wer ist
der Bösewicht?" query against a profile that only ever says "Antagonist").

Two local-first approaches considered, both fit Quiltor's local-only/modest-footprint
philosophy (ruled out `sentence-transformers`/PyTorch as too heavy for what's needed):

1. **Reuse the already-bundled llama.cpp binary in embedding mode** (`--embedding`
   flag / `/embedding` endpoint) against a small dedicated multilingual embedding
   GGUF model (e.g. `multilingual-e5-small`, ~100–150MB, decent German support).
   Zero new runtime dependency — fits the existing `backend/llm/runtimes/` +
   `backend/llm/shared/contract.py` HTTP-client pattern. No embedding-mode
   scaffolding exists yet in `backend/llm/runtimes/llamacpp.py` — this would be new
   work.
2. **`fastembed`** (Qdrant, ONNX-based, no PyTorch, small quantized models) +
   **`usearch`** or **`hnswlib`** for the vector index — both tiny, in-process,
   CPU-friendly, no GPU/heavy deps.

Real remaining engineering cost either way (not solved by library choice): needs an
incremental cache keyed by chunk content, so only chunks that actually changed since
the manuscript/figures were last saved get re-embedded — re-embedding the entire
corpus on every chat request would add real per-request latency. Not considered the
biggest lift, but not zero either.

Status: backlog only — no design doc or implementation yet.
