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

| Runner       | System dependencies                                                     | Browser download | Step total | Jobs sampled |
| ------------ | ----------------------------------------------------------------------- | ---------------- | ---------- | ------------ |
| ubuntu-24.04 | 15–65 s (apt)                                                           | 7–10 s           | 24–73 s    | 7            |
| windows-2025 | 125–250 s (`Install-WindowsFeature` Media Foundation, "Restart Needed") | 10–27 s          | 136–277 s  | 9            |
| macos-15     | 1–4 s                                                                   | 9–12 s           | 10–16 s    | 4            |

The browser download is 7–27 seconds everywhere. A browser cache can save at most that much per
job. The expensive part is the system half: on Windows, `--with-deps` enables a Windows feature
on every run, which no cache can carry across runners -- 3 to 4 minutes in each of the ten Windows
browser jobs.

## Runner queue

Of about 200 job starts since 2026-10-01, four waited more than three minutes for a runner, and
those four waited 16–20 minutes:

| Run                                    | Job                                    | Queue |
| -------------------------------------- | -------------------------------------- | ----- |
| 37961937563 (push, release 2026-10-09) | Core on windows-2025                   | 20.0  |
| 37961937563 (push, release 2026-10-09) | Product on windows-2025 / shard 5 of 8 | 16.5  |
| 37113154094 (push, release 2026-10-03) | Product on macos-15                    | 20.2  |
| 37216539640 (dispatch, 2026-10-04)     | Product on macos-15                    | 20.3  |

Three of the four are release pushes. The Test workflow starts up to 22 jobs, and a push that
changes `VERSION` starts Release Build alongside it; together they exceed the number of jobs the
account runs at once, and the last jobs to be scheduled wait until a whole earlier job has
finished -- about 20 minutes. The fourth case is a macOS job in a dispatch run with no release
beside it; macOS runners are scarcer than Linux and Windows ones. Between releases the queue is
practically zero.

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
  well under a minute per job. pip and npm caches save seconds.
- **The longest path is frontend (3.5) followed by the longest browser job** -- Design on
  windows-2025 (14 min of tests with one worker) or Product on macos-15 (13 min). Sharding those
  shortens the run; adding shards elsewhere does not.
- **Queue time only appears when Test and Release Build run together.** Fewer concurrent jobs per
  run keep a release push under the concurrency limit.

## Caches

Test caches three things. Each one is restored by the job that needs it and written by as few
runs as possible.

| Cache                                                  | Key                                                                                        | Written by                     | Restored by             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------ | ----------------------- |
| npm (`setup-node`, `cache: npm`)                       | OS + `package-lock.json`                                                                   | every run, in its own ref      | jobs that run `npm ci`  |
| pip (`setup-python`, `cache: pip`)                     | OS + Python + `pyproject.toml` (frontend: also `distribution/lint-tools.requirements.txt`) | every run, in its own ref      | jobs that `pip install` |
| Playwright browsers (`actions/cache/restore` + `save`) | `playwright-<OS>-<arch>-<exact Playwright version>`                                        | runs on `refs/heads/main` only | every browser job       |

**Why a pull request cannot poison what main or a release restores.** GitHub scopes a cache
entry to the ref that saved it. A run can restore entries from its own ref and from the default
branch, never from another branch or pull request. A pull-request run saves into
`refs/pull/<n>/merge`; nothing on main can see that entry. Main's own entries are saved only by
runs on main. A release run is a run on main -- today `release.yml` on push, later `test.yml`
called from it -- so everything it can restore was written by main.

The Playwright cache goes one step further: it is saved only on main at all, so pull requests
read main's entry and never store their own copies. `workflow_contract.py` holds this in place:
test.yml must not use the combined `actions/cache` (which saves from every ref), and every
`actions/cache/save` step must be guarded with `github.ref == 'refs/heads/main'`.

The cache restores only what the next step checks anyway: `npx playwright install` verifies its
browsers by version and downloads them if they are missing, and `--with-deps` installs the system
packages on every run, hit or miss. The expected saving is the 7–27 s browser download per job,
not the system half (see "Playwright install, split").
