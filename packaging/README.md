# Quiltor desktop app

Turns Quiltor into a real double-click app for macOS and Windows: `hosts/desktop/app.py`
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

**You normally do not need to run either.** `.github/workflows/release.yml` runs
both on every release and attaches the `.dmg` and the `Setup.exe` to the GitHub
Release — see "Releasing" below. Build by hand to try a change before it ships,
or to reproduce something CI did.

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

## Releasing

Raising the version is the whole manual step. Everything else follows from it.

```bash
python3 packaging/set_version.py minor    # or major / patch / an explicit 2.15.0
# equivalently, if you are already in npm's world:
npm run set-version -- minor
```

That writes the version into the three files that have to agree — `VERSION`,
`package.json`, and `package-lock.json`, which carries it twice. They are not
redundant copies to keep in sync out of tidiness: `release.yml`'s `version-check`
job fails the release when `VERSION` and `package.json` disagree, and `npm ci`
refuses to run at all when `package.json` and its lockfile do.

The script refuses two things, both of which otherwise fail quietly rather than
loudly:

- **A dirty working tree.** The bump wants to be one small reviewable commit;
  buried in unrelated edits nobody can see at a glance that all the numbers moved
  together.
- **A version that is not strictly ahead** of the current one. Re-releasing an
  existing version is not an error you find out about — `release.yml` sees the tag
  already exists, sets `should_release=false`, and skips every downstream job. The
  run is green and nothing shipped.

It writes the files and stops. Commit that, merge it to `main`, and the push to
`main` touching `VERSION` is what starts `.github/workflows/release.yml`:

| job | produces |
| --- | --- |
| `version-check` | the version, and the decision whether to release at all |
| `tag-and-release` | the `vX.Y.Z` tag and a GitHub Release with generated notes |
| `docker` | `ghcr.io/tim3399/quiltor:X.Y.Z` and `:latest` |
| `wheel` | the wheel and sdist, attached to the Release |
| `macos-app` | `Quiltor-X.Y.Z.dmg`, attached to the Release |
| `windows-app` | `Quiltor-Setup-X.Y.Z.exe`, attached to the Release |

`macos-app` and `windows-app` run `build_macos.sh` and `build_windows.ps1`
unchanged — the same commands documented above — so there is no CI-only build
path that can drift from the one you can reproduce on a laptop. Two details are
CI-specific and worth knowing:

- **`QUILTOR_BUILD_NUMBER` is the workflow's run number.** It becomes
  `CFBundleVersion`, which Apple requires to increase with every upload and which
  is independent of `VERSION` (a rejected build burns a number). Locally it is
  unset and the bundle gets `"0"` — valid, and obviously not a submission.
- **`create-dmg` is not installed on the runner.** It positions the icons via
  AppleScript, which wants a logged-in Finder session; `build_macos.sh` falls back
  to `hdiutil`, which needs nothing. The disk image is the same, minus the window
  layout.

`release.yml` deliberately does not depend on `test.yml`: the tests already ran on
the pull request that changed `VERSION`. See the comment at the top of `test.yml`.

## Platform-specific vs. shared code

Only `backend/system/` branches on the OS — everything else (`hosts/desktop/app.py`,
`hosts/desktop/tray.py`, and all of `backend/`) is written once and works on both OSes:

- **`backend/system/`** — the things that actually differ per OS, one module
  each (`macos.py`, `windows.py`, `linux.py`) behind the surface named in
  `contract.py`: the per-user data directory (`data_home()`), revealing a folder
  in the file manager (`reveal_in_file_manager()`), subprocess creation flags,
  tying a child process's lifetime to ours, executable naming, and quarantine
  stripping. `__init__.py` picks one implementation at import time and
  re-exports it. Adding a third OS means adding one module and one line.

  `tests/backend/test_system.py` enforces this by parsing every source file and
  failing on an OS branch anywhere else. Left to convention the rule does not
  hold: each branch elsewhere looks like a small correct decision on its own.
