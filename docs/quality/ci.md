# CI timings

Where the time of a CI run goes, measured from the GitHub API. This is the baseline for every
change that claims to make CI faster: a claim compares against these numbers, measured the same
way.

## How it was measured

`gh run list` for the workflows `Test` and `Release Build`, then `gh run view <id> --json jobs`
for every completed run (successful or failed, never cancelled). Job and step timestamps give
the columns below. Medians, in minutes.

- **Test:** the 14 runs since 2026-10-01, when the workflow got its current shape (Windows product
  in 8 shards, 4 Linux browser slots). 5 `push` on main, 3 `pull_request`, 6 `workflow_dispatch`.
- **Release Build:** the 20 completed runs since 2026-09-01.
- **Queue** is the runner queue: job start minus the moment the job could have started (run
  creation, or the end of `frontend` for jobs that `needs: frontend`). Waiting for `frontend`
  itself is not queue time; it is listed separately.
- **Playwright** is the `npx playwright install --with-deps chromium` step. Its split into system
  dependencies and the browser download comes from the job logs of 20 jobs across five runs
  (timestamp of the first `Downloading Chrome for Testing` line).

## Wall clock per run

| Workflow      | Event                 | Runs | Median | Max  |
| ------------- | --------------------- | ---- | ------ | ---- |
| Test          | push, main            | 5    | 23.1   | 35.6 |
| Test          | pull_request          | 3    | 23.9   | 30.9 |
| Test          | workflow_dispatch     | 6    | 23.1   | 39.3 |
| Release Build | push / dispatch, main | 20   | 23.8   | 46.2 |

## Test, per job (push on main)

| Job                                    | Queue (max)    | Waits for frontend  | Checkout | Toolchains | npm ci | pip | Playwright | Tests | Job total |
| -------------------------------------- | -------------- | ------------------- | -------- | ---------- | ------ | --- | ---------- | ----- | --------- |
| frontend                               | 0.1 (0.9)      | --                  | 0.1      | 0.3        | 0.1    | 0.0 | --         | 2.8   | 3.4       |
| backend                                | 0.1 (0.8)      | --                  | 0.0      | 0.2        | --     | 0.1 | --         | 2.8   | 3.3       |
| portable-core                          | 0.1 (0.8)      | --                  | 0.1      | 0.1        | --     | --  | --         | 0.0   | 0.3       |
| visual-baseline-reach                  | 0.1 (0.9)      | --                  | 0.0      | 0.1        | --     | --  | --         | 0.0   | 0.2       |
| Core on macos-15                       | 0.1 (1.0)      | --                  | 0.1      | 0.1        | --     | 0.1 | --         | 3.5   | 3.9       |
| Core on windows-2025                   | 0.1 (**20.0**) | --                  | 0.1      | 0.2        | --     | 0.3 | --         | 5.3   | 6.3       |
| Browser E2E / slot 1 of 4              | 0.0 (0.2)      | 3.5                 | 0.0      | 0.3        | 0.1    | 0.1 | 0.5        | 12.4  | 13.9      |
| Browser E2E / slot 2 of 4              | 0.1 (0.1)      | 3.5                 | 0.0      | 0.3        | 0.1    | 0.1 | 0.4        | 6.3   | 7.9       |
| Browser E2E / slot 3 of 4              | 0.0 (0.1)      | 3.5                 | 0.0      | 0.2        | 0.1    | 0.1 | 0.4        | 6.6   | 8.0       |
| Browser E2E / slot 4 of 4              | 0.0 (0.1)      | 3.5                 | 0.0      | 0.1        | 0.1    | --  | 0.5        | 2.4   | 3.3       |
| Product on macos-15                    | 0.1 (**20.3**) | 3.5                 | 0.1      | 0.0        | 0.1    | 0.1 | 0.2        | 12.8  | 13.5      |
| Product on windows-2025 / shard 1 of 8 | 0.0            | 3.5                 | 0.1      | 0.2        | 0.3    | 0.2 | 3.5        | 8.2   | 12.7      |
| Product on windows-2025 / shard 2 of 8 | 0.0            | 3.5                 | 0.1      | 0.2        | 0.3    | 0.3 | 3.2        | 7.2   | 11.6      |
| Product on windows-2025 / shard 3 of 8 | 0.0            | 3.5                 | 0.1      | 0.2        | 0.3    | 0.2 | 3.4        | 7.2   | 11.5      |
| Product on windows-2025 / shard 4 of 8 | 0.0            | 3.5                 | 0.1      | 0.2        | 0.3    | 0.5 | 3.5        | 5.7   | 10.6      |
| Product on windows-2025 / shard 5 of 8 | 0.0 (**16.5**) | 3.5                 | 0.1      | 0.2        | 0.2    | 0.2 | 3.5        | 5.7   | 10.3      |
| Product on windows-2025 / shard 6 of 8 | 0.0            | 3.5                 | 0.1      | 0.2        | 0.3    | 0.2 | 3.3        | 6.5   | 10.7      |
| Product on windows-2025 / shard 7 of 8 | 0.0            | 3.5                 | 0.1      | 0.2        | 0.3    | 0.2 | 3.3        | 5.4   | 9.7       |
| Product on windows-2025 / shard 8 of 8 | 0.0            | 3.5                 | 0.1      | 0.2        | 0.2    | 0.2 | 2.8        | 4.9   | 8.6       |
| Design on macos-15                     | 0.1 (0.2)      | 3.5                 | 0.1      | 0.0        | 0.1    | --  | 0.2        | 8.3   | 8.8       |
| Design on windows-2025                 | 0.0 (0.1)      | 3.5                 | 0.1      | 0.1        | 0.3    | --  | 3.4        | 13.9  | 17.9      |
| browser-e2e (aggregator)               | --             | waits for all slots | --       | --         | --     | --  | --         | --    | 0.1       |

