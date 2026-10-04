# Quiltor initial critic onboarding

Initial familiarization on 2026-10-03 covers the project instructions, architecture overview, representative client session and transport code, and a delegated read-only backend ownership review. It is not a complete code audit or a product acceptance result.

## Repository identity and working state

- Workspace container: `C:/Users/timra/git/quiltor`.
- Product repository: `C:/Users/timra/git/quiltor/quiltor`.
- Observed branch: `codex/roadmap-followup`.
- Observed HEAD: `36aaa46a39ceec5bd3c6fe0b8f65b291affe590d`.
- Package version read: `3.21.0`.
- The working tree already contained substantial edits, including export contracts and code, world selection UI, tests, documentation and generated `dist/` assets. The review therefore describes a moving working tree, not only HEAD. Those changes are not owned by this critic.

Git initially refused reads because the sandbox account differs from the repository owner. Read-only retries used `git -c safe.directory=C:/Users/timra/git/quiltor/quiltor ...`; no global Git configuration was changed. Git also warned that the user's global ignore file was inaccessible.

## Rules read

The workspace and product `AGENTS.md`, product `CLAUDE.md`, `CONTRIBUTING.md`, `package.json`, and relevant sections of `docs/PROJECT_PROFILE.md` establish current commands and conventions. Developer artifacts are English. Product-facing text is German. Declared formatters are Biome, Ruff, Prettier and rustfmt for their respective file types.

`npm run build` and `npm test` are contributor gates. Product browser tests require freshly built `dist/` and the correct server. Python backend tests are separate. A server must be restarted after Python changes. Bug fixes require evidence that the regression test detects the restored defect.

Detailed frontend work additionally requires `docs/design/FRONTEND_STYLEGUIDE.md`, `DESIGN.md`, `packages/client/src/design/README.md` and relevant existing components/tokens. That design-specific review has not been completed here.

## Product and ownership map

Quiltor is a local-first authoring workshop. Manuscript, Story World and Storyboard are separate document aggregates. Assistant changes are proposals requiring author acceptance. The README describes these product intentions; onboarding does not verify every advertised behavior.

| Area                                                 | Observed or documented responsibility                                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `apps/`                                              | Executable shells and native project roots                                                                       |
| `packages/client/src/app/`                           | React composition, world loading, navigation, histories and autosave coordination                                |
| `packages/client/src/modules/`                       | Product areas including manuscript, story-world, storyboard, notes, references, assistant, recovery and transfer |
| `packages/client/src/platform/`                      | Application/device ports, HTTP implementations, wire contracts and host composition                              |
| `packages/client/src/design/`, `shared/`, `locales/` | Design system, domain-neutral shared code and UI catalogs                                                        |
| `src/quiltor/domain/`                                | Domain validation and deterministic policies                                                                     |
| `src/quiltor/application/`                           | Context-specific ports and use cases                                                                             |
| `src/quiltor/infrastructure/`                        | Persistence, backup, inference, identity and other concrete adapters                                             |
| `src/quiltor/bootstrap/`, `hosts/`, `delivery/`      | Dependency assembly, executable lifecycle and transport handlers                                                 |
| `crates/`, `contracts/`                              | Portable core/bindings and shared versioned contracts; not deeply reviewed yet                                   |
| `services/`, `distribution/`                         | Independently deployed services and packaging/build profiles; not deeply reviewed yet                            |
| `tools/`, `tests/`, `docs/`                          | Engineering automation, verification and documentation                                                           |

The architecture authority is `docs/architecture/target-component-model.md` with sequencing in `implementation-plan.md`. Detailed views can be proposed designs. A class appearing in a diagram is not proof of an implemented class or a requirement to create one immediately.

## Representative code paths inspected

Client: `Application.tsx` composes histories and autosave lanes. `app/world/useWorldSession.ts` selects a world and loads three documents. `platform/http/createHttpApplicationGateway.ts` gives several transport implementations a shared `HttpApplicationState`. `platform/http/worlds.ts` updates its active world ID; `platform/http/request.ts` attaches that ID to requests. `app/workspace/useAutosave.ts` drains asynchronous saves and exposes recovery operations.

Backend review: `apps/web/server.py` starts the packaged web host. `hosts/web/server.py` dispatches into `delivery/http/routes/`. The document route calls `application/documents/use_cases.py`; `infrastructure/persistence/adapters/documents.py` implements its repository port. `infrastructure/persistence/sqlite/revisions.py` starts an immediate SQLite transaction, checks the aggregate revision, writes and advances the revision. `bootstrap/application.py` assembles concrete dependencies.

Initial questions from these paths are preserved in the [review register](review-register.md), including counterarguments and missing evidence.

## Executed checks

Commands ran from the product repository against its existing working tree.

| Exact command                                                                                                                                                                                                                                                      | Outcome                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `npm run check:architecture`                                                                                                                                                                                                                                       | Failed before the script ran: npm could not load `C:/Users/timra/AppData/Roaming/npm/node_modules/npm/bin/npm-cli.js` |
| `npm run check:platform`                                                                                                                                                                                                                                           | Same npm entrypoint failure                                                                                           |
| `node --test tools/quality/architecture_docs.test.mjs tools/quality/frontend_boundaries.test.mjs tools/quality/css_ownership.test.mjs tools/quality/shared_feature_classes.test.mjs tools/quality/e2e_world_lifecycle.test.mjs tools/quality/rust_safety.test.mjs` | Passed, 40 tests, zero failures                                                                                       |
| `node tools/quality/check_architecture.mjs`                                                                                                                                                                                                                        | Passed, reported clean architecture boundaries                                                                        |
| `node tools/quality/check_shared_feature_classes.mjs`                                                                                                                                                                                                              | Passed, shared feature classes registered                                                                             |
| `node tools/quality/check_platform_boundaries.mjs`                                                                                                                                                                                                                 | Passed, platform boundary check                                                                                       |

The three direct architecture commands cover the current `check:architecture` script's constituent commands; the npm wrapper itself remains unverified in this environment. Static boundary success does not establish race safety, transaction correctness or overall maintainability.

`npm run build`, `npm test`, Python/Rust suites, product/design E2E suites and the complete `npm run check` were not run for this documentation-only onboarding. No claim of a green product build or complete test baseline follows from these checks.

The new critic documents were formatted with `node node_modules/prettier/bin/prettier.cjs --write "knowledgebase/critic/*.md"`. The delivery check is `node node_modules/prettier/bin/prettier.cjs --check "knowledgebase/critic/*.md"`; its final result is reported in the chat.

## Remaining review coverage

Next priorities are world/session isolation and persistence/recovery, followed by actual module cycles and class responsibility, import/export and contract migrations, assistant authorization, host boundaries, and deployment-specific behavior. Source traversal, runtime reproduction, security review, performance review and full behavioral verification remain incomplete. Recheck current changes before choosing an implementation task.
