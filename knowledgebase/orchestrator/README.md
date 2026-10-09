# Quiltor orchestration

Established: 2026-10-03. Owner: the coordinating agent in the Quiltor chat.

Completed assignment (2026-10-04): all [four audit points](four-point-closure.md).
Code corrections, expanded UI/zoom coverage, native platform references and
independent safety review are accepted. Final Test run 37216539640 passed all
22 jobs on `c5ba722f2c22b2526a48af2aae4c9f427fb75e05`. Consult the taskboard and
[CI evidence](followup-ci-evidence.md) for exact scope and earlier failure evidence.
Completed delivery (2026-10-09): [release 3.22.0 and local review](release-3.22.0.md).
Exact-revision Test, Release Build and Release Publish passed; tag, public assets
and the local instance with all ten existing projects are verified. External EPUB
CI validation, roadmap reconciliation and read-only Simplifier candidates remain
separately queued. S17 remains deferred; production was not upgraded.

Completed review (2026-10-09): the coordinator and Critic assessed SIM-01–06.
The [implementation plan](simplification-review-plan.md) records the accepted
narrow scopes, three phases, planned owners and required evidence. No developer
has been dispatched; the broader normalization and SQL-deletion proposals are
deferred.

The owner has assigned development coordination to this agent. Delegate bounded
work with **Was**, **Warum** and **Wann erledigt**: the requested change, its reason,
and observable completion criteria. “Wann” means the acceptance condition; add a
calendar deadline only when one exists. The coordinator owns decomposition,
dependencies, assignment, review, integration and accurate status reporting.

## Start or resume here

1. Read the applicable `AGENTS.md`, `CLAUDE.md` and `CONTRIBUTING.md` instructions.
2. Read [the taskboard](../taskboard.md), [project map](project.md) and
   [handover](handover.md). Check the actual branch, revision and working tree
   before assigning edits. This directory belongs to the product repository,
   `quiltor/quiltor`, rather than its outer workspace container.
3. Reconcile new evidence with the board. Check whether an agent already owns the
   affected files. Existing changes are not disposable work.
   Include the independent [critic's review register](../critic/review-register.md)
   when it contains relevant findings; a suspected defect needs evidence before
   it becomes a corrective implementation task.
4. Select a bounded task, resolve its dependencies and send a
   [Was / Warum / Wann erledigt brief](delegation.md).
5. Review the actual diff and relevant checks, arrange any corrections, and
   update the board and handover before reporting completion.

## Record ownership

| Record                                     | Authority                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| `knowledgebase/taskboard.md`               | Current coordination status, ownership, dependencies and acceptance conditions |
| `docs/TODO.md`                             | Product priorities, detailed requirements and long-term roadmap                |
| `docs/plans/`                              | Scoped delivery plans and detailed acceptance evidence                         |
| `docs/architecture/implementation-plan.md` | Architecture sequence and implementation gates                                 |
| `knowledgebase/orchestrator/`              | Coordinator memory, decisions, handovers and brief conventions                 |
| Code, contracts and actual check results   | Evidence of implemented behavior                                               |

Keep requirements in their existing source documents and link them from the board.
When a requirement or delivery status changes, update both affected records in the
same task. Historical plans are evidence, not proof that today's working tree or
pipeline passes. Record contradictions as reconciliation tasks instead of silently
assuming either document is correct.

## Working agreement

- Standing owner instruction (2026-10-09): every implementation plan names one
  explicit target release version. Once coordinator and Critic accept the plan,
  begin its accepted scope directly without another owner confirmation. Internal
  implementation/diff reviews remain required. For the current SIM-01–06 plan,
  target 3.22.1 and commit/push/tag after complete local tests are authorized;
  verify the green publication pipeline. Do not infer production deployment.

- Use stable task IDs. Every task has a status, owner, Was, Warum, Wann erledigt,
  source and next action or dependency. Split broad roadmap groups before assigning
  implementation; do not give an agent an entire open-ended roadmap.
- Assign product work to other agents with exclusive file ownership where
  practical. The lead handles coordination, small coupled integration work and
  acceptance. Workers preserve other edits and do not delegate further.
- The owner explicitly reinforced this role on 2026-10-03: the lead should keep
  the overview and correct direction, not perform substantial implementation.
  The first active assignment is the code/bug inventory and frontend quality
  campaign. Delegate its investigation and fixes; retain lead acceptance.
- Update the board on assignment, meaningful progress, block, review rejection,
  acceptance and publication. Do not report idle or completed agents as active.
- An implementation accepted locally can be completed while its linked release
  task stays open. Release completion requires successful required pipelines for
  the exact release revision and a published version. Production deployment is a
  separate fact with separate verification.
- Ask the owner only for a material missing product decision, a conflict in scope
  or a genuinely unavailable prerequisite. Existing authorization persists.
- Keep this memory concise. Store disposable logs and fixtures outside the repo;
  retain reproducible commands, durable source links and important limitations.
  Never store credentials, access tokens or private author material here.
- The independent critic owns `knowledgebase/critic/`. Preserve that record and
  engage with its technical objections through evidence. Record unresolved
  disagreements; coordinator preference alone does not close a finding.
- Communication with the owner is German. Developer documentation follows the
  repository's English convention; the three required brief labels stay German.

## Owner decisions to preserve

| Date / context                      | Decision                                                                                             | Consequence                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Design review, before this handover | Manuscript history uses 16 px serif; technical files use 14 px monospace                             | Preserve the approved typography when extending history/diff views       |
| 2026-10-02, S12                     | Existing public status page is sufficient for now                                                    | Additional operational notification channels remain deferred             |
| 2026-10-03, S17                     | “Autorenpilot vorerst zurückstellen”                                                                 | No participant recruitment or pilot execution until resumed by the owner |
| 2026-10-03, coordination            | Coordinator maintains this knowledgebase and all task states; briefs use Was / Warum / Wann erledigt | Continue this convention across sessions and agents                      |

This setup does not assign calendar dates to unscheduled backlog items or start
every listed feature. The next bounded delivery must be explicit on the board.
