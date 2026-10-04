# Clean code review standards

These are the critic's working criteria, established on 2026-10-03 before project onboarding. They combine primary-source review guidance with explicit engineering judgments below. Clean code is assessed through correctness, understandable ownership and affordable change; individual slogans are not sufficient evidence.

## Source principles

[Google's review checklist](https://google.github.io/eng-practices/review/reviewer/looking-for.html) covers design, behavior, complexity, tests, naming, comments, style and documentation. It also asks reviewers to examine context and avoid speculative generality.

[Google's review standard](https://google.github.io/eng-practices/review/reviewer/standard.html) puts technical facts above personal preferences and favors demonstrated improvement without demanding perfection. For this critic, that means sustained skepticism with an explicit route to accepting a strong explanation.

[Martin Fowler on code smells](https://martinfowler.com/bliki/CodeSmell.html) treats suspicious structure as a prompt to investigate, not proof of a defect. File size, parameter count and repetition are investigation signals; their consequences decide priority.

[Martin Fowler on refactoring](https://martinfowler.com/bliki/RefactoringMalapropism.html) distinguishes small behavior-preserving transformations from broader restructuring. A behavior change must be identified and verified separately.

Sources consulted on 2026-10-03. The following checklist is a project review synthesis, not a claim that any source prescribes every item.

## Classes functions and state

- Require a coherent responsibility and explain the reasons a unit changes. A class should enforce a useful invariant, own a lifecycle or implement a meaningful boundary; a namespace of unrelated methods needs justification.
- Use truthful domain names and explicit units, optionality and failure semantics. Prefer contracts that make invalid states difficult to construct.
- Keep side effects, ownership and mutation visible. Examine global mutable state, stale callbacks, cancellation, ordering and cleanup before debating cosmetic function length.
- Apply SOLID by checking responsibility, substitutability and dependencies. Do not create an interface for every class or inheritance merely to satisfy an acronym. Prefer the smallest design that serves current requirements.
- Remove duplicated business knowledge where it can drift. Similar syntax alone does not justify a shared abstraction across different responsibilities.
- Handle failures where a meaningful decision can be made. Inspect swallowed errors, partial success, lost diagnostics and retries without idempotency.

## Modules folders and boundaries

- Every product module needs a clear owner, cohesive vocabulary and intentional public surface. Imports through a public entrypoint do not by themselves prove a healthy dependency graph.
- Inspect runtime cycles separately from type-only coupling. Trace why each dependency exists and whether a shared contract actually belongs outside both modules.
- Keep domain rules independent of UI, transports, storage implementations and distribution details. Composition roots may wire concrete implementations together.
- Resist both miscellaneous collector folders and layers that only forward calls. A move is useful when it clarifies ownership or reduces change coupling.
- Treat target diagrams as proposals until the code and phase gates substantiate them. Apply the same skepticism to replacement architecture as to existing code.

## Correctness and verification

- Prioritize data loss, isolation, authorization, atomicity and user-visible behavior over style.
- Trace edits, save acknowledgments, aggregate revisions, world switches, import/export, migration and recovery. Identify which state remains authoritative after every failure.
- Choose tests that exercise observable contracts and realistic failure boundaries. A green test that also passes with the defect restored does not prove a fix.
- Report exact commands, outcomes, environmental failures and unrun suites. Formatting, static checks, unit tests and end-to-end tests establish different things.
- Respect the project's declared formatters and language rules. Keep formatting churn separate from functional fixes.

## Finding format

Each actionable finding needs a stable ID, category, status, affected revision or working-tree context, source references, trigger, invariant, impact, counterargument, proposed remedy and verification criterion. Separate observed behavior from inference.

Use P0 for immediate widespread critical harm, P1 for urgent serious impact, P2 for a material normal-priority defect and P3 for a minor issue. Do not assign defect severity to an unverified suspicion; record investigation priority instead.

Useful statuses are investigating, confirmed, disputed, accepted tradeoff, fixed pending verification, verified and withdrawn. A convincing defense is recorded with its assumptions and the evidence that would invalidate it.
