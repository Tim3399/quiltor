# Follow-up CI evidence

This ledger records remote CI evidence for CLOSE-03. It distinguishes executed supported-platform
checks from jobs skipped by workflow dependencies. It is not release evidence.

## Visual baseline workflows

The native bootstrap [run 37213374818](https://github.com/Tim3399/quiltor/actions/runs/37213374818)
completed successfully on head `2853e01745d2740582e58b21c5c5daa131b1770a`. All four jobs passed:
`gap`, `bootstrap (windows-2025)`, `bootstrap (ubuntu-24.04)`, and
`bootstrap (macos-15)`. Each platform bootstrap installed Chromium, generated its missing
baselines, checked the generated images in, and uploaded diagnostics successfully.

The follow-up gap [run 37214194029](https://github.com/Tim3399/quiltor/actions/runs/37214194029)
completed successfully on head `449dcf91c37b4b34f10fd8ef6beb1726440775fb`. Its `gap` job confirmed no
platform set was missing; the conditional `bootstrap` job was therefore skipped as intended.
These runs establish baseline availability and generation on the supported runners. They do not
replace the Test workflow's strict visual comparisons or other product gates.

The final candidate's automatic [run
37216534438](https://github.com/Tim3399/quiltor/actions/runs/37216534438) completed successfully on
head `c5ba722f2c22b2526a48af2aae4c9f427fb75e05`. Its `gap` job `111478068799` passed and its
conditional `bootstrap` job `111478104036` was skipped because all required platform images were
already present. It changed no baselines.

For the formatting-corrected candidate, the coordinator built a temporary index from head
`7066a98041f90962ac3c1860538cd2d69c307b6b` and added the reviewed local contracts, dist,
locales, client source, tests, and docs. The resulting tree
`5966cdef7fd61b457e11dc20527c2f437845424f` exactly matched the remote candidate tree. The
working checkout remained on local head `36aaa46`; the final JavaScript asset SHA-256 remained
`F0B6EBEA6ADC6290F0E668E5AC7F6FED9F12F7E1C29F4C1C4E85D19E99CA0464`. This establishes the
reviewed local-to-remote content identity without asserting a release.

## Superseded Test run 37213993816

- Workflow: `Test`
- Event: `workflow_dispatch`
- Branch: `codex/audit-closure-2026-10-04`
- Head: `272b7db4b4c9194ed47ca02fc0c2d8e88740a313`
- URL: <https://github.com/Tim3399/quiltor/actions/runs/37213993816>

The head and branch matched the requested candidate. `portable-core` and
`visual-baseline-reach` passed. The frontend job failed at `npm run check:format`; its unit,
build, and committed-dist steps therefore did not run. The browser, design, and product matrices
were skipped by dependency gating. The `browser-e2e` aggregate failed because every browser shard
was skipped, so it is not evidence of a product or Playwright regression.

Coordinator comparison found one candidate packaging difference: the remote
`tests/e2e/audit-followup.spec.ts` contained the pre-final multiline screenshot call, while the
reviewed local file had the final Prettier single-line layout. Product source, dist, and all 32
reviewed native PNGs were identical. The proposed correction is the exact formatted test file,
followed by a fresh Test dispatch on the resulting head. No snapshot blessing or blind rerun is
appropriate.

## Superseded replacement run 37214201664

- Workflow: `Test`
- Event: `workflow_dispatch`
- Branch: `codex/audit-closure-2026-10-04`
- Head: `449dcf91c37b4b34f10fd8ef6beb1726440775fb`
- URL: <https://github.com/Tim3399/quiltor/actions/runs/37214201664>

The head and branch matched the requested replacement. `portable-core` and
`visual-baseline-reach` passed. The frontend job failed only at the Biome formatter in the
formatting contract: `biome format .` checked 998 files and reported one error in
`tests/e2e/audit-followup.spec.ts`. Biome required the `chooser.setFiles` call to keep
`await (await chooser).setFiles({` on one line and put the three object fields on separate lines
with a trailing comma. The candidate instead split the nested `await` across lines and kept the
object inline.

Frontend unit tests, type-check, gates, build, and committed-dist checks did not run. The browser,
design, and product matrices were skipped by dependency gating; the `browser-e2e` aggregate failed
only because its shards were skipped. This is candidate packaging drift, not evidence of a product,
runtime, snapshot, or Playwright regression. The proposed correction is the exact Biome output,
followed by a fresh Test dispatch on a new head. No source behavior change, snapshot update, or blind
rerun is justified.

## Final replacement run 37214593973

- Workflow: `Test`
- Event: `workflow_dispatch`
- Branch: `codex/audit-closure-2026-10-04`
- Head: `7066a98041f90962ac3c1860538cd2d69c307b6b`
- URL: <https://github.com/Tim3399/quiltor/actions/runs/37214593973>

The head and branch match the final candidate. The corrected formatting contract passed, followed
by frontend unit tests, type-check, quality gates, build, and the committed-dist comparison. The
standalone backend, macOS core, portable core, and visual-baseline-reach jobs also passed.

Windows core job `111472442043` failed its backend suite after 1,099 tests with one error and three
skips. `FreshInstallRouteTests.test_a_freshly_created_world_reads_as_empty_instead_of_failing` at
`tests/python/test_server_assistant.py:430` called the fixture's `_request`; the underlying
`urllib.request.urlopen(request, timeout=5)` timed out while waiting for an HTTP response. The same
log recorded a prior server-side `ConnectionAbortedError` for `POST /api/worlds/create`. Source
review found no concrete deadlock or data-integrity cause; schema creation and durable filesystem
writes can exceed the fixture's five-second response budget on a runner. The same candidate's
standalone backend job and macOS core suite passed, and the reviewed local Windows run had passed all
1,099 tests. No product mutation is justified by this single timeout. A repeat should be
instrumented around world creation, schema creation, response timing, and the post-timeout database
rather than hidden by increasing the request timeout.

The exact Playwright test listing maps `audit-followup.spec.ts` to browser slot 1 for its four wide
cases, slot 2 for its four intentionally skipped regular cases, and slot 3 for its four compact
cases. Slot 4 does not contain this spec. Green completion of slots 1 and 3 therefore directly
executes the eight-case wide/compact, light/dark audit matrix rather than merely proving aggregate
browser reach.

The workflow completed with 20 of 22 jobs successful. Both design jobs, all eight Windows product
shards, all four browser slots and their aggregate, frontend, backend, portable core,
visual-baseline reach, and macOS core passed. Besides the Windows core timeout above, macOS product
job `111473126933` failed one test after 332 passed and 192 skipped:
`audit-followup.spec.ts` wide/dark, in `history comparison remains readable`. The helper sampled the
history sheet with a right edge of `1810.6524658203125` in a 1440-pixel viewport.

The history surface is a right-aligned `Sheet`; its `ui-sheet-in` animation starts at
`translateX(100%)`. The helper waited only for visibility before sampling geometry. The measured
overflow was 370.65 pixels, or 42.1% of the settled 880-pixel sheet width, which is consistent with
an intermediate frame of the 220-millisecond entrance animation. The adjacent wide/light case
passed. The diagnostic artifact upload succeeded, but two local attempts to retrieve its 29 MB
archive stalled; one direct attempt left only a 2.27 MB partial archive. The conclusion therefore
rests on the exact CI failure log, the relevant sheet source, independent source review, and the
deterministic local reproduction below rather than a complete remote trace download.

The test-only correction adds a bounded `expect.poll` for the existing one-pixel viewport
containment contract before the unchanged final width and scroll assertions. It does not increase
the assertion timeout or tolerance. Against an isolated final-dist server on port 8134:

- The old helper with the sheet frozen at `translateX(42%)` failed at right `1809.60` versus the
  required `<= 1441`, reproducing the remote failure.
- The corrected helper with a 1500-millisecond entrance animation passed after the animation
  reached final geometry.
- The corrected helper with a permanently frozen `translateX(42%)` failed after the standard
  five-second assertion window at overflow `369.60` versus the required `<= 1`, proving that real
  overflow remains a failure.
- The unmodified wide/compact, light/dark audit matrix passed all eight cases in 36.0 seconds.
- `corepack npm run check:format` passed the full Biome, Ruff, Prettier, and Rust formatting
  contract. The corrected test file SHA-256 is
  `EBA0803E3DF6B8B47BBB068A37D1879A66F776C5F87F40E115C71AAAC4BEFCBE`.

All controlled mutations restored that exact test-file hash. The isolated server, data, and runtime
home were removed after verification.

## Accepted Test run 37216539640

- Workflow: `Test`
- Event: `workflow_dispatch`
- Branch: `codex/audit-closure-2026-10-04`
- Head: `c5ba722f2c22b2526a48af2aae4c9f427fb75e05`
- URL: <https://github.com/Tim3399/quiltor/actions/runs/37216539640>
- Final attempt: 2
- Final conclusion: `success`

The coordinator verified this candidate against the reviewed checkout with a temporary index. The
result was the exact remote tree `8152c83d62084d06a3cd0aba2d0e78d51f2ee91a`; the test-file
SHA-256 remained `EBA0803E3DF6B8B47BBB068A37D1879A66F776C5F87F40E115C71AAAC4BEFCBE`
and the final JavaScript asset SHA-256 remained
`F0B6EBEA6ADC6290F0E668E5AC7F6FED9F12F7E1C29F4C1C4E85D19E99CA0464`.

On the first attempt, Windows core passed in 5 minutes 48 seconds, so the earlier fresh-install
five-second response timeout did not recur. Frontend, backend, portable core, macOS core,
visual-baseline reach, both design jobs, all eight Windows product shards, all four browser slots,
and the browser aggregate also passed. Browser slots 1 and 3 executed the four wide and four compact
`audit-followup.spec.ts` cases; slot 2 contained the four intentionally skipped regular-project
instances and slot 4 did not contain the spec. The corrected eight-case audit matrix therefore ran
and passed remotely.

The first attempt failed only in macOS product job `111478879652`. Two existing tests failed after
the audit cases had passed:

- `tests/e2e/workspaces.spec.ts:3027` expected `Nach Reload vorhanden` after autosave and reload but
  received `Nach Reload vorhandenAnfang`. Source inspection found no deterministic append path, but
  the fixture waits for the first successful non-GET response without checking its body and does not
  verify the exact editor and persisted payload before reload. The available evidence therefore
  could not distinguish editor integration, fill/write ordering, or fixture observation. A repeat
  failure would require logging each write's sequence, `If-Match`, decoded body, and response
  revision, plus GET bodies and editor values before and after reload; weakening the text assertion
  would be inappropriate.
- `tests/e2e/places-drag-pin.spec.ts:93` passed the drag preview checks but persisted map coordinates
  remained 28.8 percentage points from the expected anchor after the five-second poll. A repeat
  failure would require logging target and map rectangles, viewport transforms, and persisted
  `mapU`/`mapV`; increasing the 1.5-point tolerance would be inappropriate.

Both tests had passed on the immediately preceding candidate with identical product code. After all
other jobs completed, the authorized command
`gh run rerun 37216539640 --repo Tim3399/quiltor --job 111478879652` reran only that macOS product
job on the unchanged head. Attempt 2 created job `111482519546`; it passed in 14 minutes 33 seconds,
including unit tests, application installation/start, and a 10-minute 59-second product suite. No
second retry or product/test relaxation was used.

The final structured run result reports all 22 jobs successful: frontend; backend; portable core;
Windows and macOS core; visual-baseline reach; Windows and macOS design; browser slots 1 through 4
and their aggregate; macOS product; and Windows product shards 1 through 8. This is supported-platform
CI evidence for the reviewed candidate. It does not establish a release or deployment.

The final [Generate visual baselines run 37216534438](https://github.com/Tim3399/quiltor/actions/runs/37216534438)
also completed successfully on the exact same head. Gap job `111478068799` passed;
conditional bootstrap `111478104036` skipped as intended because the reviewed
platform reference sets were already complete. The coordinator independently
queried both final run results before closing the four-point task.