Pull-request runs look the same within a minute per job; Design on windows-2025 is the longest
job there at 19.8 minutes.

## Playwright install, split

| Runner       | System dependencies                                   | Browser download | Step total | Jobs sampled |
| ------------ | ----------------------------------------------------- | ---------------- | ---------- | ------------ |
| ubuntu-24.04 | 15–65 s (apt)                                         | 7–10 s           | 24–73 s    | 7            |
| windows-2025 | 125–250 s (`Install-WindowsFeature` Media Foundation) | 10–27 s          | 136–277 s  | 9            |
| macos-15     | 1–4 s                                                 | 9–12 s           | 10–16 s    | 4            |

The browser download is 7–27 seconds everywhere. A browser cache can save at most that much per
job. The expensive part is the system half: on Windows, `--with-deps` enables a Windows feature
on every run, which no cache can carry across runners -- 3 to 4 minutes in each of the ten Windows
browser jobs.

**The system half cannot be skipped on either system; the runner images lack what it installs.**

- **windows-2025:** in all 9 sampled jobs `Install-WindowsFeature` reported
  `Success True, Exit Code Success, Feature Result {Media Foundation}`. A feature that is already
  present reports `NoChangeNeeded` and an empty result; this one is installed fresh every time. A
  fail-closed check for Media Foundation in front of a plain `playwright install chromium` would
  therefore fail every Windows job.
- **ubuntu-24.04:** in all 5 sampled jobs apt installed 9–10 new packages, the same set each time:
  `fonts-freefont-ttf fonts-ipafont-gothic fonts-tlwg-loma-otf fonts-unifont fonts-wqy-zenhei
xfonts-cyrillic xfonts-encodings xfonts-scalable xfonts-utils`. These are fonts. Without them
  text renders with other fallbacks, which changes what the Linux visual baselines compare.

## Runner queue

Of about 200 job starts since 2026-10-01, four waited more than three minutes for a runner, and
those four waited 16–20 minutes:

| Run                                    | Job                                    | Queue |
| -------------------------------------- | -------------------------------------- | ----- |
| 37961937563 (push, release 2026-10-09) | Core on windows-2025                   | 20.0  |
| 37961937563 (push, release 2026-10-09) | Product on windows-2025 / shard 5 of 8 | 16.5  |
| 37113154094 (push, release 2026-10-03) | Product on macos-15                    | 20.2  |
| 37216539640 (dispatch, 2026-10-04)     | Product on macos-15                    | 20.3  |

Three of the four are release pushes, but **the account's concurrency limit does not explain
them**. Counting every job of every workflow that ran around those pushes (Test, Release Build,
Release Publish, Generate visual baselines, Distribution Contracts), minute by minute:

| Push               | Peak, all workflows | Peak Windows | Peak macOS | Waiting job and when it started                                                      |
| ------------------ | ------------------- | ------------ | ---------- | ------------------------------------------------------------------------------------ |
| release 2026-10-09 | 15                  | 8            | 2          | Core on windows-2025: queued from 16:50, while no Windows job ran at all until 16:53 |
| release 2026-10-03 | 18                  | 10           | 2          | Product on macos-15: queued 20 min while 1–2 macOS jobs ran                          |

