# Installation and operation

How Quiltor is started, installed and run: from source, as a Python package, as a desktop app, with Docker and through the CLI.

## Quick start

Without technical background: [installation and first writing tasks](../GETTING-STARTED.md).
The commands below describe running from source.

Requires **Python 3.12+**.

```bash
git clone https://github.com/Tim3399/quiltor.git
cd quiltor
python3 apps/web/server.py
```

On Windows, use `py -3.12 apps/web/server.py` to select the supported Python series explicitly.

Quiltor opens `http://localhost:8000` by default. Choose **New world** in the world selection to create your first project. Startup does not wait for AI setup or download a model. You can explicitly set up the optional assistant later in its sidebar.

Open the world, select or create a manuscript chapter, and start writing. Leave the optional
backup endpoint empty if you do not use one. Model download and assistant setup are not
required for this path. The shared search finds chapters and world elements; analysis can
later target the active chapter or an explicitly selected group of chapters.

CLI/Python packaging, local desktop builds, and Docker deployment are also implemented. See the platform status below for the distinction between build support and available release artifacts.

## Platform and distribution status

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
[`distribution/release-targets/`](../../distribution/release-targets/). Both markers are currently absent.
The Python web host can run on Linux; that is separate from the unfinished native AppImage target.

A distribution profile on its own does not mean a published app. What counts are the [target matrix](../../distribution/README.md), the [release activation](../../distribution/release-targets/README.md) and the release artifacts that actually exist.

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
until both answer, and stops both together on Ctrl+C. Vite proxies API requests to port 8010; without the server the page loads and only reports that it cannot reach it. The normal application and Docker port remains **8000**.

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
`.\.venv-desktop\Scripts\Activate.ps1` to activate it. For PDF export there, also run `python -m pip install -e ".[desktop,browser-pdf]"`.

Installer builds use a **separate clean environment** with the exact CPython and build tools from
[`distribution/toolchains.json`](../../distribution/toolchains.json), the hash-locked bootstrap,
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

More details and the complete target matrix: [`distribution/README.md`](../../distribution/README.md)

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

Realm, roles and session:

- Realm `quiltor` with the client scope `quiltor-roles`. The scope puts the realm roles into the flat `roles` claim of the ID token; only that claim counts, Quiltor reads neither `realm_access` nor `resource_access`.
- Only accounts with the role `premium` (set with `QUILTOR_PREMIUM_ROLE`) may use the AI assistant. Without it the server answers `403 assistant.premium_required`, and the interface shows a notice.
- Roles are read again at every token refresh; a role granted or withdrawn takes effect without signing in again. They are read from the ID token in the refresh response: if Keycloak sends no ID token with the refresh, the previous roles stay, and a withdrawal only takes effect at the next sign-in. With the `openid` scope Keycloak includes the ID token by default; the mapper of the `quiltor-roles` scope needs "Add to ID token".
- The realm decides how long a session lasts (idle and maximum). When Keycloak ends the session, Quiltor answers `401` at the next refresh. Unsaved text stays in the editor and as a draft on the device until the author signs in again in a new tab.

Environment variables:

| Variable                          | Purpose                                                    |
| --------------------------------- | ---------------------------------------------------------- |
| `QUILTOR_OIDC_ISSUER`             | Realm issuer, e.g. `https://kc.example.com/realms/quiltor` |
| `QUILTOR_OIDC_CLIENT_ID`          | Client ID                                                  |
| `QUILTOR_OIDC_CLIENT_SECRET`      | Client secret                                              |
| `QUILTOR_PUBLIC_URL`              | Public Quiltor URL                                         |
| `QUILTOR_COOKIE_SECURE`           | `auto` / `0` / `1`                                         |
| `QUILTOR_HOST`                    | Bind address                                               |
| `QUILTOR_MASTER_TOKEN`            | Only relevant without OIDC                                 |
| `QUILTOR_DATA_DIR`                | Data directory inside the container                        |
| `QUILTOR_PREMIUM_ROLE`            | Role for the AI assistant; default `premium`               |
| `QUILTOR_ASSISTANT_MAX_OPEN_JOBS` | Open assistant jobs per account (1–100); default `3`       |

### Reverse proxy and limits per account (from 3.26)

| Variable                              | Purpose                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| `QUILTOR_TRUSTED_PROXIES`             | IP addresses of the reverse proxies in front of Quiltor, comma-separated; default: none |
| `QUILTOR_MAX_WORLDS_PER_ACCOUNT`      | Worlds per account, trash included; default `50`                                        |
| `QUILTOR_MAX_WORLD_BYTES_PER_ACCOUNT` | Storage of all worlds of one account in bytes; default 2 GiB                            |
| `QUILTOR_GRAMMAR_MAX_CONCURRENT`      | Grammar checks per account at once; default `2`                                         |
| `QUILTOR_GRAMMAR_MAX_PER_MINUTE`      | Grammar checks per account and minute; default `30`                                     |
| `QUILTOR_MAX_HANDLER_THREADS`         | Request threads of the web server; default `128`                                        |
| `QUILTOR_ASSISTANT_CLIENT_JOBS`       | Assistant jobs with the in-browser AI at once; default `8`, at most `16` makes sense    |

