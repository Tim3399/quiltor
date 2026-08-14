# Quiltor

[Deutsch](README.md) · [English](README.en.md)

> A local writing workspace for manuscripts, world knowledge, and relationships that change over time — built to make writing easier, not to replace it.

![Quiltor manuscript workspace](docs/screenshots/manuscript.png)

Quiltor combines a calm chapter editor with a visual world graph, a map view for places, a proper timeline, and a local research assistant. Every world stays in its own SQLite database on your computer. Git backups are optional, but recommended.

## What Quiltor does

| Writing | Worldbuilding | Managing places | Time |
| --- | --- | --- | --- |
| Chapter editor and focus mode | Characters, animals, places, organizations, objects, and concepts | Dedicated map view with freely placed pins | Dedicated timeline workspace |
| Discreet writing aids and one-word autocomplete | Directed and undirected relationships | Distance measuring with an adjustable scale | Relationship state per moment |
| Chapter notes, versions, and undo/redo | Grid, minimap, and semantic zoom | Automatic stay and journey chronicle per place | Change direction, label, and activity |
| Readable 6 × 9 inch book PDF | Profiles, custom fields, and important elements | Travel duration between places from the timeline | Death markers and animated playback |

### One world graph instead of scattered notes

Elements keep stable positions while relationships may appear, disappear, or change meaning over time. The board provides a subtle grid, free positioning, automatic alignment, a minimap, and a reduced overview zoom.

![Quiltor world graph](docs/screenshots/world-graph.png)

### Places on a map

Places can be positioned freely on their own map, independent of where they sit in the world graph. A ruler tool measures the live distance between two places and converts it into your own units via an adjustable scale. Who was at a place, for how long, and when they moved on falls out automatically from the timeline's presence data — as a chronicle per place and a journey per character. The map and the world graph share the same place data, so there is no duplicated source of truth.

![Quiltor map view of places with distance measuring](docs/screenshots/places.png)

### Timeline playback inside the board

The timeline strip plays the world's development without moving elements or the camera. Earlier relationship values remain inherited until a moment explicitly overrides them.

![Animated timeline inside the world board](docs/screenshots/timeline-playback.png)

### A workspace made for timeline maintenance

The dedicated timeline page is optimized for editing rather than visualization: order moments, add notes, activate, rename, or reverse relationships, and mark life events. The board and timeline use the same state, so there is no duplicated source of truth.

![Timeline manager](docs/screenshots/timeline-manager.png)

## Local assistant and RAG

The assistant searches chapters, notes, profiles, elements, relationships, and every timeline state as one local knowledge corpus. Answers cite clickable sources. Manuscript prose is readable context; the assistant deliberately has no tool for writing, continuing, or changing prose.

Element, relationship, and timeline changes are returned only as structured proposals. Explicit confirmation applies them as one undoable history step.

