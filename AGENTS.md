# Agent workflow

Follow `CLAUDE.md` for repository rules and proof requirements, `CONTRIBUTING.md` for contributor gates, and `package.json` for the current scripts. Preserve unrelated changes, including committed `dist/` behavior described in `CLAUDE.md`.

For frontend work, read `docs/design/FRONTEND_STYLEGUIDE.md` (entry section, section 1,
Definition of Done, then relevant sections), `DESIGN.md`, the system contract in
`packages/client/src/design/README.md`, and existing tokens and comparable components.
Preserve the approved scope and identity; review-only requests do not authorize edits.
Validate proposals against current code and report actual checks and remaining gaps.

Read `docs/PROJECT_PROFILE.md` before changing formatting, development startup, build or version tooling. Follow its adopted baseline, command map and explicit pending requirements. Use the declared formatter for each file type and check changed files; keep repository-wide normalization separate from functional changes. Start the complete application through the documented launcher, verify application and source identity to the extent implemented, and report any verification gap. Rebuild before tests serving generated assets and restart the backend after Python changes. Change versions only through the declared updater; version preparation must not implicitly commit, push, tag or publish.

Keep small or tightly coupled changes with the lead. For substantial work with independently useful subtasks, use the `orchestrated-development` skill when available. If delegating without the skill, give each worker a self-contained brief with exclusive file ownership, acceptance criteria, exclusions, and relevant checks. Workers do not delegate. If the runtime cannot delegate, the lead completes the work directly. Use configured model and reasoning defaults unless the user chooses otherwise. The lead reviews the actual diff and check evidence before acceptance.

Choose checks that cover the changed behavior from the scripts in `package.json`; contributor gates are `npm run build` and `npm test`. Report exact commands and outcomes, including failures and unrun suites.

The shared workflow policy is maintained in `../../ai-infra/codex/AGENTS.md`; keep this file focused on Quiltor-specific entry points.
