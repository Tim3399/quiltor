# Quiltor

[Deutsch](README.md) · [English](README.en.md)

> ## You write the story. Quiltor keeps the world straight.
>
> **A local-first writing workspace for people who actually want to write.**  
> Manuscript, characters, relationships, places, timeline, and storyboards in one place — with local AI for the work **around** writing, never for the writing itself.

![Quiltor manuscript workspace](docs/screenshots/manuscript.png)

Quiltor is a writing environment for novels and other long-form fiction. Instead of spreading your manuscript, character sheets, timeline, maps, and notes across several applications, Quiltor connects them into one shared fictional world.

Its local assistant may understand that world, search it, and prepare structured changes. **It deliberately has no tool for writing, continuing, or rewriting manuscript prose.**

**Local-first · On-device AI · macOS / Windows / Browser · Source-available**

[**Quick start**](#quick-start) · [**Features**](#a-writing-workspace-not-an-ai-ghostwriter) · [**Technical documentation**](#technical-documentation) · [**Releases**](https://github.com/Tim3399/quiltor/releases)

---

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

---

## One world instead of scattered notes

Quiltor does not treat worldbuilding as a pile of unrelated text fields. Characters, places, relationships, and timeline share the same underlying world.

### Manuscript: write without the interface getting in the way

The chapter editor stays quiet and gives the prose room. Focus mode, undo/redo, formatted chapter notes, local history, discreet writing aids, and one-word autocomplete support the writing process without taking it over.

Chapters and folders form a nested binder. Drag chapters or whole folders to change their reading order, collapse branches, and follow folder breadcrumbs in search results. Continued scrolling at a chapter boundary reveals the previous or next chapter; an explicit navigation action is available as well.

Each chapter can refer to a story-time moment or range independently of its position in the book. Flashbacks and parallel scenes keep their place in the manuscript without changing the world's chronology.

A readable 6 × 9 inch book PDF can be exported from the manuscript.

### Characters and relationships: see what belongs together

Characters and other world elements live in a visual graph. Relationships may be directed or undirected, change meaning, start, or end.

![Quiltor world graph](docs/screenshots/world-graph.png)

The graph is not a second copy of your data: timeline, relationships, and elements use the same state.

### Places: understand the world spatially

Places have their own map and can be positioned freely, independently from their position in the world graph.

A ruler measures distances between places and converts them through an adjustable scale into your own units.

![Quiltor map view with distance measurement](docs/screenshots/places.png)

Timeline presence data automatically produces:

- a stay chronicle for each place
- a journey history for each character
- temporal gaps between moves

### Timeline: the world changes

Stories are not static. A friendship can break, a character can move, an object can become important, and a character can die.

Quiltor models those changes along the timeline instead of storing only the latest state.

![Animated timeline in the world graph](docs/screenshots/timeline-playback.png)

The dedicated timeline workspace is built for maintenance: order moments, add notes, change relationship states, and mark life events. Signed relative time supports events before and after a chosen origin, including simultaneous events. Gregorian and custom calendar projections give the same timeline readable dates without making chapter order its clock.

![Timeline manager](docs/screenshots/timeline-manager.png)

### Storyboard: room for unfinished ideas

Storyboard is the fifth workspace. Create multiple boards, pan and zoom, and arrange resizable **note**, **reference**, **board**, and **group** cards. Connect cards, control their front-to-back order, and navigate linked boards through breadcrumbs.

Search for a figure, place, timeline moment, chapter, or board and drag the result onto the canvas. The card links to the original object; opening it returns to the corresponding workspace. Notes can be edited directly on the canvas or in the shared notes focus mode. Autosave and undo/redo cover storyboard changes independently.

Storyboard text and connections are planning material. Saving an idea does not create a canonical relationship, presence assignment, or timeline fact.

### Shared notes and references

Chapter notes, world notes, and storyboard notes share bold, italic, headings, and a focused editing view. Type `@` to link an existing project object. References use stable IDs, so navigation and backlinks can still find the source after an object is renamed or a chapter moves to another folder.

Profiles and other reference targets show where they are mentioned, including the exact storyboard card. Search and assistant retrieval retain the underlying plain text alongside formatting and reference metadata.

---

## A local assistant that cannot write your book

The assistant runs through a local model using `llama.cpp` or, on Apple Silicon, MLX.

It can:

- search manuscript and world knowledge
- answer questions about the story
- cite sources from the project
- analyse characters, places, relationships, and timeline state
- prepare structured changes as proposals
- process broad tasks chapter by chapter in batches
- discover world elements from selected manuscript chapters, resolve names and aliases against existing objects, and propose additions or updates
- retrieve storyboard notes for read-only questions, explicitly labelled as planning context

It cannot:

- write a scene
- continue a chapter
- rewrite prose
- silently apply changes

World changes are returned as reviewable proposals. Only explicit confirmation applies them to the project, as one undoable history step.

The manuscript is readable context for the assistant — never a writing surface for it.

Planning context is kept out of mutation and extraction requests. Automatic promotion of storyboard ideas into canon, dedicated AI planning workflows, and persistent continuity findings remain roadmap work; see [`docs/TODO.md`](docs/TODO.md).

---

## Local-first means your project belongs to you

A local Quiltor setup needs no cloud account.

Every world is stored in its own SQLite database on your machine. Manuscript and profile data are additionally mirrored into readable Markdown files. Automatic local backups and project history are part of the storage model.

Remote backup is optional and can be run against your own backup endpoint.

The assistant remains local as well:

- model runtime on loopback
- no mandatory cloud AI provider
- external LanguageTool-compatible services only after explicit opt-in
- no manuscript-writing tools in the assistant or MCP

---

## What is included today

Current repository version: **3.16.3**.

| Area                 | Capabilities                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Manuscript           | Chapter editor, nested folders, drag-and-drop ordering, boundary-scroll navigation, focus mode, story-time anchors, book PDF                     |
| Figures and world    | Profiles and custom fields, aliases, relationship graph, directed and temporal relationships, minimap, important/pinned elements                 |
| Places               | Dedicated map, imported map images, free placement, configurable distance scale, stays and journey chronicles                                    |
| Timeline             | Signed relative time, simultaneous events, Gregorian/custom calendars, presence, relationship states, life events, graph playback                |
| Storyboard           | Multiple linked boards, notes/references/groups, connections, drag-and-drop search results, resizing, layer ordering                             |
| Notes and navigation | Shared formatting and focus mode, stable `@` references, backlinks, cross-workspace search                                                       |
| Assistance           | Local LLM, citations, world discovery from manuscripts, name/alias resolution, proposals, batches, read-only planning context, proposal-only MCP |
| Writing tools        | Local German dictionary, synonyms, word translation, spelling and grammar tools                                                                  |
| Storage              | Per-world SQLite, autosave, revision checks, undo/redo, local history, snapshots, optional authenticated remote backup                           |

---

## Who is Quiltor for?

Quiltor is especially useful if you:

- want to write yourself rather than use AI as a ghostwriter
- work on long novels or series
- need to keep many characters, places, and relationships straight
- do not want timeline and world knowledge scattered across spreadsheets
- want manuscript and world data to remain local
- think visually but still need a real writing application

Quiltor is under active development. Its focus is a calm writing workflow, a connected fictional world, and transparent local assistance.

---

# Quick start

Requires **Python 3.12+**.

```bash
git clone https://github.com/Tim3399/quiltor.git
cd quiltor
python3 apps/web/server.py
```

On Windows, use `py -3.12 apps/web/server.py` to select the supported Python series explicitly.

Quiltor opens `http://localhost:8000` by default and creates an empty world on first launch. If no local assistant is installed, Quiltor asks before downloading anything; the rest of the application works without the assistant.

CLI/Python packaging, local desktop builds, and Docker deployment are also implemented. See the platform status below for the distinction between build support and available release artifacts.

---

# Technical documentation

The following sections cover installation, the local runtime, authentication, backup, desktop/Docker operation, MCP, development, and architecture.

## Contents

- [Installation options](#installation-options)
- [Platform and distribution status](#platform-and-distribution-status)
- [Local assistant and runtime contract](#local-assistant-and-runtime-contract)
- [MCP](#mcp)
- [German writing tools](#german-writing-tools)
- [Local access and authentication](#local-access-and-authentication)
- [Desktop app](#desktop-app)
- [Docker and web demo](#docker-and-web-demo)
- [CLI](#cli)
- [Backup and Keycloak](#backup-and-keycloak)
- [Local data, history, and restore](#local-data-history-and-restore)
- [Keyboard controls](#keyboard-controls)
- [Development and quality](#development-and-quality)
- [Architecture](#architecture)
- [Status and license](#status-and-license)

---

## Installation options

### Run directly from the repository

The built web client already lives in `dist/`. Node dependencies are not required for normal editing and local storage.

```bash
git clone https://github.com/Tim3399/quiltor.git
cd quiltor
python3 apps/web/server.py
```

Other start options:

```bash
python3 apps/web/server.py 8080            # custom port
python3 apps/web/server.py 8080 --no-open  # do not open a browser
python3 apps/web/server.py --print-token   # show this run's access token
```

### Python wheel / pip / pipx

The release pipeline builds a Python wheel and source distribution for GitHub Releases. Install the wheel attached to the release you choose; the repository does not currently configure publication to PyPI.

```bash
pip install quiltor-<version>-py3-none-any.whl
quiltor
```

The package requires Python 3.12 or newer. Its core dependencies include `typer` for the CLI and `PyJWT[crypto]` for OIDC verification.

The base wheel deliberately reports PDF export as unavailable instead of
silently downloading a browser runtime. For PDF export from the **installed
wheel**, install the verified extra (substitute the release URL and version):

```bash
python -m pip install "quiltor[browser-pdf] @ https://github.com/Tim3399/quiltor/releases/download/v<version>/quiltor-<version>-py3-none-any.whl"
```

The extra pins the PyPI-published Python library Playwright 1.61.0 and drives an
already installed Google Chrome or Microsoft Edge. It needs neither system
Node.js nor a separate Chromium
download. Without the extra or a supported browser, export remains disabled
with an explicit capability message.
The self-hosted OCI host is a separate artifact path: it uses the Playwright
1.61.1 npm/browser runtime from its digest-bound base image. Both pins are
recorded separately in `distribution/toolchains.json` and the release gate
checks them against the installed artifacts.
The wheel host resolves web assets and its bundled render script exclusively
from package resources; it does not fall back to an incidental source checkout.
Capability selection remains separate: without the extra it deterministically
uses the typed unavailable renderer.

### Development

A run directly from the **source checkout** instead uses the bundled JavaScript
renderer. Frontend development and this PDF path require Node.js, the project
dependencies and the verified Chromium:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -e . ruff==0.16.4
npm ci
npx playwright install chromium
npm start
```

On Windows, create the environment with `py -3.12 -m venv .venv`, activate it with
`.\.venv\Scripts\Activate.ps1`, then run the same `python -m pip install` and npm commands.
The editable install provides dependencies used by the backend tests and the CLI/MCP entry points.

`npm start` brings up the API server on **8010** and Vite on **5173**, waits
until both answer, and stops both together on Ctrl+C. Vite proxies API requests to port 8010. The normal application and Docker port remains **8000**.

To run the halves separately:

```bash
npm run dev
```

Run alongside:

```bash
python3 apps/web/server.py 8010 --no-open
```

On Windows, use `py -3.12 apps/web/server.py 8010 --no-open`.
`QUILTOR_API_PORT` and `QUILTOR_DEV_PORT` override the development launcher ports;
`PLAYWRIGHT_BASE_URL` overrides the product test target.

### Platform and distribution status

Build profiles describe implementation status, not a promise that an artifact exists for every release.

| Target                            | Current status                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Browser / self-hosted web         | Implemented Python HTTP host, committed web client, Docker/OCI build, optional OIDC                         |
| Python package                    | Implemented wheel/sdist and CLI; base package has no PDF renderer, with `browser-pdf` available as an extra |
| macOS direct, Apple Silicon       | Implemented local desktop and DMG build; hosted release job is currently inactive                           |
| Windows direct, x86_64            | Implemented local desktop and installer build; hosted release job is currently inactive                     |
| Linux AppImage                    | Distribution scaffold; no completed AppImage pipeline                                                       |
| macOS App Store / Microsoft Store | Distribution and metadata scaffolds; no completed store builds                                              |
| iOS / Android                     | Native host and distribution scaffolds; no completed mobile application                                     |

The macOS and Windows hosted jobs require separate activation markers under
[`distribution/release-targets/`](distribution/release-targets/). Both markers are currently absent.
The Python web host can run on Linux; that is separate from the unfinished native AppImage target.

---

## Local assistant and runtime contract

The assistant searches chapters, notes, profiles, elements, relationships, and timeline states. Read-only questions may also retrieve storyboard notes, with planning provenance kept separate from manuscript and canonical world context. Answers may cite clickable project sources.

World discovery processes selected chapters as source material, resolves names and aliases before creating objects, and presents changes for review. Ambiguous matches can require clarification; author confirmation remains the point at which proposals change the world.

The model runtime uses:

- `llama.cpp`
- optional MLX on Apple Silicon Macs

On first launch, Quiltor can install the appropriate runtime and model after explicit confirmation. A direct repository checkout stores these under `runtime/` and `models/`.

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

`QUILTOR_AI_URL` is **not a generic OpenAI-provider integration**. The runtime must implement Quiltor's stable local contract:

```text
GET  /health
POST /tokenize
POST /v1/chat/completions
```

`/v1/chat/completions` must actually enforce the strict JSON schemas requested by Quiltor.

The bundled runtime backends currently use an 8192-token context window. Requests to the bundled runtime remain on loopback.

### Real local-assistant test

```bash
npm run test:assistant:local
npm run test:assistant:local -- --runs 3
npm run test:assistant:local -- --case set-presence
```

The test starts the runtime, fixture world, and Quiltor inside an isolated temporary directory and shuts everything down afterwards.

---

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

---

## German writing tools

Manuscripts using writing language `de-DE` currently have local:

- dictionary lookup
- synonyms
- word translation
- spelling checks
- grammar checks

Selected text can be looked up. Insertion, replacement, and correction happen only after an explicit action and remain undoable.

The guided setup installs the language tools by default:

```bash
quiltor install
```

Data is stored under:

```text
data/writing-assistance/
```

or, for pipx/CLI installations:

```text
~/.quiltor/data/writing-assistance/
```

Existing data in the former `data/language/` directory is migrated safely on first launch;
no manual move is required.

LanguageTool requires **Java 17+**. Browser spellchecking remains available without it.

External LanguageTool-compatible services are only used when:

```bash
QUILTOR_LANGUAGETOOL_EXTERNAL_OPT_IN=1
```

is set. Without that opt-in, chapter text and lookup terms used by this feature stay on the device.

Sources, versions, checksums, licenses, and attribution are recorded in the installation manifest and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

---

## Local access and authentication

There is no "authentication off" mode. Every request has an identity; locally, that identity is simply the person at the machine.

Without `QUILTOR_OIDC_ISSUER`, Quiltor uses the **local identity**:

- one user
- no login page
- no account management

Access is recognised in this order:

1. `Authorization: Bearer <token>` — scripts and MCP
2. `?token=<token>` — one-time browser entry; the redirect strips the parameter
3. loopback connection — ordinary case for desktop, CLI, and `python3 apps/web/server.py`

The automatically generated token:

- is created fresh on every process start
- lives only in memory
- is never written to disk
- is only printed when explicitly requested with `--print-token`

| Variable               | Purpose                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `QUILTOR_MASTER_TOKEN` | Pins the token. Intended for tests or instances not bound to loopback. Do not store it in `~/.quiltor/config.env`. |
| `QUILTOR_HOST`         | Bind address; defaults to `127.0.0.1`.                                                                             |

An instance bound to `0.0.0.0` without OIDC cannot rely on the local loopback identity and therefore requires a token. For a persistent web deployment, OIDC/Keycloak is the intended path.

### Troubleshooting

| Symptom                                     | Fix                                                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `python3: command not found`                | On Windows, use `py -3.12`; inside an activated virtual environment, use `python`.                   |
| Assistant reports "Local model unavailable" | Run `PYTHONPATH=src python3 -m quiltor.infrastructure.inference.installer`, then restart the server. |
| Download is interrupted                     | Run the installer again; complete files are reused.                                                  |
| Firewall/antivirus flags `llama-server.exe` | The binary comes from the official llama.cpp release and listens locally.                            |
| Port 8000 is taken                          | `python3 apps/web/server.py 8080`                                                                    |
| Different runtime / model                   | Use `QUILTOR_AI_BINARY`, `QUILTOR_AI_MODEL`, or `QUILTOR_AI_URL`.                                    |

---

## Desktop app

Quiltor can be built as a standalone macOS or Windows desktop application, with a native window and no separate Python installation required on the target machine. Direct build profiles currently target macOS arm64 and Windows x86_64.

To run the desktop host from source in a development environment:

```bash
python3.12 -m venv .venv-desktop
source .venv-desktop/bin/activate
python -m pip install -e ".[desktop]"
quiltor-desktop
```

On Windows use `py -3.12` to create the environment and
`.\.venv-desktop\Scripts\Activate.ps1` to activate it.

Installer builds use a **separate clean environment** with the exact CPython and build tools from
[`distribution/toolchains.json`](distribution/toolchains.json), the hash-locked bootstrap,
and the target-specific requirements. Install those locks instead of an editable project;
the packaging scripts analyze `src/` directly:

```bash
python -m pip install --require-hashes -r distribution/python-build-bootstrap.lock
# macOS arm64:
python -m pip install --require-hashes --no-build-isolation -r distribution/desktop/macos/direct/requirements.lock
# Windows x86_64: use this target lock instead of the macOS lock.
python -m pip install --require-hashes --no-build-isolation -r distribution/desktop/windows/direct/requirements.lock
```

After `npm ci`, run the build command for the target operating system:

```bash
./distribution/desktop/macos/direct/build.sh
powershell -File distribution/desktop/windows/direct/build.ps1
```

Output:

```text
macOS   distribution/artifacts/macos-direct/Quiltor-<version>.dmg
Windows distribution/artifacts/windows-direct/Quiltor-Setup-<version>.exe
```

Local builds are unsigned by default. Windows requires Inno Setup for the installer;
without it the script produces the unpackaged application directory. Hosted macOS and
Windows release jobs are currently inactive until their release-target markers and signing
setup are provided.

The macOS build signs and notarizes automatically when these are configured:

```text
QUILTOR_SIGN_IDENTITY
QUILTOR_NOTARY_PROFILE
```

PDF export uses the installed system browser or the platform-specific renderer rather than unnecessarily bundling a complete browser into every desktop build.

More details and the complete target matrix: [`distribution/README.md`](distribution/README.md)

---

## Docker and web demo

Quiltor can run as a small multi-user deployment behind a reverse proxy. In this mode an existing Keycloak instance authenticates users, and each signed-in person sees only their own worlds.

Quiltor ships **no Keycloak of its own**.

### Keycloak client for the web instance

Recommended settings:

- Client authentication: **on**
- Standard Flow: **on**
- Direct Access Grants: **off**
- Redirect URI: `https://<your-domain>/auth/callback`
- PKCE: `S256`

Environment variables:

| Variable                     | Purpose                                                    |
| ---------------------------- | ---------------------------------------------------------- |
| `QUILTOR_OIDC_ISSUER`        | Realm issuer, e.g. `https://kc.example.com/realms/quiltor` |
| `QUILTOR_OIDC_CLIENT_ID`     | Client ID                                                  |
| `QUILTOR_OIDC_CLIENT_SECRET` | Client secret                                              |
| `QUILTOR_PUBLIC_URL`         | Public Quiltor URL                                         |
| `QUILTOR_COOKIE_SECURE`      | `auto` / `0` / `1`                                         |
| `QUILTOR_HOST`               | Bind address                                               |
| `QUILTOR_MASTER_TOKEN`       | Only relevant without OIDC                                 |
| `QUILTOR_DATA_DIR`           | Data directory inside the container                        |

Start:

```bash
cp .env.example .env
docker compose up -d
```

The Compose service is normally bound locally; point your existing reverse proxy at Quiltor. Example Caddy and nginx configurations live under [`distribution/web/self-hosted/proxy/`](distribution/web/self-hosted/proxy/).

Optionally let the stack run Caddy itself:

```bash
docker compose --profile with-caddy up -d
```

Caddy then terminates TLS and forwards internally to `quiltor:8000`.

Without Compose, use the [`Dockerfile`](Dockerfile) directly.

For book-PDF export, the Docker image contains only the Chromium Headless Shell
matching its Playwright runtime. Firefox, WebKit, full Chromium, and development
tooling, including Playwright's separate ffmpeg payload, are deliberately
excluded from the runtime image. The extracted browser tree is also verified
against its committed SHA-256 during the build.

Sessions live in process memory. Restarting the container therefore signs web users out.

### Prebuilt container images

A version bump in `VERSION` on `main` triggers the release pipeline. Its configured image tags are:

```text
ghcr.io/tim3399/quiltor:<version>
ghcr.io/tim3399/quiltor:latest
```

Use the release assets and completed workflow runs to check which version is available.

---

## CLI

The `quiltor` CLI is available in pip/pipx installations.

Default location for data, runtime, and model:

```text
~/.quiltor/
```

Override with:

```text
QUILTOR_HOME
```

Important commands:

```bash
quiltor install
quiltor
quiltor run 8080
quiltor run --print-token

quiltor config set <KEY> <VALUE>
quiltor config get <KEY>
quiltor config list
quiltor config unset <KEY>
quiltor config path

quiltor --version
```

`quiltor install` guides the local setup. Keycloak is optional by default; German writing tools and the local assistant can be installed during setup.

For Docker, environment variables remain the primary configuration path.

---

## Backup and Keycloak

Keycloak has two separate roles in Quiltor:

|           | Signing in to Quiltor                | Backup endpoint                             |
| --------- | ------------------------------------ | ------------------------------------------- |
| Purpose   | Multi-user web instance              | Remote-backup access                        |
| Required  | No                                   | Yes for the supplied backup endpoint        |
| Client    | confidential                         | backup server confidential + Quiltor public |
| Redirect  | `<QUILTOR_PUBLIC_URL>/auth/callback` | `http://127.0.0.1/*`                        |
| Variables | `QUILTOR_OIDC_*`                     | `QUILTOR_BACKUP_OIDC_*`                     |

Both may use the same realm, but they are technically separate.

### Backup server: confidential client

Example name:

```text
quiltor-backup-server
```

Settings:

- Client authentication: on
- Standard Flow: off
- Direct Access Grants: off

The backup server validates incoming access tokens through Keycloak Token Introspection.

### Quiltor: public backup client

Example:

```text
quiltor-desktop
```

Settings:

- Client authentication: off
- Standard Flow: on
- Direct Access Grants: off
- PKCE: `S256`
- Redirect URI: `http://127.0.0.1/*`

The changing loopback port is intentional. Native applications are expected to support dynamic loopback ports under RFC 8252, so the Keycloak client must not be restricted to one fixed port.

### `quiltor.backup` scope

The supplied backup endpoint requires this scope by default:

```text
quiltor.backup
```

This prevents an arbitrary valid token from the same realm from being enough. The token must explicitly be intended for backup access.

A realm role may additionally be used to make the scope available only to selected accounts.

### Backup-server variables

| Variable                            | Purpose                                      |
| ----------------------------------- | -------------------------------------------- |
| `QUILTOR_BACKUP_OIDC_ISSUER`        | Realm issuer                                 |
| `QUILTOR_BACKUP_OIDC_CLIENT_ID`     | Backup-server client ID                      |
| `QUILTOR_BACKUP_OIDC_CLIENT_SECRET` | Client secret used for introspection         |
| `QUILTOR_BACKUP_PUBLIC_URL`         | Public backup endpoint URL                   |
| `QUILTOR_BACKUP_OIDC_SCOPE`         | Required scope; defaults to `quiltor.backup` |

If required authentication values are missing, the backup endpoint deliberately refuses to start.

Example:

```bash
# Backup server
QUILTOR_BACKUP_OIDC_ISSUER=https://kc.example.com/realms/quiltor
QUILTOR_BACKUP_OIDC_CLIENT_ID=quiltor-backup-server
QUILTOR_BACKUP_OIDC_CLIENT_SECRET=...
QUILTOR_BACKUP_PUBLIC_URL=https://backup.example.com
QUILTOR_BACKUP_OIDC_SCOPE=quiltor.backup

# Quiltor
QUILTOR_BACKUP_URL=https://backup.example.com
QUILTOR_BACKUP_CLIENT_ID=quiltor-desktop
```

The client does not need a duplicate Keycloak issuer setting for the backup service. The endpoint publishes its authorization metadata through:

```text
GET /.well-known/oauth-protected-resource
```

Quiltor reads that metadata before sign-in.

### Backup troubleshooting

| Symptom                                                     | Likely cause                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| Keycloak error page and Quiltor never receives the callback | Loopback redirect is missing or restricted to a fixed port        |
| Endpoint returns 401                                        | Token is missing or expired                                       |
| Endpoint returns 403                                        | Token is valid but lacks the required scope                       |
| Introspection fails                                         | Token and `QUILTOR_BACKUP_OIDC_ISSUER` belong to different realms |

---

## Local data, history, and restore

- Every world has its own SQLite file under `data/worlds/`.
- SQLite is the authoritative data source.
- Manuscript/profile mirrors live per world under `data/manuscripts/<world-id>/` and `data/profiles/<world-id>/`.
- Automatic SQLite backups can be restored locally.
- Revision checks prevent stale browser tabs from overwriting newer changes.
- Every world keeps local version history.
- Snapshots are content-addressed, so unchanged chapters do not need to be stored repeatedly.
- Remote backup is optional.
- World content, models, backups, and history are excluded from public version control.

### Notes for upgrading older versions

Current builds always use an identity. Locally, the local identity takes over; non-loopback instances without OIDC require a token.

Markdown mirrors are now organized per world. Old flat mirror files are not the authoritative source; SQLite remains authoritative.

The server no longer has one process-wide "open world" state, so restoring a world does not require closing a global open-world session first.

---

## Keyboard controls

| Shortcut                         | Action                       |
| -------------------------------- | ---------------------------- |
| `Cmd/Ctrl + S`                   | Save immediately             |
| `Cmd/Ctrl + Shift + S`           | Open backup dialog           |
| `Cmd/Ctrl + F` or `Cmd/Ctrl + K` | Search & commands            |
| `Cmd/Ctrl + Z`                   | Undo                         |
| `Cmd/Ctrl + Shift + Z`           | Redo                         |
| `Esc`                            | Leave focus/temporary mode   |
| `Option/Alt` while dragging      | Temporarily release the grid |

---

## Development and quality

Set up the editable Python environment and npm dependencies described under
[Development](#development). Exact release toolchains are recorded in
[`distribution/toolchains.json`](distribution/toolchains.json): currently Node 22.23.2,
npm 10.9.8, CPython 3.12.10, and Rust 1.98.0. `npm run doctor` reports deviations and
installation hints; release preflight and version bumps require the pinned versions.

Run the independent gates from the repository root:

```bash
npm run doctor
npm run check
npm test
npm run build
PYTHONPATH=src python -m unittest discover -s tests/python -t tests/python -v
cargo test --locked --workspace --all-targets
npm run check:distribution
```

For the backend suite inside the activated environment on Windows PowerShell:

```powershell
$env:PYTHONPATH = "src"
python -m unittest discover -s tests/python -t tests/python -v
```

Use the interpreter from the environment in which you installed the project dependencies.
Inside an activated virtual environment, `python` refers to that environment. For a
launcher-based installation outside a virtual environment, use `py -3.12` for both
dependency installation and the test command.

`npm run check` validates contracts, architecture, design rules, i18n, platform boundaries,
and formatting. It runs the quality tools' own tests, but **does not run the client unit,
Python backend, or browser suites**. `npm run build` additionally checks TypeScript and
produces the web client; `npm test` runs the client unit tests.

The product browser suite needs a Python server on **8010**:

```bash
python3 apps/web/server.py 8010 --no-open
```

Then, in a second terminal:

```bash
npm run test:e2e
```

`npm run test:e2e` runs the product suite followed by the design suite. The design suite
can also run independently with `npm run test:design`; it starts its own Vite server.

**`dist/` is committed and the product suite tests those built files.** After a change
under `packages/client/src`, run `npm run build` before product E2E tests and include the
updated `dist/` in the change. Restart the Python server after backend changes because
an existing process keeps its imported modules. Unit tests and the design suite use source
files, so passing them does not verify the built application.

Browser/E2E tests cover core workspaces, desktop/compact layouts, light/dark mode, autosave, conflicts, and accessibility.

### Developer tools

```bash
# Inspect the actual browser layout with an isolated fixture world; requires npm start.
npm run probe -- --places --compact "document.querySelectorAll('.react-flow__node').length"

# Verify that a regression test fails when the fix is temporarily undone.
node tools/dev/mutate.mjs <file> --from "<fixed text>" --to "<previous text>" -- <test command>

# Compare committed Windows, Linux, and macOS visual baselines.
node tools/dev/baseline-sheet.mjs
```

The mutation helper restores the file afterwards and succeeds only if the test command
fails. The baseline contact sheet serves on port 4180. Platform-specific screenshots are
kept separately because font rasterisation differs; changed baselines need visual review.

### Language and internationalization

Developer-facing code, identifiers, comments, docstrings, logs, errors, test titles, and
diagnostics should be **English**, as specified in [`CLAUDE.md`](CLAUDE.md). German UI
strings, assertions that quote that UI, and German manuscript fixtures are intentional.
The repository still contains some developer-facing German text; the i18n check validates
UI localization and is **not** a general audit of comments, logs, or test titles.

```bash
npm run check:i18n
```

Visible UI text and new translation packs belong in the deliberately prominent root directory:

```text
locales/{de,en,...}/*.ts
```

Adding Spanish, for example, requires exactly one prominent catalog import and `localePackages`
entry in [`locales/index.ts`](locales/index.ts). No other registry or UI code change is needed;
the i18n check automatically enforces directory-to-registry parity. See
[`CONTRIBUTING.md`](CONTRIBUTING.md).

Reproduce README screenshots against a running isolated server:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8125 node tools/documentation/capture_readme.mjs
```

---

## Architecture

```text
apps/                        visible shells and native project roots
├── web/server.py            source-checkout bootstrap
└── mobile/{ios,android}/     future native mobile host scaffolds

src/quiltor/
├── domain/story_world/      pure world logic, chronology, and validation
├── application/             shared use cases and domain-facing ports
├── modules/                 assistant, writing aid, identity, and commerce
├── infrastructure/          SQLite, backup, inference, PDF, platform adapters
├── resources/sidecars/      shipped PDF and inference subprocess assets
├── bootstrap/               composition root for concrete adapters
├── delivery/http/routes/    HTTP endpoints grouped by capability
└── hosts/                   web server, desktop, CLI, and MCP

services/backup-server/      independently deployable backup service
contracts/                   versioned application and native-bridge contracts
crates/                      pure Rust timeline kernel and FFI foundation
distribution/                target profiles, builds, installers, stores, signing
tools/                       quality, evaluation, and documentation tooling

packages/client/src/
├── app/                     composition, shell, session, navigation, overlays
├── config/                  application configuration and branding
├── design/                  design tokens and presentation foundations
├── i18n/                    locale runtime, provider, and catalog loader
├── modules/
│   ├── manuscript/          editor and writing aids
│   ├── story-world/         figures, places, timeline, and world management
│   ├── storyboard/          independent visual planning workspace
│   ├── graph/               shared graph interaction and presentation
│   ├── assistant/           local assistant
│   ├── identity/            sign-in and identity
│   ├── backup/              local backup restoration
│   ├── history/             history and snapshots
│   ├── search/              search and navigation
│   ├── notes/               linked notes
│   └── world-references/    reference projections and backlinks
├── platform/                application ports, HTTP transport, host adapters
└── shared/                  domain-neutral foundations only

locales/                      contributor-friendly UI translation packs
```

Dependency direction is intentional:

```text
Hosts/Delivery → Application use cases → Domain
Bootstrap → Application ports + concrete infrastructure adapters
Domain/Application ↛ infrastructure/delivery/hosts
```

The normative target component model and current-state assessment live in
[`docs/architecture/target-component-model.md`](docs/architecture/target-component-model.md).
The approved implementation sequence, complexity triggers and exit gates live
in [`docs/architecture/implementation-plan.md`](docs/architecture/implementation-plan.md).

The normal server path stays small and local; additional capabilities are added through clearly separated modules and distribution extras.

Python application services and SQLite remain the authoritative implementation and storage
path. The Rust crates currently provide a small pure timeline kernel and its ABI/FFI
foundation; they do not yet replace Python persistence or provide complete native mobile
hosts. Manuscript, Story World, and Storyboard are independently revisioned documents.
Figures, Places, and Timeline project the same Story World; Storyboard remains separate
author-owned planning data.

---

## Status and license

Quiltor **3.16.3** is under active development. The current five-workspace workflow is
implemented; deeper evidence/provenance, persistent findings, incremental analysis, and
dedicated AI storyboard workflows are tracked in [`docs/TODO.md`](docs/TODO.md).

Quiltor is **source-available, not open source**. The source is public, modifiable, and redistributable, while commercial use by larger organizations is restricted.

It is offered under your choice of:

- [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)
- [PolyForm Small Business License 1.0.0](https://polyformproject.org/licenses/small-business/1.0.0)

See [LICENSE](LICENSE).

### Free without asking

- noncommercial use: personal projects, hobby work, study, teaching, research, charities, and public institutions
- commercial use under the PolyForm Small Business License: fewer than 100 employees/independent contractors and less than USD 1,000,000 total revenue in the previous tax year

Self-employed authors are effectively always within the small-business threshold.

Commercial use above that threshold requires an individual agreement:

**tim.ratermann@outlook.de**

Details: [COMMERCIAL.md](COMMERCIAL.md)

Release packages additionally contain third-party software and model weights under their own licenses. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
