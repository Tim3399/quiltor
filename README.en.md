# Quiltor

[Deutsch](README.md) · [English](README.en.md)

> A local writing workspace for manuscripts, world knowledge, and relationships that change over time — built to make writing easier, not to replace it.

![Quiltor manuscript workspace](docs/screenshots/manuscript.png)

Quiltor combines a calm chapter editor with a visual world graph, a proper timeline, and a local research assistant. Every world stays in its own SQLite database on your computer. Git backups are optional, but recommended.

## What Quiltor does

| Writing | Worldbuilding | Time |
| --- | --- | --- |
| Chapter editor and focus mode | Characters, animals, places, organizations, objects, and concepts | Dedicated timeline workspace |
| Discreet writing aids and one-word autocomplete | Directed and undirected relationships | Relationship state per moment |
| Chapter notes, versions, and undo/redo | Grid, minimap, and semantic zoom | Change direction, label, and activity |
| Readable 6 × 9 inch book PDF | Profiles, custom fields, and important elements | Death markers and animated playback |

### One world graph instead of scattered notes

Elements keep stable positions while relationships may appear, disappear, or change meaning over time. The board provides a subtle grid, free positioning, automatic alignment, a minimap, and a reduced overview zoom.

![Quiltor world graph](docs/screenshots/world-graph.png)

### Timeline playback inside the board

The timeline strip plays the world's development without moving elements or the camera. Earlier relationship values remain inherited until a moment explicitly overrides them.

![Animated timeline inside the world board](docs/screenshots/timeline-playback.png)

### A workspace made for timeline maintenance

The dedicated timeline page is optimized for editing rather than visualization: order moments, add notes, activate, rename, or reverse relationships, and mark life events. The board and timeline use the same state, so there is no duplicated source of truth.

![Timeline manager](docs/screenshots/timeline-manager.png)

## Local assistant and RAG

The assistant searches chapters, notes, profiles, elements, relationships, and every timeline state as one local knowledge corpus. Answers cite clickable sources. Manuscript prose is readable context; the assistant deliberately has no tool for writing, continuing, or changing prose.

Element, relationship, and timeline changes are returned only as structured proposals. Explicit confirmation applies them as one undoable history step.

The model runtime uses `llama.cpp`. A runtime and GGUF model can be bundled locally or configured:

```bash
QUILTOR_AI_BINARY=/path/to/llama-server \
QUILTOR_AI_MODEL=/path/to/model.gguf \
python3 server.py
```

An existing local endpoint can be selected with `QUILTOR_AI_URL`. All requests stay on loopback.

### MCP included

`mcp/quiltor_server.py` exposes retrieval and world maintenance to MCP clients. Mutation-like tools only create proposals that require confirmation. There are intentionally no direct apply, delete, Git, filesystem, or manuscript-writing tools.

The bundled `.mcp.json` configures the server for clients that support project-level MCP configuration.

## Quick start

The built client lives in `dist/`; Python 3 is enough for the editor and local storage:

```bash
git clone https://github.com/Tim3399/quiltor.git
cd quiltor
python3 server.py
```

Quiltor opens [http://localhost:8000](http://localhost:8000). Alternatively:

```bash
python3 server.py 8080 --no-open
```

Create an empty world on first launch. A repository on GitHub, GitLab, Gitea, or another Git provider is optional. Quiltor never stores credentials; it uses your locally configured Git authentication.

Development and PDF export require Node.js and the project dependencies:

```bash
npm install
npm run dev
```

Run `python3 server.py --no-open` alongside Vite; API requests are forwarded to port 8000.

## Local means local

- Every world has a separate SQLite file under `data/worlds/`.
- SQLite is the only authoritative data source.
- Markdown mirrors keep manuscripts and profiles readable outside the app.
- Automatic SQLite backups can be restored locally.
- Revision checks prevent stale browser tabs from overwriting newer changes.
- Git backups are fully separated from the Quiltor source repository.
- World content, models, backups, and repositories are excluded from public version control.

## Keyboard controls

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl + S` | Save immediately |
| `Cmd/Ctrl + Shift + S` | Open Git |
| `Cmd/Ctrl + F` | Search chapters, elements, and moments |
| `Cmd/Ctrl + K` | Open the command palette |
| `Cmd/Ctrl + Z` | Undo |
| `Cmd/Ctrl + Shift + Z` | Redo |
| `Esc` | Leave focus or a temporary mode |
| `Option/Alt` while dragging | Temporarily release the grid |

## Development and quality

```bash
npm test
npm run build
python3 -m unittest discover -s tests/backend -v
npm run test:e2e
```

The build checks TypeScript and rejects color literals outside `src/design/colors.css`. Browser tests cover desktop and compact layouts, light and dark themes, autosave, conflicts, and WCAG A/AA checks for the core workspaces.

Demo screenshots can be reproduced against a separate test server:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8125 node scripts/capture-readme.mjs
```

## Architecture

```text
backend/                    SQLite, backups, retrieval, assistant, Git
mcp/                        read-only and proposal-only MCP server
src/
├── app/                    application shell and navigation
├── design/colors.css       every light and dark color token
├── features/
│   ├── manuscript/         editor, focus mode, writing aids
│   ├── figures/            world graph and relationship logic
│   ├── timeline/           timeline management
│   ├── assistant/          local chat, citations, proposals
│   ├── tools/              search, history, Git, backups
│   └── worlds/             world selection and creation
├── hooks/                  autosave, theme, undo/redo
├── i18n/                   German and English interface
├── lib/                    API and exports
└── shared/ui/              reusable UI components
```

## Status and license

Quiltor is under active development. No open-source license has been selected yet; until one is added, the source remains copyrighted and is available for inspection and private evaluation only.