The model runtime uses `llama.cpp` (or MLX on Apple Silicon Macs, noticeably faster there). `python3 server.py` asks automatically on first launch if no runtime is set up yet, and downloads it into `runtime/` and `models/` if you agree — no separate command needed. If that prompt was skipped once (or Quiltor is running as a windowed desktop app with no terminal at all, see [Desktop app](#desktop-app)), the assistant panel itself offers a "Set up now" button with a progress bar whenever the assistant reports itself unavailable; that panel state persists across closing and reopening the panel. An interrupted download resumes instead of starting over on the next attempt. To trigger the same install explicitly or unattended instead (e.g. from a script):

```bash
python3 -m backend.llm.installer
```

To use an existing runtime, a different GGUF model, or an existing local endpoint instead, force it with an environment variable:

```bash
QUILTOR_AI_BINARY=/path/to/llama-server \
QUILTOR_AI_MODEL=/path/to/model.gguf \
python3 server.py
```

An existing local runtime can be selected with `QUILTOR_AI_URL`. It must implement the **Quiltor runtime contract**—`GET /health`, `POST /tokenize`, and `POST /v1/chat/completions` with strict JSON-schema enforcement; this is not a general-purpose OpenAI endpoint integration. Both bundled backends use an 8192-token context. All requests stay on loopback.

The real assistant test starts the runtime, fixture world, and Quiltor in an isolated temporary directory and shuts every process down afterwards:

```bash
npm run test:assistant:local                         # one complete run
npm run test:assistant:local -- --runs 3             # acceptance: three runs
npm run test:assistant:local -- --case set-presence  # one scenario
```

### MCP included

`mcp/quiltor_server.py` exposes retrieval and world maintenance to MCP clients. Mutation-like tools only create proposals that require confirmation. There are intentionally no direct apply, delete, Git, filesystem, or manuscript-writing tools.

The bundled `.mcp.json` configures the server for clients that support project-level MCP configuration.

## German writing tools

Manuscripts using the `de-DE` writing language have local dictionary, synonym, and word-translation lookup plus confirmable spelling and grammar checks. Selected text can be looked up, but insertion, replacement, and correction happen only after an explicit action and remain undoable.

The guided `quiltor install` command includes these tools by default. Language data is stored under `data/language/`, or `~/.quiltor/data/language/` for a pipx installation. LanguageTool requires Java 17 or newer; browser spellchecking remains available without it. External LanguageTool-compatible services are used only with `QUILTOR_LANGUAGETOOL_EXTERNAL_OPT_IN=1`. Without that opt-in, neither manuscript text nor search terms leave the device.

Sources, versions, checksums, licenses, and attribution are recorded in the installation manifest and in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Quick start

Requires Python 3.11 or newer (usually callable as `python` on Windows, `python3` on macOS/Linux). The built client already lives in `dist/` — nothing else to install for the editor and local storage.

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

## Desktop app

macOS and Windows also get a real double-click app — a native window instead of a
browser tab, no terminal or Python install needed. Build it yourself:

```bash
python -m venv .venv-desktop && source .venv-desktop/bin/activate  # Windows: .venv-desktop\Scripts\activate
pip install -e ".[desktop]" pyinstaller

./packaging/build_macos.sh                     # → packaging/dist/Quiltor.app
powershell -File packaging/build_windows.ps1    # → packaging/dist/Quiltor/Quiltor.exe
```

Unsigned for now: macOS shows "unidentified developer" (right-click → Open once),
Windows shows SmartScreen (More info → Run anyway). PDF export uses the system's
installed Chrome/Edge instead of a bundled download. See
[`packaging/README.md`](packaging/README.md) for build details, signing, and why
Mac App Store distribution isn't realistic without a sandboxing rework.

## Web demo with Keycloak

Quiltor can also run as a small multi-user demo on the web: login through an existing Keycloak instance, with every signed-in person seeing only their own worlds. Without the environment variables below, Quiltor stays exactly the local single-user mode described above — the web mode is purely additive and has to be turned on explicitly.

**1. Create a Keycloak client** (in your existing realm):

- Client authentication: on (confidential client, issues a client secret)
- Standard flow: on · Direct access grants: off
- Valid redirect URI: `https://<your-domain>/auth/callback`
- Advanced settings → PKCE method: `S256`

**2. Set environment variables:**

| Variable | Purpose |
| --- | --- |
| `QUILTOR_OIDC_ISSUER` | Realm issuer URL, e.g. `https://kc.example.com/realms/quiltor`. **Unset = local mode**, everything else below is skipped. |
| `QUILTOR_OIDC_CLIENT_ID` | Client ID of the client created above. |
| `QUILTOR_OIDC_CLIENT_SECRET` | The matching client secret. |
| `QUILTOR_PUBLIC_URL` | Public base URL, e.g. `https://quiltor.example.com` — must exactly match the redirect URI in the Keycloak client. |
| `QUILTOR_COOKIE_SECURE` | `auto` (default, based on `X-Forwarded-Proto`) · `0` · `1` — only relevant for local OIDC testing without HTTPS. |
| `QUILTOR_DATA_DIR` | Already exists; point it at the mounted volume inside the container. |

**3. Start with Docker Compose** ([`docker-compose.yml`](docker-compose.yml)):

```bash
cp .env.example .env   # then fill in: issuer, client ID/secret, public URL
docker compose up -d
```

The `quiltor` service is then only reachable on `127.0.0.1:${QUILTOR_PORT:-8000}` — point your **existing** reverse proxy (the one already serving Keycloak) at it. Caddy and nginx examples live in [`deploy/`](deploy/); both forward `Host` and `X-Forwarded-Proto`, which `server.py` needs to build the exact redirect URI and mark cookies `Secure` correctly.

If you don't have a reverse proxy yet and want this stack to handle TLS itself (automatically via Let's Encrypt), start Caddy alongside it:

```bash
docker compose --profile with-caddy up -d
```

That brings up Caddy on port 80/443, terminates TLS for `QUILTOR_PUBLIC_URL`, and forwards internally to `quiltor:8000` ([`deploy/Caddyfile.compose`](deploy/Caddyfile.compose)).

Without Compose, `docker build`/`docker run` also work directly — see [`Dockerfile`](Dockerfile).

The Docker image is based on Microsoft's official Playwright image (instead of a slim Python image) because `/api/book.pdf` renders through a real headless Chromium in web mode too — Node, Playwright, and its system libraries need to be present at runtime, not just at build time.

Sessions live in process memory (no separate session store) — restarting the container signs everyone out; they just log back in. For a small demo, that's an acceptable trade-off.

**Prebuilt images:** every version bump (the `VERSION` file) on `main` automatically triggers a release — prebuilt images then become available at `ghcr.io/tim3399/quiltor:<version>` and `:latest` (Docker image names must be lowercase). In `docker-compose.yml`, `image: ghcr.io/tim3399/quiltor:${QUILTOR_VERSION:-latest}` can be used instead of the local `build:` block to skip building locally.

Each [GitHub release](https://github.com/Tim3399/quiltor/releases) also ships a pip wheel (`pip install quiltor-<version>-py3-none-any.whl`, which then gives you the `quiltor` command).

**The `quiltor` CLI** (pip/pipx installs only, not `python3 server.py`) is built so that you normally never have to set a single environment variable by hand locally — data, runtime, and model land automatically under `~/.quiltor/` (configurable via `QUILTOR_HOME`), and Keycloak/LLM settings are asked for interactively and stored in `~/.quiltor/config.env`. Plain environment variables remain the escape hatch for local edge cases — and the primary configuration path if you deploy with Docker instead (see above):

```bash
quiltor install   # guided setup: Keycloak (default no), German writing tools and local AI assistant (default yes each)
quiltor           # starts Quiltor on port 8000, same as python3 server.py
quiltor run 8080  # different port
quiltor config set|get|list|unset <KEY> [VALUE]   # emergency access to any QUILTOR_* variable
quiltor config path        # prints the path of the config file
quiltor --version
```

## Local means local

- Every world has a separate SQLite file under `data/worlds/`.
- SQLite is the only authoritative data source.
- Markdown mirrors keep manuscripts and profiles readable outside the app.
- Automatic SQLite backups can be restored locally.
- Revision checks prevent stale browser tabs from overwriting newer changes.
- Every world keeps a local Git history from the start — even with no remote repository at all. A repository link (see [Quick start](#quick-start)) additionally unlocks `git push`; without one, "Commit only" in the Git dialog is still available.
- Git backups are fully separated from the Quiltor source repository.
- World content, models, backups, and repositories are excluded from public version control.

## Keyboard controls

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl + S` | Save immediately |
| `Cmd/Ctrl + Shift + S` | Open Git |
| `Cmd/Ctrl + F` or `Cmd/Ctrl + K` | Open search & commands – search chapters, elements, and moments, or run a command |
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

The build checks TypeScript and rejects color, spacing, radius, shadow, font-size, and z-index literals outside `src/design/colors.css` and `src/design/tokens.css`. Browser tests cover desktop and compact layouts, light and dark themes, autosave, conflicts, and WCAG A/AA checks for the core workspaces.

`npm run check:i18n` heuristically scans `.tsx` files for hardcoded visible text outside `t()` calls and statically checks German/English key parity. It is part of `npm run build`; all interface text belongs in `src/language/{de,en}/*.ts`.

Demo screenshots can be reproduced against a separate test server:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8125 node scripts/capture-readme.mjs
```

## Architecture

```text
backend/                    SQLite, backups, retrieval, assistant, Git, Keycloak login (auth.py)
mcp/                        read-only and proposal-only MCP server
desktop.py                  desktop app entry point (native window instead of a browser tab)
packaging/                  PyInstaller spec, build scripts, and icon assets for the desktop app
src/
├── app/                    application shell and navigation
├── design/                 color and design tokens (colors.css, tokens.css)
├── features/
│   ├── manuscript/         editor, focus mode, writing aids
│   ├── figures/            world graph and relationship logic
│   ├── places/             map view, distance measuring, stays and journeys
│   ├── timeline/           timeline management
│   ├── assistant/          local chat, citations, proposals
│   ├── tools/              search, history, Git, backups
│   └── worlds/             world selection and creation
├── hooks/                  autosave, theme, undo/redo
├── language/               German and English interface, one folder per language with a file per application area
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
