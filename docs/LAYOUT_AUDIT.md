# Layout audit

The layout audit captures every view, menu, dialog and overlay of the application on
three viewports and in both colour modes, checks each screenshot with layout rules and
optionally with an AI review, and writes an HTML report. Findings never block anything: a
run with findings exits 0. It fails only when the run itself breaks, for example when the
server is not reachable or a capture test crashes.

| Viewport | Size     | Input             |
| -------- | -------- | ----------------- |
| mobile   | 390×844  | touch, `isMobile` |
| tablet   | 820×1180 | touch             |
| desktop  | 1440×900 | mouse             |

Each viewport runs in `light` and `dark`.

## Running it locally

The capture projects talk to the Python server on `:8010`, which serves the built `dist/`.

```bash
npm run build
```

```bash
py -3.12 apps/web/server.py 8010 --no-open
```

```bash
npm run audit:layout
```

`npm run audit:layout:ai` does the same and adds the AI review before the report. It needs
`ANTHROPIC_API_KEY`; without it the review is skipped with a notice and the run still
succeeds. `QUILTOR_AUDIT_MODEL` overrides the model. Results of the AI review are cached by
image hash, model and prompt version, so a second run does not pay twice.

Both commands go through `tools/audit/run.mjs`, which checks the server first. If nothing
answers on `:8010` (or on `PLAYWRIGHT_BASE_URL`) it stops with a message saying how to
start it.

## Output

Everything lands in `test-results/layout-audit/` (git-ignored):

- `manifest.json` — every captured state, its findings, the coverage records and failures
- `shots/` — one PNG per state, viewport and theme
- `index.html` — the report, a static file that needs no network: counters by severity,
  source and viewport; filters; a grid per state with mobile, tablet and desktop side by
  side; findings per screenshot with the rule rectangle drawn in; the **Coverage** and
  **Failures** sections; a notice when the AI review was skipped
- `summary.md` — the same counters as Markdown, used for the CI job summary

To rebuild the report from an existing manifest: `node tools/audit/report.mjs [auditDir]`.

## Running it in CI

`.github/workflows/layout-audit.yml` starts only by hand (`workflow_dispatch`). Its
`ai_review` input (default on) enables the AI review, which in turn needs the
`ANTHROPIC_API_KEY` repository secret; if either is missing the job says so in its summary
and runs the rules only. The job uploads `test-results/layout-audit/` as the `layout-audit`
artifact and writes the counters to the job summary.

## Findings

| Source  | Rule IDs                                                                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rules` | `page-horizontal-scroll`, `outside-viewport`, `popup-outside-viewport`, `clipped-text`, `overlap`, `touch-target`, `contrast`, `coverage-unreached`, `touch-context-menu-unverified` |
| `ai`    | `ai:<category>`                                                                                                                                                                      |

A state that exists only in some viewports by design is marked `viewportSpecific` and is
not listed as a failure.

## Which part runs in which gate

| Part                                                 | Command                    | Gate                                                              |
| ---------------------------------------------------- | -------------------------- | ----------------------------------------------------------------- |
| Node tests of the audit tools (`tools/audit/*.test`) | `npm run test:audit-tools` | `npm run check` (local and the `frontend` CI job)                 |
| Rule tests (`tests/audit/rules.spec.ts`)             | `npm run test:audit-rules` | `Browser E2E` CI job, slot 4 (needs Chromium, not the server)     |
| Capture run (`tests/audit/capture.spec.ts`)          | `npm run audit:layout`     | none; manual, or the manually started `layout-audit.yml` workflow |

The rule tests use `page.setContent`, so they need Chromium but no server and no `dist/`.
A run of the `rules` project alone writes no manifest and leaves the output of a previous
capture run untouched. The capture run stays out of every gate and out of the product and
design suites.
