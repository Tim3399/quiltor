# Release 3.22.0 and local review

Requested: 2026-10-04. Updated: 2026-10-09. Status: complete, published and running
locally. The owner requested commit, push, tag and then a local launch for
inspection. Release 3.22.0 is published on `a8e9e69`; the earlier preparation
baseline was 3.21.0 / `36aaa46`.

The [two newly reported defects](release-blockers-2026-10-04.md) have now received
reviewed local corrections: occupied-map deletion is blocked, empty deletion
cleans references, the mobile action is reachable, and image uploads gain bounded
client validation and actionable diagnostics. The exact historic production upload
condition remains unconfirmed even after proxy inspection; it is not labelled fixed
or deployed. Build, 1,560 client tests and direct-dist browser checks passed.
The subsequent full preflight, exact-revision CI, release build and publication
also passed; see the dated evidence below. VERSION is 3.22.0. The owner selected
reuse of existing local projects.

- **Was:** integrate the accepted EPUB/mobile/audit changes and coordination
  records, prepare 3.22.0 through the declared updater, push the release revision,
  obtain the release tag through the existing publication workflow and launch it locally.
- **Warum:** make the reviewed work durable and installable and let the owner
  inspect the complete application.
- **Wann erledigt:** committed/pushed revision and matching tag verified, required
  release checks/publication completed, local API and frontend running with verified
  version/source identity and a user-facing URL.

The source acceptance baseline is `c5ba722f2c22b2526a48af2aae4c9f427fb75e05`:
Test 37216539640 passed all 22 jobs. Existing failure observations remain in the
audit CI ledger. Release validation must run on the actual release revision.

The version updater requires a clean checkout and full local preflight, then writes
the five declared manifest files. It does not commit or tag. A VERSION change pushed
to main starts Release Build; Release Publish creates the tag after successful
artifact verification. Creating the tag before that build would make its existing-tag
gate fail, so the requested tag will be produced through this supported sequence.

The coordinator owns Git integration and final acceptance. `epub_serializer` inspects
the exact release environment before any version mutation. The author pilot remains
deferred; production deployment is outside this request.

## Full preflight continuation — 2026-10-05

Reviewed source, distribution and coordination records were committed and pushed
on `codex/roadmap-followup` as `77e5db61b5396ad9df25a61d624bbf8946c8b00a`.
The supported updater then ran the full exact-toolchain preflight. Backend, CLI,
format, Rust, all 1,560 frontend tests, production build/dist equality, package
smoke and OCI gates passed. The browser matrix reached 531 cases and entered the
design suite, but the process ultimately exited 1 during temporary-directory
cleanup: Windows still held `llama-server.log` open (`WinError 32`). The final
browser/design summaries and the owning child process were investigated before
acceptance; no overall preflight pass is claimed. The updater left all five
manifests at 3.21.0 and the working tree clean. This cleanup failure must be
resolved and the supported preflight rerun before publication.

Subsequent evidence: the 531-case product command returned 0, since its chained
design command started; the exact pass/skip split was not retained. Three design
failures were retained (compact-boundary dark chunks 09/11/12), with Chromium GPU
process crashes. A local 4B inference runtime had unexpectedly started during the
browser gate, and its log blocked cleanup. The relationship to the GPU failures
is a resource-conflict hypothesis, not a proved root cause. The browser temporary
directory was also cleaned twice, masking the primary failure.

The frontend agent owns a bounded correction in `release_preflight.py` and
`test_release.py`: explicitly select the existing external-AI endpoint mode to
prevent local inference startup, perform one bounded cleanup path, and retain both
primary gate and cleanup failures when both occur. No timeouts, assertions or
failure gates may be relaxed. The lead will review and commit this correction,
then require a fresh complete supported preflight. Original failure evidence is
retained under `%TEMP%/quiltor-release-preflight-2026-10-04-evidence`.

The two-file correction passed lead and independent diff review. The full
`test_release` suite passed 76 tests before a final test-only addition; the final
focused contract suite passed 12/12. Three mutations failed as intended for the
AI override, duplicate cleanup and lost primary message. The added simultaneous
browser/stop/data failure regression verifies all messages, original cause,
exactly-once calls and stop-before-data ordering. Ruff formatting passed.
The next complete updater run will persist stdout, stderr and exact exit status
in a unique temporary evidence directory; no gate has been bypassed.

Local-start status was rechecked: the former launcher/API/inference PIDs
49392/38584/58520 are now absent and port 8010 has no listener. Their termination
time/cause is not established; an unrelated Ollama process is not evidence about
this tree. The startup agent still retains the ten active project IDs from the
original 3.21.0 API for comparison. After publication it must revalidate ports and
processes, start normally if free, and never kill those stale PID numbers.

