# Working in this repository

## Language: German for the user, English for the developer

One rule, and it is decided by the reader, not by the file:

- **German** — everything a person reads while writing in Quiltor. The product is built
  for a German-speaking author first, and that comes before consistency of any other kind.
- **English** — everything a person reads while working _on_ Quiltor. Code, comments,
  docstrings, identifiers, CLI flags, commit messages, log lines, error messages, tool
  output, violation reports, test titles, assertion messages.

Ask who is meant to read it. An author sees the German half; a developer sees the English
half. A `console.error` in `tools/` is developer-facing even though it looks like prose,
and a `getByRole("button", { name: "Kapitel" })` is product-facing even though it sits in a
test.

The German half, in full:

- `locales/de/*` — the interface itself.
- Strings that assert German interface text.
- Fixture prose (`"Der Morgen lag still über dem Hafen."`), fixture ids, the German texts
  of the test world (`tests/world/texts/*.de.mjs`) and the German manuscripts in
  `tools/evaluation/` — those are a German author's material, used as input.
- Skip reasons and assertion strings that quote a German view by name.

Test titles are English in all three suites — unit, design and product. The product suite
was the last holdout at 70 of 74; a title is read by whoever is debugging a red run, so it
belongs on the developer's side however German the interface it describes.

The test world is kept in both languages; the German text leads, the English one is its
translation, and both change in the same commit.

An English comment may quote a German product string — a macOS menu item, an error message,
a prompt. That is a quotation, not a leftover.

Persisted field names are code, not product. Four of them (`zeichenAktiv`,
`elementeVerborgen`, `gerichtet`, `notizen`) were German and had to be renamed through
schema migrations, which is much more expensive than getting them right the first time.

### The word list is not the tool

Three sweeps missed things, each time because a German phrase happened to contain no umlaut
and no word from whatever list was in use — `Baseline aktualisieren`, `liest verschachtelte
calc-Klammern`, `mischt benannte und unbenannte Geometrie`. Grep for umlauts, for the
`ae`/`oe`/`ue` transliterations, for German suffixes (`-ung`, `-keit`, `-lich`, `-ieren`),
and read every `test(` title and every `assert.match` regex by eye. A message and the
assertion that matches it must move together, or the suite goes red for the wrong reason.

## dist/ is committed, and the product suite runs against it

`npm run build` writes `dist/`, and `dist/` is in the repository — the wheel and the
Docker image serve it. The `frontend` CI job rebuilds and compares; a source change
without a rebuild fails it, and every browser job depends on that one, so they never
start.

The product Playwright suite talks to the Python server on `:8010`, which serves the
built `dist/` — not the sources. **After any change under `packages/client/src`, run
`npm run build` before the product suite, or you are testing the previous build.** The
unit tests (jsdom) and the design suite (its own Vite server) do not use `dist/`, so a
green run from those proves nothing about it.

`:8010` and not the `:8000` the product ships with: 8000 is one of the most contested ports
there is -- Django, `python -m http.server`, an Unreal editor's MCP server -- and a port
already taken does not announce itself. The page loads, the suite waits sixty seconds for a
toolbar, and it reads as a broken application. The Dockerfile, the proxies, the CLI and the
README keep 8000, because that is the port Quiltor's own users open.

Start it with `py -3.12 apps/web/server.py 8010 --no-open`, or `npm start`, which starts
both halves. `PLAYWRIGHT_BASE_URL` overrides the suite's end of it.

## Proving a fix

A test that is green after a fix proves nothing on its own — it might have been green
before. Undo the fix and watch the test fail:

```bash
node tools/dev/mutate.mjs <file> --from "<text>" --to "<text>" -- <command>
```

Success means the command fails. The file is restored afterwards. This has already caught
a geometry test that passed while the bug was back in, and an assertion whose regex could
never match.

The command after `--` runs without a shell, so its arguments arrive exactly as your own
shell hands them over — quote `bash -c "exit 1"` as you would to run it directly. `&&`,
pipes and redirections therefore need a shell of their own (`-- bash -c "a && b"`), and from
PowerShell a bare `bash` is WSL's `System32\bash.exe`: name Git Bash by its path there. A
command that cannot be started at all exits 2 instead of counting as a bite.

## Toolchains are pinned, exactly

`distribution/toolchains.json` names the versions the release is built with, and
`release_preflight.py` refuses anything else — which is why `npm run set-version` refuses
too. `npm run doctor` shows all deviations at once with the install line for each.

On Windows, ask the launcher for the series rather than a bare `python`:
`py -3.12 -m unittest discover -s tests/python -t tests/python`.

npm scripts must not call a bare `python` either — it is whatever stands first on PATH, and
on one machine that was Inkscape's bundled 3.12.12, which has neither ruff nor the project.
A version check would have waved it through. Go through the launcher instead, naming what
the command depends on:

```bash
node tools/dev/python.mjs --needs ruff -m ruff format --check .
```

The first interpreter that can import the module wins, which is the true property in every
case. In CI a bare `python` is the right answer and still gets chosen, because that is the
one pip installed into.