GitHub documents 20 concurrent jobs and 5 macOS jobs for the Free plan; the account's plan is not
readable with the token used here. Both peaks stay under those numbers, Windows ran ten jobs at
once on 2026-10-03 (so there is no lower Windows cap), and the macOS job waited with three macOS
slots free. The waits look like runner supply on GitHub's side rather than this repository's
load: a job sometimes gets its runner about 20 minutes late, whatever else is running. Between
releases they are as rare as during them -- four in about 200 starts.

## Release Build, per job

| Job                             | Queue (max)      | Toolchains | npm ci | Playwright | Gate / work | Job total |
| ------------------------------- | ---------------- | ---------- | ------ | ---------- | ----------- | --------- |
| Require the exact main revision | 0.1 (0.5)        | 0.0        | --     | --         | 0.0         | 0.1       |
| version-check                   | 0.2 (0.7)        | 0.1        | --     | --         | 0.0         | 0.3       |
| Portable release gate           | 0.2 (20.4)       | 0.3        | 0.1    | 0.5        | 20.0        | 21.1      |
| web-image                       | after the gate   | 0.2        | --     | --         | 1.8         | 2.2       |
| backup-image                    | after the gate   | 0.1        | --     | --         | 0.4         | 0.7       |
| python-package                  | after the gate   | 0.1        | --     | --         | 0.1         | 0.3       |
| release-manifest                | after the images | 0.1        | --     | --         | 0.0         | 0.3       |

The portable release gate is 21 of the 24 minutes; the artifact jobs after it take two.

## What the numbers say

- **Setup is small except for Playwright on Windows.** Checkout, toolchains, `npm ci` and pip take
  well under a minute per job. Caching them could save seconds at most.
- **The longest path is frontend (3.5) followed by the longest browser job** -- Design on
  windows-2025 (14 min of tests with one worker) or Product on macos-15 (13 min). Sharding those
  shortens the run; adding shards elsewhere does not.
- **Queue time is rare and not caused by the concurrency limit.** The measured peaks (15 and 18
  jobs across all workflows) stay under the documented 20; the four long waits happened anyway.

## Caches

Test caches npm and nothing else: `setup-node` with `cache: npm`, keyed on the system and
`package-lock.json`, in the jobs that run `npm ci`. That cache predates this measurement and stays.

Two more caches were built and taken out again, because the numbers above do not carry them:

| Candidate           | Most it can save per job                                         | Why it is not used                                                                                              |
| ------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Playwright browsers | the 7–27 s browser download, minus restoring ~180 MiB from cache | `--with-deps` still installs the system half on every run (15–65 s on Linux, 125–250 s on Windows), hit or miss |
| pip                 | part of the 0.1–0.5 min the pip steps take                       | the installs are small wheels from PyPI; there is little left to save                                           |

Each restored cache is also a way into the job: whatever a cache entry holds runs or is imported
there. GitHub scopes entries by ref, so a pull request cannot write what main restores, but fewer
caches still mean less to keep that way. `workflow_contract.py` fails if test.yml uses
`actions/cache` or any `cache:` other than npm; adding one means measuring it first and changing
that rule with it.

**Windows keeps `--with-deps`.** The windows-2025 image does not contain Media Foundation (9 of 9
job logs install it fresh, see "Playwright install, split"), so a plain `playwright install
chromium` behind a fail-closed check would fail every job. Whether the suites need Media
Foundation at all is a separate question for T-45. Linux keeps `--with-deps` for the fonts it
installs.

## Matrix

Two shapes of the Test workflow, decided by the `plan` job in one place:

```text
full_matrix =
     inputs.full_matrix == true
  || (github.event_name == 'push' && github.ref == 'refs/heads/main')
  || (github.event_name != 'pull_request' && format('{0}', inputs.full_matrix) != 'false')
```

Fail-safe: the matrix is reduced only for a pull request or an explicit `full_matrix: false`.
Both inputs (`workflow_dispatch`, and `workflow_call` prepared for a release caller) default to
`true`. An explicit `true` wins even when a caller came from a pull request, because in a called
workflow `github.event_name` is the caller's event.

The last term compares the input as text on purpose. GitHub's `==` converts operands of different
types to numbers, so a missing input (`null`) _equals_ `false`, and the plain
`inputs.full_matrix != false` would reduce the matrix exactly when the input has gone missing.
`format('{0}', null)` is `''`, which is not `'false'`.

No job but `plan` reads `github.event_name`. `workflow_contract.py` checks both inputs (boolean,
default true), the expression and that rule. `test_release.py` evaluates the expression from
test.yml with GitHub's comparison rules for these cases:

