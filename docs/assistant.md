# The local assistant

What the assistant is for, what it can and cannot do, and how the local runtime, an external endpoint and MCP are connected.

## A writing workspace, not an AI ghostwriter

Many AI writing tools try to take over more and more of the actual writing. Quiltor deliberately goes the other way.

> **AI for the work around writing. Never for the writing itself.**

You write every sentence. Quiltor helps reduce the bookkeeping around it:

- keep characters, animals, places, organizations, objects, and concepts together
- visualize relationships and let them change over time
- track where characters are and how they move through the world
- arrange places on a dedicated map and measure distances
- maintain a real story timeline and life events
- organize chapters in nested folders and keep reading order separate from story time
- plan visually on storyboards with notes, references, groups, and connections
- link formatted notes with `@` references and follow backlinks to their source
- search manuscript, notes, world knowledge, and storyboard cards together
- use local spelling, grammar, synonym, and word-translation tools
- let the assistant prepare structured changes and **decide yourself what gets applied**

The author remains the final authority.

## A local assistant that cannot write your book

The assistant runs through a local model using `llama.cpp` or, on Apple Silicon, MLX.

It can:

- search manuscript and world knowledge
- answer questions about the story
- cite sources from the project
- analyse characters, places, relationships, and timeline state
- prepare structured changes as proposals
- process broad tasks chapter by chapter in batches
- help update the world from one chapter, a selection of chapters, or the whole manuscript
- resolve names and aliases against existing objects before creating new ones, and present ambiguous matches for a decision
- retrieve storyboard notes for read-only questions, explicitly labelled as planning context

It cannot:

- write a scene
- continue a chapter
- rewrite prose
- silently apply changes

World changes are returned as reviewable proposals. Only explicit confirmation applies them to the project, as one undoable history step.

The manuscript is readable context for the assistant — never a writing surface for it.

World analysis groups proposals by domain and presents them with project sources for review. Uncertain statements and claims made by characters should not be adopted unchecked as objective world facts. Planning context is kept out of mutation and extraction requests. Automatic promotion of storyboard ideas into canon, dedicated AI planning workflows, and persistent continuity findings remain roadmap work; see [`docs/TODO.md`](TODO.md).

## Local assistant and runtime contract

The assistant searches chapters, notes, profiles, elements, relationships, and timeline states. Read-only questions may also retrieve storyboard notes, with planning provenance kept separate from manuscript and canonical world context. Answers may cite clickable project sources.

World discovery processes selected chapters as source material, resolves names and aliases before creating objects, and presents changes for review. Ambiguous matches can require clarification; author confirmation remains the point at which proposals change the world.

The model runtime uses:

- `llama.cpp`
- optional MLX on Apple Silicon Macs

When you explicitly start AI setup, Quiltor can download the appropriate runtime and model. A direct repository checkout stores these under `runtime/` and `models/`.

Explicit installation:

```bash
PYTHONPATH=src python3 -m quiltor.infrastructure.inference.installer
```

Force an existing runtime or different GGUF model:

```bash
QUILTOR_AI_BINARY=/path/to/llama-server \
QUILTOR_AI_MODEL=/path/to/model.gguf \
python3 apps/web/server.py
```

Or connect an already running local endpoint:

```bash
QUILTOR_AI_URL=http://127.0.0.1:11435 python3 apps/web/server.py
```

### Runtime contract

Without an API key, Quiltor speaks the bundled runtime's local contract to `QUILTOR_AI_URL`:

```text
GET  /health
POST /tokenize
POST /v1/chat/completions
```

`/v1/chat/completions` must actually enforce the strict JSON schemas requested by Quiltor.

There are three cases:

- **External endpoint** (`QUILTOR_AI_URL` with `QUILTOR_AI_KEY` or `QUILTOR_AI_KEY_FILE`): Quiltor starts nothing and sends the provider's key.
- **`QUILTOR_AI_URL` without a key:** the address names a runtime that is already running. Quiltor starts none of its own and sends no key. Whoever starts that runtime secures it, for example with `--api-key`.
- **No `QUILTOR_AI_URL`:** Quiltor starts the runtime itself (llama-server or the MLX bridge). It receives a random key through its environment on every start and answers only `/health` without it. Quiltor creates this key internally; there is no setting for it.

### External AI endpoint (OpenAI-compatible)

With an API key, Quiltor talks to an OpenAI-compatible provider such as OpenAI, OpenRouter or Anthropic's OpenAI-compatible endpoint. No local runtime starts then.

| Variable                | Purpose                                                                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QUILTOR_AI_URL`        | Base URL without `/v1`, e.g. `https://api.openai.com`. Required with a key, and only `https` (or `http` to `127.0.0.1`/`localhost`), without user info, query or fragment. |
| `QUILTOR_AI_KEY`        | The provider's API key. Switches to external mode.                                                                                                                         |
| `QUILTOR_AI_KEY_FILE`   | Alternatively, a file holding the key (e.g. a Docker secret). Not together with `QUILTOR_AI_KEY`.                                                                          |
| `QUILTOR_AI_MODEL_NAME` | The request's `model` field, e.g. `gpt-4o-mini`. Default `local`.                                                                                                          |
| `QUILTOR_AI_JSON_MODE`  | `json_object` when the provider silently ignores `response_format: json_schema` (Anthropic).                                                                               |

In external mode:

- Every call carries `Authorization: Bearer`; redirects are not followed.
- Availability is `GET /v1/models`; tokens are estimated (no `/tokenize`).
- When the provider refuses strict `json_schema`, Quiltor asks once more with `json_object` and the schema in the prompt and keeps doing so. The reply is still checked against the schema.
- The key appears neither in the status, nor in the log, nor in error messages.
- A key without `QUILTOR_AI_URL`, an `http` URL to another host, or both key sources at once stop the start.

Example:

```bash
QUILTOR_AI_URL=https://api.openai.com \
QUILTOR_AI_KEY_FILE=/run/secrets/quiltor_ai_key \
QUILTOR_AI_MODEL_NAME=gpt-4o-mini \
python3 apps/web/server.py
```

The bundled runtime backends currently use an 8192-token context window. Requests to the bundled runtime remain on loopback.

### Real local-assistant test

```bash
npm run test:assistant:local
npm run test:assistant:local -- --runs 3
npm run test:assistant:local -- --case set-presence
```

The test starts the runtime, fixture world, and Quiltor inside an isolated temporary directory and shuts everything down afterwards.

## MCP

`src/quiltor/hosts/mcp/quiltor_server.py` exposes retrieval and world maintenance as an MCP server.

The safety rule is the same as in the built-in assistant:

- reads are allowed
- changes are returned as proposals only
- application happens in Quiltor after confirmation

There are deliberately no direct:

- apply tools
- delete tools
- backup/filesystem tools
- manuscript-writing tools

The bundled `.mcp.json` configures the server through the platform-neutral
`quiltor-mcp` command. After `python -m pip install -e .`, the same project
configuration works on Windows, macOS, and Linux.