## Supported preflight accepted — 2026-10-09

The Oct 5 retry was interrupted before completion and is not acceptance evidence.
On source revision `f3d4c4f25c7e7ed34bbbd2d5b8586dc59580b457`, the fresh supported
`npm run set-version -- minor` run completed with exit 0 on Oct 9 at 09:56 CEST.
All release gates passed: 1,107 backend tests (6 skips), 4 CLI tests, Rust checks,
1,560 frontend tests, build/dist equality, package and OCI smoke checks, product
Playwright (338 passed, 193 declared skips), and design Playwright (144 passed).
The corrected browser cleanup completed without masking errors. Persistent local
evidence is in `%TEMP%/quiltor-set-version-20261009-093312-06fefab6`, including
stdout, stderr and the exact final exit status in `run.json`.

The updater changed only the five declared version manifests from 3.21.0 to
3.22.0. The lead reviewed the exact diff and `git diff --check` passed. Commit,
main push, exact-revision CI/publication and the existing-project local launch
remain the delivery steps; this local pass does not establish publication.

## Published release — 2026-10-09

The lead committed the reviewed version and preflight record as
`a8e9e69309e493decb58f44d7cb0fcfe264a5130` (`chore: release v3.22.0`) and atomically
pushed the work branch and fast-forward main. The publisher created the tag;
no manual tag bypassed the build gate. Verified remote main and `v3.22.0` both
resolve to that exact revision.

- [Test 37902020511](https://github.com/Tim3399/quiltor/actions/runs/37902020511):
  all 22 jobs successful without reruns.
- [Release Build 37902020333](https://github.com/Tim3399/quiltor/actions/runs/37902020333):
  successful, including the independent portable gate, Python package, both OCI
  images and release manifest. Native installers are explicitly disabled by the
  current release targets; their jobs were skipped as configured.
- [Release Publish 37904909484](https://github.com/Tim3399/quiltor/actions/runs/37904909484):
  successful. [v3.22.0](https://github.com/Tim3399/quiltor/releases/tag/v3.22.0)
  was published at 2026-10-09 08:26:40 UTC, neither draft nor prerelease.

Actual Linux portable-gate logs report 1,107 backend tests (2 platform skips),
230 frontend files / 1,560 tests passed, product Playwright 338 passed / 193
declared skips, and design Playwright 144 passed. The final preflight success
line follows both browser suites. Windows local backend skips were 6; these
platform-specific totals must not be conflated.

The independent agent downloaded all three public release assets into a unique
OS temporary directory and ran `release_manifest.py verify` against the exact
source revision: exit 0. The lead inspected the actual manifest. Version,
revision, wheel and sdist digests match both manifest and GitHub asset metadata:

- Wheel SHA-256: `28e729d4c52bcfa879397e6cb69d6f1225becd66c82920095d40f51d953a0395`
- sdist SHA-256: `77d64a1e1cb96d3623f15fb9c01f38fb1bdc823c9efe285940fe269e8135cb5c`
- App image: `ghcr.io/tim3399/quiltor@sha256:ac7061789c07ea4ebac0b89b2dd827c71d9ce1e647304939342f290b04aed7e0`
- Backup image: `ghcr.io/tim3399/quiltor-backup@sha256:e346462010e92e4d18292dbd73b3e524cf8b419b35779c6dacd6b9237fdb41df`

No production deployment occurred. The historical upload rejection cause remains
unconfirmed; published prevention/diagnostics are not proof of incident resolution.

## Existing-project local launch — 2026-10-09

After publication, the startup agent rechecked both free ports and started the
documented `npm start` launcher in the product checkout with explicit child
`QUILTOR_HOME`, `QUILTOR_DATA_DIR=repo/data`, API port 8010, API target and UI port 5173. The caller environment was restored. No stale PID was killed. The source
checkout was the release revision at startup; subsequent coordinator edits affect
only knowledgebase records.

`http://127.0.0.1:5173/` returned HTTP 200. Direct API and frontend proxy both
reported 3.22.0. All ten previously recorded active project IDs matched exactly;
project names and contents were not read. Launcher, API, Vite and inference
processes remained alive after a delayed check and were left running. Startup
stderr was empty. The frontend has no embedded source-revision identity: the
verified checkout, launcher command/log and served API version establish the
available source evidence, not an unimplemented frontend attestation.

Logs are outside the repository under
`%LOCALAPPDATA%/CodexWork/quiltor/runtime-3.22.0`. Process IDs at verification were
43280 (launcher), 43952 (API), 33972 (Vite), 26432 (inference); these are historical
evidence, never authority for a later stop. The local browser open was queued in
the owner's Codex chat. Release delivery and local-start acceptance are complete.