| Case                                  | Result  |
| ------------------------------------- | ------- |
| push to main                          | full    |
| workflow_call without input           | full    |
| workflow_call with `true`, from a PR  | full    |
| workflow_dispatch with the default    | full    |
| workflow_dispatch with `false`        | reduced |
| pull request                          | reduced |
| workflow_call with `false`, from a PR | reduced |

| Jobs                                                                | Full (main, dispatch, call) | Reduced (pull request) |
| ------------------------------------------------------------------- | --------------------------- | ---------------------- |
| plan, backend, portable-core, frontend, lint, visual-baseline-reach | 6                           | 6                      |
| Core on macOS and Windows                                           | 2                           | 2                      |
| Linux browser slots + `browser-e2e` aggregator                      | 4 + 1                       | 4 + 1                  |
| Browser on Windows (8 slots) and macOS (3 slots)                    | 11                          | --                     |
| Smoke on Windows and macOS                                          | --                          | 2                      |
| **Total**                                                           | **24** (was 23)             | **15** (was 23)        |

Why this cut:

- **The run waits on its longest job, so the shards even out.** The longest job used to be Design
  on windows-2025 (18 min with setup) and Product on macos-15 (13.5). Each Windows slot now runs a
  product shard 1/8 and a design shard 1/8 -- about 6.4 + 1.7 minutes of tests plus 4 of setup --
  and each macOS slot half of both suites, about 10.5 minutes. Linux product shards split by test
  instead of by file (`PLAYWRIGHT_FULLY_PARALLEL=1`), which evens slot 1 (12.4 min of tests) out
  with slots 2 and 3 (6.5). Windows has run the whole product suite that way for a long time, so
  the tests do not depend on each other's order there. **Should the first CI run show
  order-dependent failures on Linux anyway, they belong to T-34 (flakes), not back into T-33.**
- **Windows keeps eight slots.** Chromium exhausted the Windows runner's network buffers after
  more than 115 product tests, even with serialized contexts. Eight runners keep each product
  process at about 66 of the current 531 tests, as before; the design shard runs as its own
  process afterwards.
- **Fewer setups, the same tests.** Product and design used to have separate Windows and macOS
  jobs, each paying for its own packages and Chromium -- on Windows 3–4 minutes of system
  dependencies every time. Now each slot pays once. The unit tests ran in every one of the nine
  cross-platform product jobs; they now run once per system.
- **Pull requests leave the expensive runners free.** A pull request runs everything on Linux,
  the backend and Rust suites on all three systems, and one smoke runner per system (below). That
  is 15 jobs instead of 23, and 4 instead of 13 on Windows and macOS.
- **Concurrent jobs on a main push.** The full matrix starts one Windows/macOS job fewer than
  before (10 instead of 11) plus the seconds-long `plan` job. Peak after `frontend`: the 4 Linux slots, the 10
  Windows/macOS slots and Core on windows-2025 (still running), about 15; with the 2–3 Release
  Build jobs of a release push, about 18. Measured before: 18 at the 2026-10-03 release. The
  documented limit is 20 (5 macOS; the full matrix uses 4 since T-38's third macOS browser slot,
  which adds one job to each peak). The peak stays under it, as it already
  did -- see "Runner queue" for why that does not remove the occasional 20-minute wait.

### Shards by duration

Since T-38 no browser slot uses `--shard`. `tools/dev/test-shards.mjs select` lists both suites
with Playwright, assigns every slot of the system from `tests/playwright/durations.json` --
longest test first onto the slot with the least work, the product suite first, then the design
suite onto what is left -- and writes the slot's two `--test-list` files. It refuses unless
every test lands in exactly one slot, and before anything runs it asks Playwright which tests
each file selects; anything but the assigned tests fails the slot.

`--shard` cut by count. Many product tests skip themselves for a project, so the counts were
equal and the work was not: Linux slot 1 ran 172 tests in 10.3 minutes, slot 2 82 in 4.2 (98
skipped).

