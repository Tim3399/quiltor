# Release 3.22.0 and local review

Requested: 2026-10-04. Status: in progress. The owner requested commit, push, tag
and then a local launch for inspection. The earlier minor-version preference is
retained; the latest published release and main baseline are 3.21.0 / `36aaa46`.

The [two newly reported defects](release-blockers-2026-10-04.md) have now received
reviewed local corrections: occupied-map deletion is blocked, empty deletion
cleans references, the mobile action is reachable, and image uploads gain bounded
client validation and actionable diagnostics. The exact historic production upload
condition remains unconfirmed even after proxy inspection; it is not labelled fixed
or deployed. Build, 1,560 client tests, 1,102 Python tests (6 skips) and direct-dist
browser checks passed. Final source integration and the full release preflight are
next. VERSION remains 3.21.0. The previous preflight stopped before any version
mutation. Accepted audit/knowledgebase commit `166e06d` is already pushed. The owner
selected reuse of existing local projects.

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
