# Quiltor desktop app

Turns Quiltor into a real double-click app for macOS and Windows: `desktop.py`
starts the same `server.py` used by `python3 server.py`/`quiltor run` in a
background thread, waits for it to come up, and shows it in a native OS window
(WKWebView on macOS, WebView2 on Windows) via [pywebview](https://pywebview.flowrl.com/)
instead of opening a browser tab. [PyInstaller](https://pyinstaller.org/) freezes
that into a standalone `.app`/`.exe` — no Python install required by end users.

`server.py` and the plain `quiltor` CLI are untouched and stay dependency-free;
everything here lives behind the optional `desktop` extra.

## One-time setup

```bash
python -m venv .venv-desktop
# macOS/Linux:
source .venv-desktop/bin/activate
# Windows:
.venv-desktop\Scripts\activate

pip install -e ".[desktop]"
pip install pyinstaller
```

Requires Python 3.11+ (matches `pyproject.toml`'s `requires-python`). The Windows
installer step additionally needs [Inno Setup](https://jrsoftware.org/isinfo.php)
(free) installed — `ISCC.exe` on `PATH` or at its default install location; the
macOS `.dmg` step needs [`create-dmg`](https://github.com/create-dmg/create-dmg)
(`brew install create-dmg`). Both are optional: the onedir/`.app` build still
happens without them, just not wrapped into an installer.

## Building

```bash
./packaging/build_macos.sh                       # → packaging/dist/Quiltor.app (+ .dmg)
powershell -File packaging/build_windows.ps1      # → packaging/dist/Quiltor/Quiltor.exe (+ Setup.exe)
```

Both scripts regenerate `packaging/icons/` if missing (`make_icons.py`) and run
`npm run build` first, so `dist/` is fresh. The Windows onedir build (a folder,
not a single file — faster startup and far fewer antivirus false positives than
"onefile") gets wrapped into `Quiltor-Setup-<version>.exe` by
`packaging/quiltor.iss` (Inno Setup): per-user install (no admin/UAC prompt),
Start Menu shortcut, optional Desktop shortcut, and an uninstaller registered in
"Apps & Features". Uninstalling removes the installed program files but leaves
the per-user data directory (see below) untouched, same as most apps.

## Platform-specific vs. shared code

Only `desktop_platform.py` branches on `sys.platform` — everything else
(`desktop.py`, `desktop_tray.py`) is written once and works on both OSes:

- **`desktop_platform.py`** — the few things that actually differ per OS:
  the per-user data directory convention (`data_home()`) and how to reveal a
  folder in the system file manager (`reveal_in_file_manager()`, Finder vs.
  Explorer). Adding a third OS or changing one of these decisions should only
  ever touch this one file.
- **`desktop.py`** / **`desktop_tray.py`** — orchestration and the tray icon,
  both OS-agnostic; pywebview and pystray abstract the actual
  WebView2-vs-WKWebView and notification-area-vs-menu-bar differences
  internally.
- **`packaging/build_windows.ps1`** / **`build_macos.sh`** / **`quiltor.iss`**
  — necessarily separate, since producing a `.exe`+installer vs. a `.app`+`.dmg`
  are different OS-level packaging formats with no shared tooling.

## What's different from the browser/CLI build

- **No browser tab** — `desktop.py` passes `no_open=True` to `server.run()` and
  opens a pywebview window instead.
- **A tray icon / menu bar icon** (`desktop_tray.py`, via
  [pystray](https://github.com/moses-palmer/pystray)) with "Quiltor öffnen"
  (bring the window forward), "Datenordner öffnen" (reveal the per-user data
  directory), and "Beenden" (quit). It exists only while the app is running —
  closing the window still quits the whole app (tray icon included), this
  isn't a "keep running in the background" feature. **Windows/Linux only for
  now**: pystray's macOS backend needs the process's real main thread, same as
  pywebview's does for the window itself, and the two can't both claim it in
  the current structure — no Mac available here to work out and verify the
  fix, so `desktop_tray.py` skips starting the tray on `darwin` rather than
  ship something untested that could hang app startup. See
  `desktop_platform.TRAY_SUPPORTS_BACKGROUND_THREAD` for the restructuring
  this needs (pystray owning the main thread, `webview.start()` moved into the
  background thread pystray's `setup=` callback receives).
- **Per-user data directory** — `QUILTOR_HOME` defaults to
  `~/Library/Application Support/Quiltor` (macOS) or `%USERPROFILE%\Quiltor`
  (Windows), set by `desktop.py` before `server` is imported (mirrors
  `backend/cli.py`'s `~/.quiltor` default for the pip/pipx CLI, adapted to each
  OS's usual convention since a double-clicked app has no shell profile to set
  `QUILTOR_HOME` by hand).
- **PDF export** uses `backend/render.py::render_pdf_system_browser()` — Playwright
  for Python driving the already-installed system Chrome or Edge
  (`channel="chrome"`/`"msedge"`), instead of the Node/Playwright-JS subprocess
  path (`render_pdf()` + `scripts/render-book-pdf.mjs`) that Docker and
  `npm run dev` use. This avoids bundling a dedicated ~250-300MB Chromium
  download; Playwright for Python's own driver adds only ~50-90MB, and no system
  Node.js is required. If neither Chrome nor Edge is installed, PDF export fails
  with a clear error message (rare in practice — Windows ships Edge by default).
- **The local AI assistant's first-run terminal prompt is silent** —
  `ensure_installed()` (`backend/llm/installer.py`) only asks interactively when
  `sys.stdin.isatty()`; a windowed build has no console, so it stays quiet and the
  assistant panel simply reports itself unavailable at first launch. It's no
  longer terminal-only, though: the assistant panel's "Local model unavailable"
  banner offers a "Set up now" button (only shown when nothing is installed yet,
  not when a previously-working install has merely crashed) that triggers the
  same install in the background with a live progress bar, no terminal needed --
  see `install_async()`/`read_install_state()` in `backend/llm/installer.py`,
  the `/api/assistant/install` routes in `server.py`, and
  `AssistantRuntime.reload()` in `backend/assistant/runtime.py`, which picks up
  the freshly installed runtime without a server restart.

## Signing and distribution (v1: unsigned)

Both builds are unsigned for v1:

- **macOS** shows "Apple could not verify... unidentified developer" — the user
  right-clicks the app → *Open* once to bypass it.
- **Windows** SmartScreen shows "Windows protected your PC" — *More info* →
  *Run anyway*.

To remove those warnings, sign with an **Apple Developer ID** ($99/year) +
notarize for macOS, and an **Authenticode certificate** for Windows. Neither
requires any code changes here — it's a signing step added to the build scripts
once a certificate exists.

### Mac App Store: not realistic without a rework

Two App Store rules conflict with how Quiltor's local AI assistant works today:

1. **Guideline 2.5.2** ("apps... may not download or install executable code")
   — `backend/llm/installer.py` downloads and runs a `llama-server`/MLX binary at
   first run. That's close to a textbook rejection case.
2. **App Sandbox** (mandatory for Store apps) restricts filesystem access and
   subprocess spawning well beyond what Git backups, arbitrary `QUILTOR_HOME`
   locations, and spawning the LLM runtime as a child process assume today.

Distributing outside the Store with a notarized Developer ID build (see above)
is the standard path for this kind of local tool — Ollama and LM Studio both do
the same — and needs no architectural changes.

## Verifying a build works end-to-end

1. Launch the built app. It should open a window (no browser, no console/terminal
   window) within a few seconds.
2. Create or open a world, write something, confirm autosave.
3. Export a PDF; confirm it opens Chrome/Edge headlessly and downloads correctly.
4. Quit the app (close the window). Confirm no lingering server process:
   - macOS: Activity Monitor, search "Quiltor"/"python".
   - Windows: Task Manager, search "Quiltor.exe".
5. Relaunch the app and confirm the world from step 2 is still there (data
   persisted under the per-user data directory listed above, not next to the
   app bundle).