## Visual baselines

`tests/e2e/visual-baseline.spec.ts-snapshots/` holds one set per platform
(`-win32`, `-linux`, `-darwin`), because font rasterisation differs. The
"Generate visual baselines" workflow only fills in **missing** images, so:

- to accept a deliberate design change, delete the affected images for the platforms you
  cannot photograph yourself and let the workflow refill them;
- a changed image is always a failure a person has to look at, never an automatic update.

`tools/quality/check_visual_baseline_reach.mjs` fails when a platform's set is incomplete.
The run right after a deletion is red until the images land — that is the intended path,
not a broken build.

## The test world grows, it does not change

`tests/world/` is the one world every suite, the README pictures and the shipped example
world are built from. Any agent may extend it without asking. Three rules keep it usable:

- **Append, do not change.** Existing ids, positions and texts stay as they are. A test that
  needs something new adds it to the world instead of inventing it inline.
- **Changing what exists is allowed only together with everything it breaks** — every
  affected test and baseline in the same change. `tests/world/world.lock.json` freezes the
  world; its diff shows exactly what changed, and that diff is what a reviewer reads.
- **German first, English in the same change.** `texts/*.de.mjs` is the source,
  `texts/*.en.mjs` its translation. When a German text changes and its English one does not,
  the world test fails until the English is updated or confirmed:
  `npm run world:update -- --confirm-translation <key>`.

New content goes into the check part (`parts/edge.mjs`, ids `x-…`) unless it is meant to be
seen. The base world (`parts/base.mjs`) is what the README shows and what ships as the example
world in the wheel, the Docker image and the desktop app; the check part never ships. Growing
the base world means taking the README pictures again (`npm run screenshots:readme`).

Specs seed it with `seedExampleWorld` or mock it with `mockExampleWorld`
(`tests/e2e/support/example-world.ts`) and name its ids through `world.ids`.
`tests/world/CATALOG.md` lists what is there and why.

After any change run `npm run world:update`. It rewrites the shipped JSON, the typed ids, the
lock and the catalog; `npm run check` fails while any of them is stale.

## Contracts are machine-checked

`contracts/` carries JSON schemas and fixtures that `npm run check` validates, and
`contracts/fixtures/persistence/sqlite-migration-chain.v1.json` must list every schema
step. Bumping `SCHEMA_VERSION` without adding the step there fails the backend suite.

A migration step runs against databases that carry only `meta` — ask
`sqlite_master` whether a table exists before reading it, the way every existing step does.

## Frontend design

For frontend work, read `docs/design/FRONTEND_STYLEGUIDE.md`: its entry section,
section 1 and Definition of Done first, then the task-relevant sections. Use
`DESIGN.md` for product identity, `packages/client/src/design/README.md` for the
system contract, and the existing token files and comparable components for implementation.
Preserve the approved scope and existing identity. A review alone does not authorize edits;
an implementation request does. Check proposals against current code and report actual
verification and remaining gaps.

## Gates

- `npm run check` — contracts, architecture, design, design system, i18n, platform
  boundaries, formatting. Fast, and it catches most things before CI.
- `npx vitest run` — client unit tests.
- `npx playwright test` — product suite; needs the server on `:8010` and a fresh `dist/`.
- `npx playwright test --config playwright.design.config.ts` — design suite.
- `py -3.12 -m unittest discover -s tests/python -t tests/python` — backend.

`npm run check` does **not** run the Python suite. Contract breaks in
`tests/python/test_release.py` only show up when you run it or when CI does.

## The design suite starts its own gallery, on a port you can pick

`playwright.design.config.ts` starts the gallery's Vite server itself and never reuses one
that is already running. A gallery on the port may belong to another worktree, and it serves
that worktree's sources: reusing it once turned a clean change into 91 red tests. A taken
port now stops the run with Playwright's `is already used` error before any test starts.

Two worktrees running the suite at once each need their own port:
`QUILTOR_DESIGN_PORT=4184 npx playwright test --config playwright.design.config.ts`. The
default is 4174; `vite.design.config.ts` reads the same variable through
`tools/dev/design-port.mjs`, so `npm run design:gallery` follows it too.

## The server on :8010 holds the code it was started with

Python loads its modules once. A server started before a change to `src/quiltor/` keeps
serving the old code, and the product suite then tests that instead — a failure that looks
like a regression and is not.

Count the processes before believing a restart:

```bash
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name like '%python%'\" | Select-Object ProcessId,CommandLine | Format-List"
```

Two of them can be listening on `:8010` at once. Stopping one leaves the other answering,
and the restart appears to have done nothing. This cost a whole debugging session: a `400
document.invalid_wire` that the current sources accepted when the same payload was handed
straight to `decode_document_v1`.

That comparison is also the fastest way to tell the two apart. If the server rejects a
payload the sources accept, the server is stale — nothing else needs investigating.

## A Windows note

Development happens on Windows with Git Bash. A here-document eats backslashes on the way
through the shell: `\\b` in a patch script arrives as a literal `\b` control character and
silently corrupts a regex. Write patch scripts to a file and run the file.