- **`hosts/desktop/app.py`** / **`hosts/desktop/tray.py`** — orchestration and the tray icon,
  both OS-agnostic; pywebview and pystray abstract the actual
  WebView2-vs-WKWebView and notification-area-vs-menu-bar differences
  internally.
- **`packaging/build_windows.ps1`** / **`build_macos.sh`** / **`quiltor.iss`**
  — necessarily separate, since producing a `.exe`+installer vs. a `.app`+`.dmg`
  are different OS-level packaging formats with no shared tooling.

## What's different from the browser/CLI build

- **No browser tab** — `hosts/desktop/app.py` passes `no_open=True` to `server.run()` and
  opens a pywebview window instead.
- **A tray icon / menu bar icon** (`hosts/desktop/tray.py`, via
  [pystray](https://github.com/moses-palmer/pystray)) with "Quiltor öffnen"
  (bring the window forward), "Datenordner öffnen" (reveal the per-user data
  directory), and "Beenden" (quit). It exists only while the app is running —
  closing the window still quits the whole app (tray icon included), this
  isn't a "keep running in the background" feature. **Windows/Linux only for
  now**: pystray's macOS backend needs the process's real main thread, same as
  pywebview's does for the window itself, and the two can't both claim it in
  the current structure — no Mac available here to work out and verify the
  fix, so `hosts/desktop/tray.py` skips starting the tray on `darwin` rather than
  ship something untested that could hang app startup. See
  `backend/system/macos.py`'s `TRAY_SUPPORTS_BACKGROUND_THREAD` for the restructuring
  this needs (pystray owning the main thread, `webview.start()` moved into the
  background thread pystray's `setup=` callback receives).
- **Per-user data directory** — `QUILTOR_HOME` defaults to
  `~/Library/Application Support/Quiltor` (macOS) or `%USERPROFILE%\Quiltor`
  (Windows), set by `hosts/desktop/app.py` before `server` is imported (mirrors
  `hosts/cli/main.py`'s `~/.quiltor` default for the pip/pipx CLI, adapted to each
  OS's usual convention since a double-clicked app has no shell profile to set
  `QUILTOR_HOME` by hand).
- **PDF export needs no browser.** `hosts/desktop/app.py` asks
  `backend.pdf.desktop_renderer()`, and every platform prints through the engine
  already drawing its window: `wkwebview.py` on macOS, `webview2.py` on Windows,
  `webkitgtk.py` on Linux. Nothing to install, nothing launched, and the PDF
  matches what the author was looking at rather than what a second,
  differently-versioned browser made of it.

  It also keeps Playwright out of the bundle, which was most of the download —
  its driver ships a `node` binary. The macOS app went from 166 MB to 37 MB, the
  `.dmg` from 64 MB to 17 MB.

  **Only the macOS path has actually been executed.** The other two are written
  from the documentation, and the macOS one needed five corrections that
  appeared only when it ran. `QUILTOR_PDF_RENDERER=system_browser` falls back to
  driving an installed Chrome or Edge without a new build — it needs the
  `browser-pdf` extra, which is why that extra still exists.

  Docker and `npm run dev` use `node_chromium.py` + `scripts/render-book-pdf.mjs`
  instead: they have Node and the Playwright browsers anyway, and no window
  server to print through.

  `packaging/bundle.py` asks `backend.pdf` which renderer a build uses rather
  than deciding separately, so a build can never drop the library its own
  renderer imports.
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

### Signing in CI

The release workflow's `macos-app` job produces a **usable unsigned `.dmg`
today**, with no Apple Developer account anywhere. It signs and notarizes the
moment the secrets below exist, and there is no second code path to keep alive:
the job's "Apple code signing" step exits immediately when
`APPLE_CERTIFICATE_P12` is empty, and otherwise sets exactly the two environment
variables `build_macos.sh` already reads. **Creating the secrets is the only
step.** No workflow edit, no re-plumbing.

Create them under *Settings → Secrets and variables → Actions → New repository
secret*:

| secret | what goes in it |
| --- | --- |
| `APPLE_CERTIFICATE_P12` | the *Developer ID Application* certificate **and its private key**, exported from Keychain Access as a `.p12`, then base64-encoded: `base64 -i certificate.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | the password set during that `.p12` export |
| `APPLE_ID` | the Apple ID of the developer account (notarization only) |
| `APPLE_TEAM_ID` | the ten-character team ID, e.g. `AB12CD34EF` (notarization only) |
| `APPLE_APP_PASSWORD` | an app-specific password from appleid.apple.com, **not** the account password (notarization only) |

The first two are enough to sign. Add the other three to notarize as well, which
is what actually removes the Gatekeeper warning — signing alone does not. With
only the first two the job signs and prints a warning saying so.

Three things that go wrong the first time:

- **Export the certificate together with its private key.** Selecting only the
  certificate in Keychain Access produces a `.p12` that imports fine and then
  cannot sign anything.
- **The `.p12` must carry its issuer chain**, or `security find-identity -v`
  reports zero valid identities even though the certificate is there — the job
  fails with that listing and this explanation rather than producing a build
  signed by nothing. Keychain Access includes the chain when the certificate and
  key are exported together.
- **Do not generate the `.p12` with a modern `openssl pkcs12 -export`.** Its
  default AES-256/PBKDF2 encryption is unreadable by macOS's `security import`,
  which reports it as a wrong password. Keychain Access writes the format macOS
  can read.

There is no signing identity in the repository and no fallback that pretends
otherwise: an unsigned build says so in its own log and in the Release.

Mechanically, the job imports the `.p12` into a throwaway keychain under
`RUNNER_TEMP` (never the runner's login keychain), sets a key partition list so
`codesign` is not blocked waiting for a permission dialog no one can answer,
reads the identity string back out of that keychain rather than taking it as a
sixth secret, stores the notarytool profile in the same keychain, and deletes the
keychain in an `if: always()` step. `QUILTOR_NOTARY_KEYCHAIN` exists for that last
part: `notarytool` looks in the login keychain unless it is told where the profile
lives.

### Windows: Authenticode

Still unsigned, in CI as much as locally. Requires an **Authenticode certificate**
(OV or, to skip SmartScreen reputation-building entirely, EV) and a `signtool sign
/fd sha256 /tr <timestamp-url>` step in `build_windows.ps1` over both `Quiltor.exe`
and the finished `Setup.exe`. No code changes beyond that.

Worth doing the same way as macOS when it happens: put the decision in
`build_windows.ps1` behind an environment variable it reads, and let the workflow
supply it from a secret. Then the `windows-app` job needs no change either, and
the local and CI builds stay the same build.

## Mac App Store

Not possible with the current build, but the blockers are specific and fixable — it
needs a second, sandboxed build variant rather than an architectural rewrite.

The often-quoted showstopper, **Guideline 2.5.2**, forbids downloading *executable
code* — it does not forbid downloading *data*. Model weights are data, so the GGUF
download at first run is fine (and necessary: the App Store caps apps at 4 GB, and
`Qwen3-4B-Q4_K_M.gguf` alone is ~2.5 GB). What violates 2.5.2 is the
`llama-server` binary download, the MLX path's `venv` + `pip install`
(`backend/llm/installer.py`), and LanguageTool's JAR
(`backend/language/grammar/languagetool.py`) — all of which install and then run
executable code.

**The App Sandbox is a second, independent constraint**, and it is easy to
conflate the two. It forbids executing anything outside our own signed bundle
regardless of where that came from: the system JVM behind LanguageTool and the
installed Chrome/Edge behind PDF export both fail on this even though neither is
downloaded by us. That is why `backend/edition/` exposes the two as separate
policy questions rather than one "is this the Store?" flag — the Microsoft Store
build answers them differently.

### The edition switch

`backend/edition/` is where the builds diverge. Three exist — `direct` (the
`.dmg`, the Inno Setup `.exe`, Docker, a source checkout), `mas`, and `msstore`
— detected at runtime from whether the OS reports us inside its own app
container (`backend/system/`'s `in_os_app_package()`: `APP_SANDBOX_CONTAINER_ID`
on macOS, `GetCurrentPackageFullName` on Windows). So a single build behaves
correctly in every context with no compile-time flag, and — the part that
matters day to day — the restricted paths stay testable on a normal checkout:

```bash
QUILTOR_EDITION=mas python3 -m backend.llm.installer   # refuses to download
```

Callers ask **policy questions**, not for the edition's name:
`allows_code_download()` (guideline 2.5.2 — downloading *data* such as model
weights is a different question and always allowed) and
`allows_external_process()` (the sandbox refusing to launch the system JVM or an
installed browser). `is_store_build()` remains for the few places that really do
mean "any store", such as refusing MLX. A `edition() == "mas"` comparison spread
through a capability is exactly what this package exists to prevent.

Capabilities that differ by edition follow one shape: a `contract.py`, one module
per implementation, and an `__init__.py` that selects from policy.
`backend/language/grammar/` is the worked example — `languagetool.py` versus
`unavailable.py`.

The frontend is no longer edition-agnostic, and cannot be: it has to hide
features a build does not have rather than offer buttons that fail. It learns
this from the data it already fetches — `grammar.supported` in
`/api/language/status` — not from a separate edition field.

### Groundwork already in place

1. **Bundled runtime path** — `bundled_runtime_dir()`
   (`backend/llm/runtimes/__init__.py`) finds a `llama-server` shipped inside the
   frozen bundle, `llamacpp.resolve_binary()` prefers it over any downloaded copy,
   and `install_runtime()` skips the download entirely when it is present. It
   also refuses outright, rather than downloading, if the edition forbids it and
   no binary was bundled — the packaging being wrong must not become a guideline
   violation.
2. **Grammar checking blocked in Store builds** — LanguageTool downloads a JAR
   and launches the system JVM: a 2.5.2 violation and a sandbox violation
   respectively. `backend/language/grammar/` picks `unavailable.py` instead,
   which reports the feature unsupported so the UI hides it.
3. **MLX blocked in Store builds** — `install_mlx_runtime()` refuses outright,
   `resolve_runtime("auto")` returns `llamacpp` even on Apple Silicon, and
   `select._preference_order()` does not probe for MLX.
4. **Sandbox data directory** — needs no code at all: macOS points `HOME` at
   `~/Library/Containers/<bundle-id>/Data` for sandboxed processes, and
   `Path.home()` reads `HOME`, so `backend/system/macos.py`'s `data_home()` already resolves
   into the container. Documented there so nobody "fixes" it later.
5. **Sandbox entitlements** — written down in `packaging/entitlements-mas.plist`.
   Nothing consumes it yet.
6. **History and backup need no external tools** — `backend/core/backup/` shells
   out to nothing. History is a local, content-addressed snapshot store; backup
   is an HTTPS upload to a configurable endpoint, which the sandbox permits
   under `network.client`.

Covered by `tests/backend/test_edition.py`, `test_system.py`,
`test_backup_snapshots.py`, and `test_backup_remote.py`.

### Still to build

1. **Compile and bundle `llama-server`** for arm64, place it in the bundle, sign it
   with the same Team ID, and add it to the spec. The code path that consumes it
   exists; the binary does not. Note the placement is a real decision, not a
   `datas` line: `bundled_runtime_dir()` reads `sys._MEIPASS` (PyInstaller 6 puts
   that at `Contents/Frameworks`), while Apple wants nested executables under
   `Contents/MacOS` or `Contents/Library`.
2. **The Store build's book PDF** — *done*. `backend/pdf/wkwebview.py` renders
   through WKWebView's print operation, verified on device: correct 6 × 9 inch
   pages, all chapters, called from an HTTP handler thread while pywebview owns
   the main run loop.

   WebKit's print path does not implement CSS `@page` margin boxes, so it
   produces no page numbers — measured, not assumed: a minimal three-page
   document containing nothing but `@bottom-center { content: counter(page) }`
   prints without them. Nor is it a deployment-target question: Safari 18.2
   shipped margin boxes for Safari's own rendering, not for the embedded
   `NSPrintOperation` path, and the measurement above is from macOS 26.5.2 —
   so raising `LSMinimumSystemVersion` would buy nothing.

   `backend/pdf/page_numbers.py` draws them on afterwards. Its geometry comes
   from the same CSS and was checked against a Chromium-rendered book: same
   position to a tenth of a point, including the detail that the number is
   centred on the *text block* rather than the page, so it alternates by 7.2 pt
   between recto and verso because the margins mirror for binding.
3. **`reveal_in_file_manager()` on macOS** — *done*, `backend/system/macos.py`
   now uses `NSWorkspace`'s `activateFileViewerSelectingURLs:` and keeps the
   `/usr/bin/open` subprocess only as a fallback for checkouts without pyobjc.

   **Bundle metadata** — also *done*. `packaging/bundle.py` owns the identity and
   the `Info.plist`; `quiltor.spec` imports it rather than hard-coding anything.
   It lives outside the spec because a `.spec` only executes during a real build
   on a Mac, so nothing in one is tested until someone runs that build — and a
   missing `CFBundleVersion` is rejected by the uploader, not by review.
   `tests/backend/test_packaging.py` checks it anywhere.

   `CFBundleVersion` must increase with every upload and is independent of
   `VERSION` (a rejected build burns a number). CI passes its run number as
   `QUILTOR_BUILD_NUMBER`; a local build gets `"0"`, which is valid and
   obviously not a submission. `QUILTOR_TARGET_ARCH` overrides the architecture,
   which is otherwise arm64 — universal2 would need universal2 wheels for
   Pillow, pywebview and pystray.

   **The build variant** — also *done*. One spec builds all three
   distributions; `QUILTOR_EDITION` picks which, the same name the running app
   honours. The differences are data in `packaging/bundle.py`, derived from the
   very same policy objects in `backend/edition/` the app consults at runtime —
   so what gets packaged and what the code is then allowed to do cannot drift
   apart. A Mac App Store build drops Playwright (its renderer cannot run
   sandboxed anyway); neither store ships `scripts/llm-runtime` (MLX needs a
   venv and a pip install, which they may not do); and both require a `runtime/`
   holding a signed `llama-server`, failing the build with an explanation rather
   than producing an app whose assistant silently never works. Three
   near-identical spec files were the alternative, and keeping `hiddenimports`
   correct in three places is the drift this refactor set out to remove. Both
   build scripts pin `QUILTOR_EDITION=direct`, so a variable left over from
   testing cannot quietly change what they produce.
4. **A real app icon.** `make_icons.py` says so itself — it draws a Georgia "Q"
   and its header reads "swap these files out once real branding exists".
   Placeholder artwork is a Guideline 4.0 / 2.3.7 rejection.
5. **Store signing and submission** — *3rd Party Mac Developer* certificates, an
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
3. Export a PDF; on Windows and Linux confirm it opens Chrome/Edge headlessly,
   on macOS that nothing is launched at all. Then that a save panel
   appears, and that the file lands where you pointed it.
4. Export a chapter as Markdown too, and export the book PDF a *second* time in
   the same session. All five exports (book PDF, whole manuscript, single
   chapter, figures JSON, character profiles) go through the same native bridge
   — `hosts/desktop/bridge/files.py`, reached from `download()` in
   `src/lib/api.ts`. Nothing here uses pywebview's own `<a download>` handling:
   with `ALLOW_DOWNLOADS` on, macOS puts up a save panel it can never answer and
   then terminates the app. The second PDF matters because the macOS print path
   registers Objective-C classes, which can only happen once per process. Worth
   one click per build, because nothing else will tell you.
5. Quit the app (close the window). Confirm no lingering server process:
   - macOS: Activity Monitor, search "Quiltor"/"python".
   - Windows: Task Manager, search "Quiltor.exe".
6. Relaunch the app and confirm the world from step 2 is still there (data
   persisted under the per-user data directory listed above, not next to the
   app bundle).
