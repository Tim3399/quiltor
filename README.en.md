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

The model runtime uses `llama.cpp` (or MLX on Apple Silicon Macs, noticeably faster there). `python3 server.py` asks automatically on first launch if no runtime is set up yet, and downloads it into `runtime/` and `models/` if you agree — no separate command needed. To trigger this explicitly or unattended (e.g. from a script):

```bash
python3 -m backend.llm.installer
```

To use an existing runtime, a different GGUF model, or an existing local endpoint instead, force it with an environment variable:

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

Requires Python 3.9 or newer (usually callable as `python` on Windows, `python3` on macOS/Linux). The built client already lives in `dist/` — nothing else to install for the editor and local storage.

#### 1. Get the repository

```bash
git clone https://github.com/Tim3399/quiltor.git
cd quiltor
```

#### 2. Start

```bash
python3 server.py
```

Quiltor opens [http://localhost:8000](http://localhost:8000) automatically and creates an empty world on first launch. A repository on GitHub, GitLab, Gitea, or another Git provider is optional; Quiltor never stores credentials, it uses your locally configured Git authentication.

If no local assistant is set up yet, the server asks once (`Set it up now? [y/N]`) before downloading anything — about 2.5GB for llama.cpp, about 2.4GB for MLX on Apple Silicon Macs. Answering no (or just pressing Enter) leaves Quiltor working exactly the same, just without the assistant panel; it asks again next launch until you agree once.

Other start options:

```bash
python3 server.py 8080            # custom port
python3 server.py 8080 --no-open  # do not open a browser
```

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| `python3: command not found` | On Windows the command is `python`, not `python3`. |
| Assistant panel shows "Local model unavailable" | Run `python3 -m backend.llm.installer`, then restart `server.py`. Check that `runtime/llama-server` (or `llama-server.exe`) and a `.gguf` file exist under `models/`. |
| Download stalls or is slow | Run `python3 -m backend.llm.installer` again — complete files are skipped, incomplete ones re-download from scratch. |
| Firewall/antivirus flags `llama-server.exe` | It comes from the official [llama.cpp release](https://github.com/ggml-org/llama.cpp/releases) and only listens on `127.0.0.1`; allow it. |
| Port 8000 is taken | Start on another port: `python3 server.py 8080`. |
| Want a different runtime, model, or endpoint | Set `QUILTOR_AI_BINARY`, `QUILTOR_AI_MODEL`, or `QUILTOR_AI_URL` — see [Local assistant and RAG](#local-assistant-and-rag). |

Development and PDF export additionally require Node.js and the project dependencies:

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

Quiltor is under active development.

Quiltor is **source-available, not open source**: the source is public, modifiable and redistributable, but commercial use by larger organisations is restricted. It is offered under your choice of the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) or the [PolyForm Small Business License 1.0.0](https://polyformproject.org/licenses/small-business/1.0.0) — see [LICENSE](LICENSE).

**Free, no need to ask:**

- any noncommercial use — personal projects, hobby work, study, teaching, research, charities, and public institutions
- commercial use by a small business as defined by the PolyForm Small Business License: fewer than 100 employees and independent contractors, and less than 1,000,000 USD total revenue in the prior tax year. Self-employed authors are essentially always covered.

**Above that line, talk to us:** commercial use by larger organisations needs a separate, individually negotiated license. Write to [licensing@quiltor.app](mailto:licensing@quiltor.app) — details in [COMMERCIAL.md](COMMERCIAL.md).

Release packages also contain third-party software and model weights under their own licenses, see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
