# Quiltor

[Deutsch](README.md) · [English](README.en.md)

Quiltor is a local-first writing workspace for manuscripts, characters, places,
concepts, and their relationships. It runs in the browser while keeping every
world in a separate SQLite database on your own computer.

## Features

- Chapter-based manuscript editor with focus mode and discreet writing aids
- Visual character and world board with draggable nodes and relationships
- Undo and redo for manuscripts and diagrams
- Chapter versions, Git history, and readable diffs
- Light and dark themes
- German and English interface
- Book-style PDF export in a readable 6 × 9 inch format
- Local SQLite storage with revision checks and backups
- Multiple independent worlds from a neutral start screen
- Local RAG assistant with cited chapter, note, profile, relationship, and timeline retrieval
- Confirmation-only proposals for worldbuilding changes, plus a bundled MCP server

Quiltor starts without bundled example content. Your manuscripts, character
profiles, databases, mirrors, and backups are ignored by Git.

## Local assistant

Quiltor's assistant is designed to make research and structured world
maintenance easier without replacing the author's writing. It may read
manuscript prose as local RAG context, but it has no proposal or tool capable of
writing, continuing, or changing prose. Character, relationship, and timeline
changes are returned as cited proposals, require explicit confirmation, and
enter the normal undo/redo history as one operation.

Release packages can include a local `llama.cpp` runtime and an Apache-2.0
Qwen3-4B GGUF model. Difficult lawful fictional material remains valid analysis
context; violence, sex, crime, horror, abuse, politics, religion, and moral
complexity are not refusal reasons. The model remains replaceable and all
inference stays on loopback.

The bundled `mcp/quiltor_server.py` exposes the same local retrieval and
proposal capabilities to MCP clients. It intentionally provides no apply,
delete, filesystem, Git, database-write, or manuscript-writing tool.

## Quick start

The production build only requires Python 3:

```bash
python3 server.py
```

Quiltor opens at `http://localhost:8000`. To choose another port or prevent the
browser from opening automatically:

```bash
python3 server.py 8080 --no-open
```

Create your first world on the start screen. You can optionally connect a
dedicated repository on GitHub, GitLab, Gitea, or another Git provider; doing so
is strongly recommended. Its manuscript, character board, and backups remain separate
from every other world and from the Quiltor source repository.

## Development

```bash
npm install
npm run dev
npm test
npm run build
python3 -m unittest discover -s tests/backend -v
npm run test:e2e
```

Run `python3 server.py --no-open` alongside `npm run dev`; Vite forwards API
requests to the Python server on port 8000. End-to-end tests also require a
running server.

## Data and privacy

SQLite is the authoritative data source. Each world is stored under
`data/worlds/`. Quiltor also creates readable Markdown mirrors and local
database backups:

- `data/manuscripts/*.md` — readable manuscript mirror
- `data/profiles/*.md` — readable character profiles
- `data/backups/` — automatic SQLite backups

All of these world-specific files are excluded from the public repository.
Writes use revision checks, so an older browser tab cannot silently overwrite a
newer version. Restoring a backup first preserves the current state as another
backup.

Git backups are handled by a dedicated backend service. Each world has an
isolated working repository under `data/repositories/` containing a consistent
SQLite snapshot plus readable manuscript and profile mirrors. Quiltor never
stores provider credentials; it uses the Git authentication configured locally.

## Project structure

```text
.
├── backend/                  storage, retrieval, local assistant, and validation
├── mcp/                      read-only and proposal-only MCP server
├── src/
│   ├── app/                  application shell and navigation
│   ├── config/               product configuration
│   ├── design/colors.css     all light and dark color tokens
│   ├── features/
│   │   ├── manuscript/       editor, chapter binder, writing aids
│   │   ├── figures/          world graph and profile inspector
│   │   ├── assistant/        local chat, citations, and proposal review
│   │   ├── tools/            search, history, Git, and backups
│   │   └── worlds/           world selection and creation
│   ├── hooks/                autosave, theme, and undo/redo state
│   ├── i18n/                 German and English interface strings
│   ├── lib/                  API client and file exports
│   └── shared/ui/            reusable accessible UI components
├── scripts/                  book PDF renderer
├── tests/                    backend and browser tests
├── server.py                 local HTTP server and API
└── package.json              frontend build and test commands
```

Feature modules may depend on shared UI, hooks, libraries, and domain types,
but should not import other feature modules directly. The backend does not
depend on frontend code.

## License

No license has been selected yet. Until one is added, the source remains
copyrighted and is available for inspection only.