- **Every deployment behind a proxy needs `QUILTOR_TRUSTED_PROXIES`.** Quiltor believes
  `X-Forwarded-For` only from these addresses. Without it every request counts as one from
  the proxy, and the limit on sign-in attempts per client address does not work. Networks and
  names are not allowed. The bundled Caddy has a changing address in the Docker network; give
  the container a fixed one or set your proxy's address.
- **`QUILTOR_ASSISTANT_CLIENT_JOBS` above 16:** the server has 16 slots for the relay of the
  in-browser AI. More jobs at once get `503` at the relay, ask again and go round in circles.

The limits per account apply to a hosted instance only. For every world of the account,
including those in the trash, they count the world database, its automatic backups, the
mirror folders and the saved versions (`data/history`). Once an account is at the limit,
Quiltor refuses creating, importing, saving, "Keep version", map images and restoring with
`403 world.quota`. Unsaved text stays on the device as a draft. Reading and deleting stay
allowed: deleting a world, removing old versions or emptying the trash brings the account
back under the limit at once.

### Content Security Policy (from 3.26)

Every page carries a Content Security Policy and `X-Frame-Options: DENY`. `QUILTOR_CSP`
picks the mode:

| Deployment                                | Default       | Way out                                                |
| ----------------------------------------- | ------------- | ------------------------------------------------------ |
| Hosted (with Keycloak)                    | `enforce`     | `QUILTOR_CSP=report-only`, `QUILTOR_CSP_CONNECT_EXTRA` |
| Web without Keycloak (local, self-hosted) | `enforce`     | `QUILTOR_CSP=report-only`, `QUILTOR_CSP_CONNECT_EXTRA` |
| Desktop app                               | `report-only` | –                                                      |

- `enforce` blocks what the policy does not allow. `report-only` only reports it in the
  browser console: a way out while you report a problem, not a setting to keep. `off` sends
  no policy.
- `QUILTOR_CSP_CONNECT_EXTRA` adds origins to `connect-src`, separated by spaces, exact
  `https://` origins only, without path or wildcard.
- **Hugging Face changes its download hosts from time to time.** When the in-browser
  assistant stops loading its model and the console shows a CSP error, add the blocked
  origin from the console to `QUILTOR_CSP_CONNECT_EXTRA`.
- Whatever the mode, Quiltor cannot be embedded in another site's page.
- **The desktop app stays on `report-only` (D-207).** pywebview, which the desktop window is
  built on, injects its code with `eval` or `evaluate_js` and hands every result of saving and
  exporting back to the page the same way. WKWebView on macOS applies the page's policy to
  that, so under `enforce` saving and exporting would be blocked without a word (CI run
  43605654505 on macOS 15). Windows (WebView2) is not affected. An `'unsafe-eval'` for the
  desktop alone would weaken the policy exactly there and is not an option.

Start:

```bash
cp .env.example .env
docker compose up -d
```

The Compose service is normally bound locally; point your existing reverse proxy at Quiltor. Example Caddy and nginx configurations live under [`distribution/web/self-hosted/proxy/`](../../distribution/web/self-hosted/proxy/).

Optionally let the stack run Caddy itself:

```bash
docker compose --profile with-caddy up -d
```

Caddy then terminates TLS and forwards internally to `quiltor:8000`.

Without Compose, use the [`Dockerfile`](../../Dockerfile) directly.

For book-PDF export, the Docker image contains only the Chromium Headless Shell
matching its Playwright runtime. Firefox, WebKit, full Chromium, and development
tooling, including Playwright's separate ffmpeg payload, are deliberately
excluded from the runtime image. The extracted browser tree is also verified
against its committed SHA-256 during the build.

Sessions live in process memory. Restarting the container therefore signs web users out.

Where the server log lives, how to find an error ID in it and how to set the log level and log file is described in [`docs/operations/logging.md`](logging.md).

### Prebuilt container images

A version bump in `VERSION` on `main` triggers the release pipeline. Its configured image tags are:

```text
ghcr.io/tim3399/quiltor:<version>
ghcr.io/tim3399/quiltor:latest
```

Use the release assets and completed workflow runs to check which version is available.

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

Models can be kept elsewhere, for example to share them with other tools:

```text
QUILTOR_MODELS_DIR
```

The folder must exist (Quiltor does not create it) and contains `gguf/*.gguf` for llama.cpp
and `mlx/<model>/` with `config.json` for MLX. Without the variable everything stays under
`QUILTOR_HOME/models`. The runtime and llama-server always stay under `QUILTOR_HOME`;
existing models are not moved.

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
