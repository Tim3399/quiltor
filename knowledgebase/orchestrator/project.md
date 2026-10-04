# Project map

Reviewed: 2026-10-03. Read the linked sources for detail before changing a subsystem.

## Product and constraints

Quiltor is a local-first author workshop. Its five workspaces are Manuscript,
Figures, Places, Timeline and Storyboard. Notes, references, history, import/export
and a local assistant connect them. The author writes the prose. AI may interpret
and propose structured changes, but cannot silently rewrite prose or mutate canon.
Author confirmation and deterministic validation remain release invariants.

The UI is German first; code and developer documentation are English. The project
is source-available under its dual PolyForm licenses, not unrestricted open source.
Core writing must work without cloud services. Delivered cloud synchronization is
manual per-project snapshot/head synchronization with explicit conflict handling;
automatic merging, background sync and commercial subscriptions remain distinct work.

## Code and documentation entry points

| Area                          | Entry point / responsibility                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product direction and backlog | [Roadmap](../../docs/TODO.md)                                                                                                                     |
| Architecture                  | [Overview](../../docs/architecture/overview.md), [phased plan](../../docs/architecture/implementation-plan.md)                                    |
| Python backend                | `src/quiltor/domain`, `application`, `infrastructure`, `delivery`, `bootstrap`; SQLite world persistence                                          |
| Frontend                      | React/TypeScript under `packages/client/src/modules`; app composition under `app`                                                                 |
| Host and transport boundary   | `packages/client/src/platform`; product modules use gateways instead of browser/native globals                                                    |
| Design                        | [Identity](../../DESIGN.md), [style guide](../../docs/design/FRONTEND_STYLEGUIDE.md), [design system](../../packages/client/src/design/README.md) |
| Portable native boundary      | `crates/quiltor-core`, `crates/quiltor-ffi`; do not assume every target architecture phase is delivered                                           |
| Web host                      | `apps/web/server.py`; serves committed production `dist/`                                                                                         |
| Contracts                     | `contracts/manifest.json`, versioned schemas and fixtures                                                                                         |
| Verification                  | `tests/python`, client colocated tests, `tests/e2e`, `tests/design`, `tools/quality`                                                              |
| Launch/version configuration  | [Project profile](../../docs/PROJECT_PROFILE.md), `package.json`, `distribution/toolchains.json`                                                  |
| Publishing                    | [Workflow boundary](../../.github/workflows/README.md), `distribution/tooling`                                                                    |

## Commands and practical traps

- Command sources: [CLAUDE.md](../../CLAUDE.md),
  [CONTRIBUTING.md](../../CONTRIBUTING.md), [package.json](../../package.json).
- Contributor gates: `npm run build`, `npm test`.
- Static aggregate: `npm run check`; it does not run Python tests.
- Backend: `py -3.12 -m unittest discover -s tests/python -t tests/python`.
- Product browser suite: `npx playwright test`; design suite:
  `npx playwright test --config playwright.design.config.ts`.
- Build after frontend edits before browser verification. Restart after backend
  edits. Confirm that the server serves the intended checkout and built assets.
- Start with `npm start` or the documented Python launcher. Use separate ports,
  temporary data and runtime home for test sessions; never run destructive fixtures
  on an author's active world. See the project profile for the full configuration.
- Version updates go through `npm run set-version`; toolchains are exactly pinned.
  The updater requires a clean tree. Do not hand-edit version copies.
- Platform visual baselines are distinct. Missing Linux/macOS baselines need the
  designated workflow and review; a Windows image cannot stand in for them.
- This Windows session needs command-local
  `git -c safe.directory=C:/Users/timra/git/quiltor/quiltor ...` when ownership checks
  reject the checkout. Do not change global Git configuration to work around it.

## Related external surfaces

- Repository: [Tim3399/quiltor](https://github.com/Tim3399/quiltor).
- Showcase: [B825 test site](https://webside-test.bananenban.de/projekte/quiltor).
  Creation was completed in the earlier website task. The regular domain had a
  separate TLS issue; the test-site result does not establish production hosting.
- Operational visibility: [status.bananenban.de](https://status.bananenban.de).

External state above is handover information, not a fresh network check. Recheck
the relevant surface when a task depends on its current availability.
