# Working in this repository

## Language: English in the code, German in the product

The codebase is English. Comments, docstrings, identifiers, CLI flags, commit messages —
all English. This is the repository's own convention, visible in its first 319 commits and
in the comments at the top of `.github/workflows/test.yml`.

It drifted in September 2026: 48 commits and roughly 500 comment blocks were written in
German. That was a break with the convention, not a new one. If you find German in code,
it is a leftover to fix, not a pattern to follow.

What stays German, because it is the product and not the code:

- `locales/de/*` — the interface itself.
- Strings that assert German interface text, such as
  `getByRole("button", { name: "Kapitel" })`.
- Fixture prose (`"Der Morgen lag still über dem Hafen."`) and fixture ids.
- Everything a person reads while writing in Quiltor.

A comment written in English may quote a German product string — a macOS menu item, an
error message, a prompt. That is a quotation, not a leftover.

Persisted field names are code, not product. Four of them (`zeichenAktiv`,
`elementeVerborgen`, `gerichtet`, `notizen`) were German and had to be renamed through
schema migrations, which is much more expensive than getting them right the first time.

### Test titles

Not settled the same way everywhere, and deliberately left that way:

- The **product suite** (`tests/e2e/`) names its tests in German — 70 of 74. They read as
  acceptance statements about a German interface. Follow that suite's convention there.
- The **unit tests** and the **design suite** are English. German titles there are drift.

## Assertion messages are code

A message a `page.evaluate` returns for a failing expectation is read by whoever is
debugging, not by an author. English, like the rest of the code — the German interface
names inside it stay quoted.

## dist/ is committed, and the product suite runs against it

`npm run build` writes `dist/`, and `dist/` is in the repository — the wheel and the
Docker image serve it. The `frontend` CI job rebuilds and compares; a source change
without a rebuild fails it, and every browser job depends on that one, so they never
start.

The product Playwright suite talks to the Python server on `:8000`, which serves the
built `dist/` — not the sources. **After any change under `packages/client/src`, run
`npm run build` before the product suite, or you are testing the previous build.** The
unit tests (jsdom) and the design suite (its own Vite server) do not use `dist/`, so a
green run from those proves nothing about it.

## Proving a fix

A test that is green after a fix proves nothing on its own — it might have been green
before. Undo the fix and watch the test fail:

```
node tools/dev/mutate.mjs <file> --from "<text>" --to "<text>" -- <command>
```

Success means the command fails. The file is restored afterwards. This has already caught
a geometry test that passed while the bug was back in, and an assertion whose regex could
never match.

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

```
node tools/dev/python.mjs --needs ruff -m ruff format --check .
```

The first interpreter that can import the module wins, which is the true property in every
case. In CI a bare `python` is the right answer and still gets chosen, because that is the
one pip installed into.

## Visual baselines

`tests/e2e/visual-baseline.spec.ts-snapshots/` holds one set per platform
(`-win32`, `-linux`, `-darwin`), because font rasterisation differs. The
"Visual-Baselines erzeugen" workflow only fills in **missing** images, so:

- to accept a deliberate design change, delete the affected images for the platforms you
  cannot photograph yourself and let the workflow refill them;
- a changed image is always a failure a person has to look at, never an automatic update.

`tools/quality/check_visual_baseline_reach.mjs` fails when a platform's set is incomplete.
The run right after a deletion is red until the images land — that is the intended path,
not a broken build.

## Contracts are machine-checked

`contracts/` carries JSON schemas and fixtures that `npm run check` validates, and
`contracts/fixtures/persistence/sqlite-migration-chain.v1.json` must list every schema
step. Bumping `SCHEMA_VERSION` without adding the step there fails the backend suite.

A migration step runs against databases that carry only `meta` — ask
`sqlite_master` whether a table exists before reading it, the way every existing step does.

## Gates

- `npm run check` — contracts, architecture, design, design system, i18n, platform
  boundaries, formatting. Fast, and it catches most things before CI.
- `npx vitest run` — client unit tests.
- `npx playwright test` — product suite; needs the server on `:8000` and a fresh `dist/`.
- `npx playwright test --config playwright.design.config.ts` — design suite.
- `py -3.12 -m unittest discover -s tests/python -t tests/python` — backend.

`npm run check` does **not** run the Python suite. Contract breaks in
`tests/python/test_release.py` only show up when you run it or when CI does.

## The server on :8000 holds the code it was started with

Python loads its modules once. A server started before a change to `src/quiltor/` keeps
serving the old code, and the product suite then tests that instead — a failure that looks
like a regression and is not.

Count the processes before believing a restart:

```bash
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name like '%python%'\" | Select-Object ProcessId,CommandLine | Format-List"
```

Two of them can be listening on `:8000` at once. Stopping one leaves the other answering,
and the restart appears to have done nothing. This cost a whole debugging session: a `400
document.invalid_wire` that the current sources accepted when the same payload was handed
straight to `decode_document_v1`.

That comparison is also the fastest way to tell the two apart. If the server rejects a
payload the sources accept, the server is stale — nothing else needs investigating.

## A Windows note

Development happens on Windows with Git Bash. A here-document eats backslashes on the way
through the shell: `\\b` in a patch script arrives as a literal `\b` control character and
silently corrupts a regex. Write patch scripts to a file and run the file.
