# Local-AI conformance

What a local inference server has to answer, how that is measured, and which deviations are
already known per pinned llama.cpp release. The contract is local-ai-contract v1; the cases are
numbered as in its section 5.

## What is measured

`tests/python/test_local_ai_conformance.py` asks one set of cases of every server under test:

| Case     | Asks                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------- |
| C01      | a minimal completion: `id`, `object`, `created`, `model`, one choice, `finish_reason: stop`, `usage` |
| C02, C03 | a request without `model`, or with an unknown role, is refused with 400                              |
| C17      | a cut-off answer says `finish_reason: length`                                                        |
| C20      | a prompt beyond the context is refused as a context error                                            |
| C22      | an error comes in the envelope `{error: {message, type, param, code}}`, with a string `code`         |
| C39      | `/x/v1/tokenize`, only when the server offers it                                                     |
| C40      | `/x/v1/health`, only when the server offers it                                                       |

Two servers run it. The MLX bridge runs it on every `backend` job (the real handler on a free
port with fakes where MLX would be, so no MLX is needed). A real llama-server runs it only when
`QUILTOR_CONFORMANCE_LLAMA_URL` names one; otherwise the class skips and says why.

With `QUILTOR_CONFORMANCE_ARTIFACT` set, each case appends one JSON line (`case`, `kind`,
`method`, `path`, `status`, `raw`). Those lines are the real answers of a pinned server and are
meant to be copied into fixtures by a person.

## The CI job

`.github/workflows/llama-conformance.yml` runs `tools/ci/llama_conformance.py` for each release
in its matrix. It is not a required check. It runs on a pull request that touches what it
measures (the manifest, `llamacpp.py`, `shared/contract.py`, the suite, the script and its pins)
and by hand from the Actions tab.

The script:

1. fetches llama-server with the product's own installer (`install_runtime`: the release
   document, the asset's published SHA-256, the redirect origins), for the release it is asked
   about;
2. fetches the one approved model (`install_model`: the commit-pinned Hugging
   Face tree gives the SHA-256), and compares it with the digest pinned in
   `tools/ci/llama-conformance-pins.json`;
3. starts the server with `runtimes.llamacpp.start`, the same arguments and the same
   `LLAMA_API_KEY` environment variable a user's start uses;
4. waits for `/health`, runs the suite in its llama mode, and writes the raw answers;
5. grades the result: **conformant**, **conformant with known deviations** or **not
   conformant** (exit code 1). A failing case is always reported as failing; the grade only says
   whether every failure is on the release's list. A listed case that passes is reported as
   stale, so the list does not keep claiming a deviation that has gone.

### Models

The model only has to carry a chat template (the server starts with `--jinja`) and answer a
schema-constrained request; the grammar decides the tokens, so a tiny model is enough for the
envelope, `usage`, `finish_reason` and the context error. That is an assumption until a CI run
shows it (T-179 F4). There is exactly one model: the user approved the download of SmolLM2
135M and no other, not even as a fallback. HuggingFaceTB publishes no GGUF, so the file comes
from a third party the user approved by name: `bartowski/SmolLM2-135M-Instruct-GGUF`, an imatrix
quantisation of `HuggingFaceTB/SmolLM2-135M-Instruct` (llama.cpp b3991), pinned at revision
`09816acd5d99df7be770d85ea30822623dab342c`. `load_pins` refuses a pins file that lists any
other model, so a second candidate cannot slip in through the pins.

| Model                 | File                              | Size              | Licence                 | Digest     |
| --------------------- | --------------------------------- | ----------------- | ----------------------- | ---------- |
| SmolLM2 135M Instruct | `SmolLM2-135M-Instruct-Q8_0.gguf` | 144 811 360 bytes | Apache-2.0 (model card) | not pinned |

Sizes and licences are expectations, not measurements. The first run is a spike
(`spike: true`): it may use a model whose digest is not pinned, and its summary prints the
digest. Pin that digest in the pins file, with the licence and size the run showed, and later
runs refuse any other file. Without `spike`, a model with no digest is refused before anything
is downloaded.

### Known deviations per pin

| Release                      | Known deviations                                                                     | Cases    | Source                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------ | -------- | ---------------------------------------------------------- |
| `b12183`                     | N1 (integer `error.code`, no `param`), N2 (own error types), N3 (extra error fields) | C22, C20 | T-194 via contract 5.1; expectation, not yet measured here |
| `b10218` (the product's pin) | none recorded                                                                        | none     | not yet measured; the first run decides                    |

The list is the expectation from the contract (section 5.1) until a run has written the real
answers. After the first run, replace it with what the artifact shows. A change of
`LLAMA_CPP_RELEASE` needs an entry here and in the pins file; a test fails otherwise.

A deviation is not a defect to hide: the client normalises N1 to N4 in
`shared/contract.py` (T-179 part 2), so Quiltor is conformant against a server that deviates in
exactly these ways, while the server test stays red where it is red.