- **The table** holds each test's duration in ms by suite and system (`[project] › file › title
path`), plus a wall factor per suite and system: wall time of the slots over the sum of their
  test durations -- the workers, and how well the suite uses them. A system without its own
  table borrows Linux's, then Windows'; the factor is then measured against that table.
- **Fail-safe.** A test missing from the table (new or renamed) gets the table's median and
  still lands in exactly one slot. An entry no test matches is ignored. A slot that its other
  work already fills still gets one test, so no list is empty.
- **Other work** counts as offset: the unit tests in slot 1 of Windows (3.1 min) and macOS
  (2.5 min), the audit rules in Linux slot 4 (9 s), measured in the run on 15e0b43.
- **Windows** keeps its cap: at most 100 product tests per slot (the network buffers ran out
  above 115). With durations the busiest slot gets 78.
- **macOS** runs three slots instead of two; with two, slot 1 took 13.5 minutes.

Contracts: `tools/dev/test-shards.test.mjs` (in `npm run check` through `test:audit-tools`)
reads the slot shapes from test.yml, lists the current suites and checks for every system that
every test is assigned exactly once and selected by exactly one slot's list under Playwright's
own matching rule. `workflow_contract.py` holds the slot topology, the fail-closed shell and the
uploads, and requires the browser group for every program a browser job runs.

#### Updating the table

Every browser slot uploads its JSON reports as `browser-durations-<slot>` (7 days, on success
too). Nothing reads them at CI time; the table changes only by a commit:

```bash
gh run download <run-id> --pattern "browser-durations-*" --dir durations-run
node tools/dev/test-shards.mjs update --suite product --os linux durations-run/browser-durations-linux-*/product.json
node tools/dev/test-shards.mjs update --suite design --os linux durations-run/browser-durations-linux-*/design.json
```

The same for `windows` (`browser-durations-windows-2025-*`) and `macos`
(`browser-durations-macos-15-*`). `update` replaces that suite and system entirely, so renamed
tests drop out, and writes the file sorted: the same reports give the same bytes.
`node tools/dev/test-shards.mjs plan --os <system> --slots <n> [--offset …] [--max-tests …]`
prints the expected slot durations.

The first table comes from the job logs of run 40399143433 (15e0b43), not from JSON reports,
which CI did not write yet: with one worker, the gap between two test starts in the line
reporter's log is the earlier test's duration. That gives product on Linux and Windows and
design on Windows. Design on Linux and both suites on macOS ran with two workers; for them only
the wall factor is measured, against the borrowed table. The first run after the push replaces
all of it with measured reports.

#### Before and after

Before: the run on 15e0b43, measured. Tests = the step "Run product and design shards"; job =
the whole job including setup.

| Slot           | Tests before (min) | Job before (min) | Tests after, expected (min)         | From the mean |
| -------------- | ------------------ | ---------------- | ----------------------------------- | ------------- |
| Linux 1        | 12.9               | **24.6**         | 7.6                                 | 0.0 %         |
| Linux 2        | 7.0                | **18.8**         | 7.6                                 | 0.0 %         |
| Linux 3        | 7.8                | 9.3              | 7.6                                 | -0.1 %        |
| Linux 4        | 2.6                | 3.8              | 7.6                                 | 0.1 %         |
| Windows 1–8    | 2.7–5.7            | 6.0–12.6         | 4.4 each (slot 1: + 3.1 unit tests) | 0.0–0.1 %     |
| macOS 1 (of 2) | 10.2 (+ 2.5 unit)  | 13.5             | 6.9 (of 3, incl. 2.5 unit)          | 0.0 %         |
| macOS 2 (of 2) | 8.2                | 8.9              | 6.9 (slots 2 and 3)                 | 0.0 %         |

Expected job length = expected tests + setup (Linux about 1.5 min, Windows about 5, macOS
about 1.5): Linux about 9, Windows about 9.5, macOS about 8.5 minutes.

Linux slots 1 and 2 of that run also spent 10.6 minutes each in `apt-get` of
`playwright install --with-deps` (25.9 MB at 40 kB/s from azure.archive.ubuntu.com; slots 3 and
4 took under a minute). That is the mirror, not the sharding, and no assignment removes it; it
is reported to the implementer as a separate task.

**Runtime evidence: open until after the push.** The expected values above come from the table;
the measured ones follow from the first full-matrix run.

### The pull-request smoke test

**Linux stays complete on every pull request that runs browser suites at all** -- every product
and design test, assigned to the four slots by duration, and the layout audit rules. That is the condition for running only a
smoke test on Windows and macOS. `workflow_contract.py` fails if the Linux slots read the matrix
plan or get any job-level `if:` other than the path filter's browser group (see "Path filter",
"The one exception to Linux complete").

On Windows and macOS a pull request runs `npx vitest run` and these product specs (test.yml,
`cross-platform-smoke`, "Product smoke specs"):

| Spec                                      | Tests | Why this one shows a system difference                                                                              |
| ----------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------- |
| `tests/e2e/visual-baseline.spec.ts`       | 15    | Compares pixels against that system's own baseline set -- font rasterisation and native controls differ per system. |
| `tests/e2e/world-gate-responsive.spec.ts` | 6     | Creates and opens a world: file creation, locks and paths in the data directory, at several window sizes.           |
| `tests/e2e/chapter-navigation.spec.ts`    | 3     | Opens and switches chapters, which writes and reads the manuscript files.                                           |
| `tests/e2e/manuscript-import.spec.ts`     | 9     | Imports manuscript files: file pickers, path separators and text encodings, where Windows differs most.             |
| `tests/e2e/manuscript-export.spec.ts`     | 18    | Exports to files: file names, line endings and encodings of what is written.                                        |
| **Total**                                 | 51    | of 531 product tests; Windows ran out of network buffers above 115 in one process                                   |

Left out on purpose: `workspaces.spec.ts` (126 tests, more than the Windows limit on its own) and
the design suite, whose system differences the visual baseline already samples. Everything left
out runs on main in the full matrix.

### Checks before and after

Every check that ran for a commit on main still runs for it, in the same or a merged job.

| Check                                            | Before                             | After                                                                            | Event                |
| ------------------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------- | -------------------- |
| Backend suite, contracts, CLI host (Linux)       | backend                            | backend                                                                          | all                  |
| Rust fmt, clippy, tests, cargo-deny              | portable-core                      | portable-core                                                                    | all                  |
| `npm run check` (all gates, formatting, linters) | frontend                           | frontend                                                                         | all                  |
| check:* gates inside `npm run build`             | frontend, a second time            | frontend, once through `npm run check`                                           | all                  |
| tsc -b, vite build, dist/ matches the sources    | frontend                           | frontend                                                                         | all                  |
| Unit tests (Linux)                               | frontend                           | frontend                                                                         | all                  |
| actionlint, hadolint, shellcheck, osv-scanner    | workflow-docker-shell-lint         | unchanged                                                                        | all                  |
| Visual-baseline reach                            | visual-baseline-reach              | unchanged                                                                        | all                  |
| Backend and Rust tests on macOS, Windows         | Core on …                          | unchanged                                                                        | all                  |
| Product and design suites, audit rules (Linux)   | Browser E2E slots 1–4              | unchanged, both suites assigned by duration (T-38)                               | all                  |
| Unit tests on macOS, Windows                     | 9 Product jobs, each               | Browser slot 1 per system (main); Smoke (PR)                                     | main: all; PR: smoke |
| Product suite on macOS                           | Product on macos-15 (whole)        | Browser on macos-15 slots 1–3                                                    | main                 |
| Design suite on macOS                            | Design on macos-15                 | Browser on macos-15 slots 1–3                                                    | main                 |
| Product suite on Windows                         | Product on windows-2025 shards 1–8 | Browser on windows-2025 slots 1–8                                                | main                 |
| Design suite on Windows                          | Design on windows-2025             | Browser on windows-2025 slots 1–8                                                | main                 |
| Product and design suites on macOS, Windows      | the same jobs as on main           | Smoke: visual baseline, world gate, chapter navigation, manuscript import/export | PR                   |

On pull requests the product and design suites on macOS and Windows shrink to the smoke specs.
That is the reduction the brief allows; main still runs them in full.

## Path filter

A pull request runs the job groups its changed paths need (T-37). `.github/test-paths.json` is
the only place that maps paths to groups; `distribution/tooling/path_filter.py` evaluates it in
the `plan` job and `workflow_contract.py` checks it.

### Groups

| Group     | What it runs                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------- |
| `checks`  | the `frontend` job up to `npm run check`: contracts, architecture, design, i18n, formatting, linters |
| `python`  | `backend`, and `Core on …` (backend suite on macOS and Windows)                                      |
| `rust`    | `portable-core`, and `Core on …` (cargo test on macOS and Windows)                                   |
| `client`  | the `frontend` steps after `npm run check`: unit tests, `tsc -b` and `vite build`, dist/ comparison  |
| `browser` | the 4 Linux browser slots, `visual-baseline-reach`, and Browser on … (main) or Smoke on … (PR)       |
| `lint`    | `workflow-docker-shell-lint`: actionlint, hadolint, shellcheck, osv-scanner                          |

Why these six and not one per directory: a group is a set of jobs or steps that can be left out
together. `server`, `workflows` and `docker` are rules, not groups -- they select existing groups:

| Rule                     | Paths (abridged)                                                                        | Groups                          | Why                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------- |
| filter, test-workflow    | `.github/test-paths.json`, `path_filter.py`, `test.yml`                                 | all                             | a change to the filter or to a job is only proven by running everything it could skip |
| project                  | `VERSION`, `package*.json`, `pyproject.toml`, `Cargo.*`, toolchains                     | all                             | versions and toolchains every job installs or compares                                |
| server                   | `src/quiltor/**` except `hosts/cli`, `hosts/desktop`, `hosts/mcp`; `apps/web/server.py` | checks, python, client, browser | the product browser suite talks to this Python on :8010                               |
| python                   | the other hosts, `tests/python/**`, `distribution/**`, `contracts/**`                   | checks, python                  | Python outside the web server, and what the backend suite reads                       |
| client                   | `packages/client/**`, `apps/web` front end, `locales/**`, `dist/**`, build configs      | checks, client, browser         | the client, its build and the committed dist/                                         |
| browser                  | `tests/e2e/**`, `tests/design/**`, Playwright configs, `tools/audit/**`                 | checks, browser                 | the browser suites and the audit rules slot 4 runs                                    |
| rust                     | `crates/**`, `rust-toolchain.toml`, `deny.toml`                                         | checks, rust, lint              | the portable core; osv-scanner reads `Cargo.lock`'s crates                            |
| workflows                | `.github/**` other than the above                                                       | checks, python, lint            | actionlint, zizmor (in check) and `workflow_contract.py` (in the backend suite)       |
| docker                   | `Dockerfile`, `.dockerignore`, `docker-compose.yml`                                     | checks, python, lint            | hadolint and the image contracts in the backend suite                                 |
| lint-inputs              | `**/Dockerfile`, `hadolint.yaml`, `**/*.sh`, every osv lock                             | lint                            | what hadolint, shellcheck and osv-scanner read, derived from `lint-tool.mjs`          |
| contracts-read-by-client | `contracts/**`                                                                          | client                          | the client unit tests import the wire fixtures and schemas                            |
| architecture-docs        | `docs/architecture/**`, `docs/quality/**`, top-level `*.md`, READMEs                    | checks, python                  | the backend suite reads these documents                                               |
| docs                     | other `docs/**/*.md`, `LICENSE`, `knowledgebase/**`, `team/**`, `.claude/**`            | checks                          | prose: formatting, markdownlint and typos only                                        |

A path takes the union of every rule it matches. Three narrow rules add `python` where the backend
suite reads a file of another group: the HTTP client in `packages/client/src/platform/http`
(`test_routes.py`), one image and `dist/index.html`, and the Playwright configs.

**Not tested** (with the reason the contract demands): `docs/screenshots/*.png` -- README images
no gate reads. A path may not be both in a rule and on this list.

### Full mode bypasses the filter

In full mode (push to main, `workflow_dispatch` with the default, `workflow_call` without input
or with `true`) every `run_<group>` output is `'true'` and the filter step does not run: no
checkout, no paths read. A documentation-only push to main runs everything (F-35-10). Each output
has the same form, and the contract allows no other:

```text
run_<group> = full_matrix == 'true' ? 'true' : (filter wrote 'false' ? 'false' : 'true')
```

### Fail-safe

Only a finished filter that wrote a literal `'false'` switches a group off. Everything else runs
everything:

- a path no rule and no untested entry matches (the step logs `::notice::` with the paths);
- an empty change list;
- a diff that cannot be read, or a `HEAD` that is not a merge commit (`::warning::`);
- a filter step that did not run or wrote nothing -- the output expression then falls to `'true'`;
- a reduced run that is not a pull request (`workflow_dispatch` with `false`): nothing to diff.

The paths come from `git diff --name-only --no-renames HEAD^1 HEAD` on the merge commit GitHub
builds for the pull request, two commits deep and checked out sparse (`VERSION` only: the step
needs the history, not the pull request's files). That is exactly what the pull request changes
against the current base, with no API page limit, so "more files than the API returns" cannot
happen; a rename counts as both paths. A crash of the script itself fails `plan`, every job is
skipped and `browser-e2e` is red.

### The base decides

The step runs `path_filter.py` and `test-paths.json` **from the base** (`git show HEAD^1:…` into
`$RUNNER_TEMP`), never the pull request's copies (F-37-3). A pull request that rewrites the rules
or the script is judged by the rules it replaces, and those select everything for a change to
the filter. Without the two files in the base -- the pull request that introduces the filter --
or when `git show` cannot read them, the step writes nothing, warns, and every `run_<group>`
falls back to `'true'`. The base's blobs come from a lazy fetch (the sparse checkout is partial);
the repository is public, so that needs no token, and a failed fetch lands in the same fallback.
`test_path_filter.py` (`BaseFilterTests`) runs the step's own script in a scratch repository
with a base, a pull request and a merge commit.

### Derived, not listed

Two selections are checked against what the tools and tests read, not against a list:

- **lint** -- `workflow_contract.py` resolves every string in `argumentsFor` and `osvLockfiles` of
  `tools/dev/lint-tool.mjs` as a git pathspec, the way the tool does, and adds every lock
  `distribution/dependency-locks.json` names. Each of those files must select `lint` (rule
  `lint-inputs`): Dockerfiles anywhere, `hadolint.yaml`, shell scripts, and every osv lock. A new
  tool argument or lock without the rule fails the contract. The programs the job runs are derived
  the same way (`npm run <script>` in the job, the script in `package.json`, each `tools/` file it
  names, plus direct `node tools/...` calls) and must select `lint` (rule `lint-program`), so a
  change to `lint-tool.mjs` itself runs hadolint, shellcheck and osv.
- **client** -- every file outside `packages/` that a `packages/**/*.test.ts(x)` references by
  import, path literal or `join(process.cwd(), …)` must select `client` (rule
  `contracts-read-by-client`): a wire fixture the TypeScript decoder rejects fails the pull
  request, not main.

### Known limit: test.yml itself

A pull request runs the `test.yml` of its own merge commit. One that rewrites the plan job can
switch off anything, and no rule inside the workflow can prevent that: the `test-workflow` rule
selects everything, but the rewritten job need not ask it. Only branch protection with a required
review closes this, and that is the user's decision -- `main` has none today.

### The plan job, loosened

T-33 held `plan` to "no checkout, no actions, `permissions: {}`". T-37 loosens exactly that far:
`contents: read`, `actions/checkout` and `actions/setup-python` (both already in the lock), all
three filter steps guarded by `full_matrix != 'true' && github.event_name == 'pull_request'`. The
contract fails on any other action, permission or condition. No new action, no token use beyond
the checkout (`persist-credentials: false`).

### The gate: `browser-e2e`

`browser-e2e` keeps its name (no branch-protection change) and now gates every filtered job. It
needs `plan` and all nine filtered jobs, runs `if: always()`, and per job passes only `success`,
or `skipped` when the plan did not select it. A selection is written as `!= 'false'`, so a
missing plan output counts as selected and its skip is red. Failure, cancellation, a failed plan
and any other skip are red. `FILTERED_JOBS` in `workflow_contract.py` is the list; a new job in
test.yml without an entry fails the contract, so T-35 (F-35-1) extends the same list.

Side effect: `browser-e2e` now waits for the slowest job (on main, the Windows slots) and turns
red when any filtered job does, not only a browser slot.

### The one exception to "Linux complete"

|                      | Before (T-33)                              | After (T-37)                                                                                                |
| -------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Linux browser slots  | no job-level `if:`, never read the plan    | exactly `if: needs.plan.outputs.run_browser == 'true'`, never read `full_matrix`                            |
| Can they be skipped? | no                                         | only on a pull request whose paths select no `browser` group; in full mode `run_browser` is always `'true'` |
| Contract mutation    | adding `if: …full_matrix == 'true'` is red | still red; `run_browser && full_matrix != 'true'`, another group, or no condition are red too               |

### Example pull requests

| Pull request changes                          | Jobs that run                                                                                                           |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `docs/plans/x.md` (documentation)             | plan, frontend (`npm run check` only), browser-e2e                                                                      |
| `tests/python/…`, `src/quiltor/hosts/cli/…`   | plan, backend, frontend (check only), Core on macOS/Windows, browser-e2e                                                |
| `src/quiltor/delivery/http/…` (server Python) | plan, backend, frontend (all steps), Core on …, Linux browser slots 1–4, visual-baseline-reach, Smoke on …, browser-e2e |
| `packages/client/src/…` (client)              | plan, frontend (all steps), Linux browser slots 1–4, visual-baseline-reach, Smoke on …, browser-e2e                     |
| `.github/workflows/release.yml`               | plan, backend, frontend (check only), workflow-docker-shell-lint, Core on …, browser-e2e                                |
| an unknown path, or `test.yml`                | everything of the reduced matrix                                                                                        |

`test_release.py` (`PathFilterContractTests.test_truth_table`) computes these rows from the real
expressions in test.yml and the real configuration.

### Before and after

| Pull request kind | Jobs before (T-33) | Jobs after (T-37) | Wall clock after push |
| ----------------- | ------------------ | ----------------- | --------------------- |
| documentation     | 15                 | 3                 | open                  |
| Python, no server | 15                 | 6                 | open                  |
| server Python     | 15                 | 13                | open                  |
| client            | 15                 | 10                | open                  |
| workflows only    | 15                 | 7                 | open                  |
| main, release     | 23                 | 23                | unchanged by design   |

Job counts include `plan` and `browser-e2e`, with each matrix slot as one job. The timings are
open until a push with the user's approval.
