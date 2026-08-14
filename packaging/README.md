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
(free) installed — `ISCC.exe` on `PATH` or at its default install location; without
it the onedir build still happens, just not wrapped into an installer. macOS has no
such prerequisite — [`create-dmg`](https://github.com/create-dmg/create-dmg)
(`brew install create-dmg`) is used for a nicer window layout when present, and
`build_macos.sh` falls back to `hdiutil` otherwise, so a `.dmg` is always produced.

## Building

```bash
./packaging/build_macos.sh                       # → packaging/dist/Quiltor-<version>.dmg
powershell -File packaging/build_windows.ps1      # → packaging/dist/Quiltor-Setup-<version>.exe
```

Both scripts regenerate `packaging/icons/` if missing (`make_icons.py`) and run
`npm run build` first, so `dist/` is fresh.

The Windows onedir build (a folder, not a single file — faster startup and far
fewer antivirus false positives than "onefile") gets wrapped into
`Quiltor-Setup-<version>.exe` by `packaging/quiltor.iss` (Inno Setup): per-user
install (no admin/UAC prompt), Start Menu shortcut, optional Desktop shortcut, and
an uninstaller registered in "Apps & Features". Uninstalling removes the installed
program files but leaves the per-user data directory (see below) untouched, same as
most apps.

macOS gets the platform-native equivalent: a `.dmg` holding `Quiltor.app` next to an
`/Applications` symlink to drag it onto. There is no uninstaller because there is
nothing to unregister — deleting the app is the uninstall, and it likewise leaves
the per-user data directory alone.

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

## Signing and distribution

Unsigned builds trip both platforms' gatekeeping: **macOS** shows "Apple could not
verify... unidentified developer" (right-click → *Open* bypasses it once), **Windows**
SmartScreen shows "Windows protected your PC" (*More info* → *Run anyway*). Neither
is acceptable for a build handed to other people.

### macOS: Developer ID + notarization

`build_macos.sh` does this already; it just needs credentials. Two environment
variables switch it on, and it stays a plain unsigned build when they are absent:

```bash
export QUILTOR_SIGN_IDENTITY="Developer ID Application: Jane Doe (AB12CD34EF)"
export QUILTOR_NOTARY_PROFILE="quiltor-notary"
./packaging/build_macos.sh
```

One-time setup:

1. Join the **Apple Developer Program** ($99/year) and create a *Developer ID
   Application* certificate; install it into the login keychain.
   `security find-identity -v -p codesigning` then prints the identity string.
2. Create an app-specific password at appleid.apple.com and store notarytool
   credentials once:
   ```bash
   xcrun notarytool store-credentials quiltor-notary \
       --apple-id you@example.com --team-id AB12CD34EF --password <app-specific-password>
   ```

What the script then does, in order: signs every nested Mach-O binary inside-out
(`codesign --deep` is documented as unreliable for a frozen-interpreter bundle this
shape), signs the app itself with `packaging/entitlements.plist` under the Hardened
Runtime, notarizes and staples the `.app`, builds the `.dmg`, then signs, notarizes
and staples that too. Stapling both means the installed copy passes Gatekeeper even
on a machine that is offline at first launch.

The entitlements are the minimum the Hardened Runtime needs for this app: JIT and
unsigned executable memory (llama.cpp/MLX compile Metal shaders at runtime),
disabled library validation (the `llama-server` binary `backend/llm/installer.py`
downloads at first run is not signed by our Team ID), and dyld environment
variables (PyInstaller's bootloader). Note that the downloaded runtime is separately
subject to quarantine — `installer.py` already strips it with `xattr -dr
com.apple.quarantine`.

### Windows: Authenticode

Still unsigned. Requires an **Authenticode certificate** (OV or, to skip SmartScreen
reputation-building entirely, EV) and a `signtool sign /fd sha256 /tr <timestamp-url>`
step in `build_windows.ps1` over both `Quiltor.exe` and the finished `Setup.exe`. No
code changes beyond that.

## Mac App Store

Not possible with the current build, but the blockers are specific and fixable — it
needs a second, sandboxed build variant rather than an architectural rewrite.

The often-quoted showstopper, **Guideline 2.5.2**, forbids downloading *executable
code* — it does not forbid downloading *data*. Model weights are data, so the GGUF
download at first run is fine (and necessary: the App Store caps apps at 4 GB, and
`Qwen3-4B-Q4_K_M.gguf` alone is ~2.5 GB). What actually violates 2.5.2 is the
`llama-server` binary download and the MLX path's `venv` + `pip install`
(`backend/llm/installer.py`), which install and run executable code.

### The edition switch

`backend/edition.py` is where the two builds diverge. It reports `"store"` when
macOS exports `APP_SANDBOX_CONTAINER_ID` (which it does for every sandboxed
process, and the sandbox is mandatory for Store apps), and `"devid"` otherwise — so
a single build behaves correctly in both contexts with no compile-time flag.
`QUILTOR_EDITION=store` forces it, which is how the Store code paths are tested on
a normal checkout:

```bash
QUILTOR_EDITION=store python3 -m backend.llm.installer   # refuses the MLX runtime
```

Only three places branch on it, all in the LLM layer. Everything else — storage,
the server, the frontend — is edition-agnostic and must stay that way.

### Groundwork already in place

1. **Bundled runtime path** — `bundled_runtime_dir()`
   (`backend/llm/runtimes/__init__.py`) finds a `llama-server` shipped inside the
   frozen bundle, `llamacpp.resolve_binary()` prefers it over any downloaded copy,
   and `install_runtime()` skips the download entirely when it is present.
2. **MLX blocked in Store builds** — `install_mlx_runtime()` refuses outright,
   `resolve_runtime("auto")` returns `llamacpp` even on Apple Silicon, and
   `select._preference_order()` does not probe for MLX.
3. **Sandbox data directory** — needs no code at all: macOS points `HOME` at
   `~/Library/Containers/<bundle-id>/Data` for sandboxed processes, and
   `Path.home()` reads `HOME`, so `desktop_platform.data_home()` already resolves
   into the container. Documented there so nobody "fixes" it later.
4. **Sandbox entitlements** — written down in `packaging/entitlements-mas.plist`.
   Nothing consumes it yet.
5. **Git is gone** — version history and cloud backup no longer shell out to
   anything (`backend/backup/`). History is a local, content-addressed snapshot
   store; backup is an HTTPS upload to a configurable endpoint, which the sandbox
   permits under `network.client`. This also fixes a problem that was never
   specific to the Store: `/usr/bin/git` on macOS is an Xcode Command Line Tools
   shim that opens an installer dialog when the tools are absent, and plenty of
   Windows and Linux machines have no git at all.

Covered by `tests/backend/test_edition.py`, `test_backup_snapshots.py`, and
`test_backup_remote.py`.

### Still to build

5. **Compile and bundle `llama-server`** for arm64, place it in the bundle, sign it
   with the same Team ID, and add it to `packaging/quiltor.spec`. The code path that
   consumes it exists; the binary does not.
7. **Replace PDF export** — `render_pdf_system_browser()` launches an
   already-installed Chrome/Edge, which the sandbox forbids. WKWebView's own print
   operation via a pywebview bridge is the way out. This is the largest remaining
   piece of work.
8. **Store signing and submission** — *3rd Party Mac Developer* certificates, an
   embedded provisioning profile, a `.pkg` via `productbuild`, upload via
   Transporter. Plus the review paperwork: privacy policy, support URL,
   `LSApplicationCategoryType`, screenshots — and a check that the PolyForm
   Noncommercial license is compatible with Apple's standard EULA terms.

Until that exists, a notarized Developer ID `.dmg` (above) is the normal
distribution channel for a local tool like this — Ollama and LM Studio both ship
that way.

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
