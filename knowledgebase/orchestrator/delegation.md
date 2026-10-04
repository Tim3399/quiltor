# Agent brief and acceptance

Use the following structure for every assignment, including research and review.
Replace all placeholders before sending. Check current ownership first.

```text
Task: Q-XXX — short result-oriented title
Owner: assigned agent
Status: In progress

Was
- Deliver one concrete change or investigation result.
- Owned files/areas: exact paths or a narrow module boundary.
- Exclusions: adjacent work and files owned by others.

Warum
- Explain the user problem or risk and why this slice is needed now.
- Link its requirement and prerequisite tasks.

Wann erledigt
- Observable behavior or evidence required for acceptance.
- Required targeted checks and applicable contributor gates.
- Define relevant failure, cancellation and data-preservation cases.
- Return changed paths, rationale, exact commands/results and remaining gaps.
- Completion requires lead review; implementation alone is not publication.

Context
- Repository path and applicable instructions.
- Minimum necessary code/source references and established findings.
- Dependencies, frozen contracts and integration constraints.
- You are not alone in the codebase. Preserve other changes and adapt to them.
- Do not delegate further. Report blockers promptly with a concrete next step.
```

## Lead acceptance

Read the actual diff and relevant surrounding code. Compare results with the
brief, not just the worker summary. Reuse evidence for unchanged code and
environments; rerun checks after relevant changes or integration risks. Record
failed attempts, skipped checks and limitations honestly.

For code changes, obtain the contributor gates `npm run build` and `npm test`,
plus the relevant backend, browser, contract or design checks. Frontend browser
tests require rebuilt committed `dist/`. Restart the backend after Python edits.
For bug fixes, prove the regression fails when the fix is removed using the
repository's mutation workflow. A documentation-only task needs scoped formatting,
link and content review rather than unrelated application test runs.

If review finds a defect, return the location, impact, requested correction and
check to the same worker. The board stays in review or returns to in progress.
The coordinator alone records final acceptance and integrates the result.

For releases, capture the exact commit, version, required run results and published
release URL. A green local suite or an older green pipeline does not complete a
new release. Keep deployment verification separate.
