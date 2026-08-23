# TODO — Quiltor Product Roadmap

**Baseline:** Quiltor `3.5.0` / P0 reviewed on 22 August 2026
**Purpose:** Product roadmap. This file answers **what should be built next and in what order**.

---

# Product direction

Quiltor is writing software for people who want to write themselves.

## P0 architecture cutover

The architecture cutover is complete. The authoritative target and enforced
boundary rules live under `docs/architecture/`.

- [x] Separate product modules, hosts, platforms, distribution targets, release
      channels and user entitlements.
- [x] Move UI localisation into contributor-facing root locale packs.
- [x] Replace direct browser/native access with `QuiltorClient` and focused
      platform gateways.
- [x] Replace generic Python package and storage/service buckets with the
      `quiltor` product namespace and owned modules.
- [x] Embed validated build profiles in every published artifact.
- [x] Establish the portable local-core and versioned native-bridge boundary for
      iOS and Android.
- [x] Restructure direct installers, store packages and publishing workflows by
      target.
- [x] Enforce dependency rules, contract fixtures, platform builds and install /
      upgrade / uninstall smoke tests in release preflight.

No item below this gate may introduce new dependencies on the retired folder
layout; the architecture checks enforce that rule.

> **The author writes. The LLM interprets. Tools verify. The author decides.**

The product must keep four boundaries stable:

1. **The manuscript belongs to the author.**
   - No scene generation.
   - No chapter generation.
   - No prose continuation.
   - No AI rewrite feature.
   - No assistant action may silently alter manuscript prose.

2. **AI removes bookkeeping, not creative work.**
   - Detect characters, places, objects and events.
   - Resolve mentions against existing world data.
   - Prepare structured changes.
   - Help maintain timeline, presence and relationships.
   - Perform evidence-backed reality / continuity checks.

3. **Canon is explicit.**
   - Manuscript text, notes, plans and claims are not automatically objective canon.
   - AI-originated state changes remain proposals until the author accepts them.
   - The author is the final canon authority.

4. **Quiltor remains local-first.**
   - Core writing and worldbuilding must work without an external service.
   - The small local model is a semantic interpreter, not a prose generator.
   - Deterministic software should perform validation, resolution and state mutation wherever possible.

---

# Product model

Quiltor should converge on five primary pages:

| Page           | Core question                   |
| -------------- | ------------------------------- |
| **Manuscript** | What have I written?            |
| **Figures**    | Who and what exists?            |
| **Places**     | Where does it happen?           |
| **Timeline**   | When does it happen?            |
| **Storyboard** | What am I thinking or planning? |

Supporting concepts:

- **Notes** = free thinking attached to any relevant object.
- **Canon / World State** = structured facts Quiltor may reason about.
- **References** = explicit links between notes/plans and existing Quiltor objects.
- **Evidence** = why Quiltor believes a structured fact or finding is grounded.
- **Findings** = persistent continuity / reality-check results.

The Storyboard is intended to be the **fifth and final major workspace**. Future growth should mostly deepen these pages rather than add more top-level modules.

---

# Roadmap overview

There are two parallel product tracks:

```text
CORE STORY INTELLIGENCE                    WRITER WORKFLOW

Temporal Canon Foundation                  Shared Notes
        ↓                                      ↓
Entity Resolution                         Reference System
        ↓                                      ↓
World State                               Storyboard
        ↓                                      ↓
Manuscript → World Model                  Chapter Organization
        ↓
Reality Checks
        ↓
Evidence / Findings
        ↓
Retrieval + Incremental Analysis
```

They meet through a shared reference/evidence model.

---

# P0 — Preserve the product invariant

This is not a feature; it is a permanent release gate.

- [x] Keep manuscript-writing tools unavailable to the assistant and MCP.
- [x] Keep AI mutations proposal-only.
- [x] Keep author confirmation before canon mutation.
- [x] Treat retrieved manuscript/notes/storyboard text as untrusted content, not instructions.
- [x] Keep deterministic checks distinguishable from probabilistic LLM judgements.
- [x] Keep Storyboard content non-canon by definition.
- [x] Keep Notes author-owned free text; AI may analyse them but must not overwrite them automatically.

### Release gate

No future feature should pass review if it removes creative writing from the author rather than removing friction around writing.

---

# P0 — Canon and temporal state foundation

The current UI already behaves as if Timeline, Presence and temporal Relationships form one world state. The data model should catch up before more state semantics are added.

## Normalize temporal world data

- [x] Replace destructive figure aggregate rewrites with stable transactional upsert/sync persistence.
- [x] Persist timeline moments as first-class data.
- [x] Give every timeline moment a canonical signed integer `time`.
- [x] The first created timeline moment starts at `t=0`.
- [x] New moments can be positioned relative to any existing moment:
  - `t+4`
  - `t-4`
  - or an explicitly entered absolute timeline coordinate.
- [x] Negative and positive values are equally valid.
- [x] Allow multiple moments at the same `time` for simultaneous events.
- [x] Keep a separate stable `position` value as a display/tie-break order for simultaneous moments.
- [x] Do **not** make Gregorian/ISO dates the canonical representation of time.
- [x] Treat calendars as optional projections of the canonical signed timeline.
- [x] Persist relationship states as first-class temporal data.
- [x] Persist presence/location transitions as first-class temporal data.
- [x] Preserve existing worlds through migration.
- [x] Add referential integrity for element/place/moment/relationship IDs.
- [x] Keep unknown state distinct from false / inactive state.

## Timeline Time System / calendars

- [x] Add Time System configuration directly to the Timeline workspace.
- [x] Support:
  - relative timeline;
  - Gregorian calendar;
  - custom calendar.
- [x] Relative mode displays canonical coordinates directly (`t-12`, `t0`, `t+8`).
- [x] Creating a moment relative to another resolves deterministically (`base.time + delta`).
- [x] A calendar maps canonical `time` values onto author-defined dates.
- [x] Custom calendar v1 supports:
  - calendar name;
  - era/name/abbreviation;
  - named months;
  - configurable days per month;
  - optional weekdays;
  - formatting.
- [x] Calendar configuration must never rewrite canonical timeline coordinates.
- Advanced leap rules, moons and multiple simultaneous calendars remain later work and are not
  part of the P0 calendar projection.

## Canonical World State

- [x] Add a deterministic `WorldState(t)` resolver based on canonical signed timeline coordinates.
- [x] Support state:
  - at a moment;
  - before a moment;
  - after a moment;
  - differences between moments;
  - history for an entity.
- [x] Project existing relationship, death and presence state into the same snapshot model.
- [x] Make the resolver independent of the LLM.

## Story time vs manuscript order

- [x] Allow a chapter to optionally reference the story-time moment/range it represents.
- [x] Keep chapter order independent from chronological world order.
- [x] Support unanchored chapters.
- [x] Support flashbacks without rearranging the world timeline.

### Why P0

This foundation is required for reliable:

- reality checks;
- knowledge state;
- ownership state;
- impossible travel checks;
- chapter-to-canon comparison;
- series canon later.

---

# P0 — Resolve-first world tools

The assistant already generates constrained proposals. The next step is to stop asking the model to solve identity integrity by prompt alone.

## Canonical entity resolution

- [x] Build one resolver for world entities.
- [x] Resolve exact names.
- [x] Resolve normalized spelling.
- [x] Resolve aliases.
- [x] Handle conservative typo/fuzzy matching.
- [x] Use entity type as a signal.
- [x] Use local story context when necessary.
- [x] Return explicit:
  - `resolved`;
  - `ambiguous`;
  - `not_found`.
- [x] Never silently merge two plausible entities.

## Resolve before create

- [x] New manuscript-driven entity proposals require a prior resolution result.
- [x] Exact/alias matches block duplicate creation.
- [x] Ambiguous matches require author choice.
- [x] Extend equivalent guards to the currently modeled structures:
  - [x] relationships;
  - [x] timeline moments;
  - [x] presence;
  - [x] aliases.
- Preserve the same invariant when later ownership / membership / knowledge state is modeled.
- [x] Prefer idempotent `ensure_*` semantics where suitable.

## Tool loop

- [x] Give the local assistant bounded read/resolve tools before proposal creation.
- [x] Keep read tools side-effect free.
- [x] Keep real apply/delete operations outside the LLM tool surface.
- [x] Reuse the same domain service from the app assistant and MCP rather than maintaining two sets of integrity rules.

---

# P0 — Manuscript → World Model

This is the primary AI use case.

> **Write first. Let Quiltor keep the world model in sync.**

The author should not have to manually reproduce the book in a Story Bible.

## World discovery workflow

- [x] Add **Update world from manuscript**.
- [x] Support:
  - current chapter;
  - selected chapters;
  - whole manuscript.
- [x] Reuse the existing batch system for broad scans.
- [x] Extract and prepare:
  - characters;
  - animals;
  - places;
  - organizations;
  - objects;
  - concepts;
  - aliases;
  - relationships;
  - timeline moments;
  - presence/location changes;
  - deaths;
  - profile facts.
- [x] Resolve mentions before proposing new entities.
- [x] Carry earlier accepted/discovered entities through later chapter batches.
- [x] Re-running analysis must not multiply the same entities/events.

## Review

- [x] Group proposals by domain:
  - Elements;
  - Updates;
  - Relationships;
  - Timeline;
  - Presence.
- [x] Support:
  - Accept;
  - Accept group;
  - Edit;
  - Use existing;
  - Ignore;
  - Disambiguate.
- [x] Accepted groups remain one undoable operation where they belong together.

## Claim vs canon

- [x] Do not automatically promote every manuscript statement to objective truth.
- [x] Start distinguishing:
  - objective fact;
  - narrator claim;
  - character knows;
  - character believes;
  - character claims;
  - unresolved / ambiguous.
- [x] Uncertain epistemic status requires review.

### First useful slice

Do not wait for the generalized state engine to ship a first version. Start with the proposal kinds Quiltor already understands:

- create/update entity;
- relationship;
- timeline moment;
- presence;
- death.

Then extend extraction as new state dimensions become available.

---

## Next delivery after P0

The next implementation target is **P1 — NEXT: Hierarchical chapter organization** below.
Shared Notes and Storyboard remain important, but the manuscript binder is intentionally pulled
forward before either of them.

---

# P1 — Shared Notes system

Notes should become a first-class writer workflow, not small textareas scattered through the UI.

## One Notes primitive

- [ ] Create one reusable note editor for:
  - figure/entity notes;
  - place notes;
  - timeline moment notes;
  - chapter notes;
  - storyboard note cards.
- [ ] Preserve plain author-owned text.
- [ ] Autosave.
- [ ] Undo/redo consistent with the owning workspace.
- [ ] Large comfortable editing surface.

## Focus Mode

- [ ] Every substantial note can open in **Focus Mode**.
- [ ] Focus Mode uses nearly the full writing surface.
- [ ] Reuse the existing Quiltor focus/overlay conventions.
- [ ] Clear return path to the owning object.
- [ ] Keyboard-accessible close/return.
- [ ] Do not create a second independent document when entering focus.

## `@` references

- [ ] Typing `@` opens entity/reference autocomplete.
- [ ] Reuse the same world-search candidate index used elsewhere.
- [ ] Support references to:
  - figures/entities;
  - places;
  - timeline moments;
  - chapters;
  - later storyboards.
- [ ] References are explicit links, not inferred canon facts.
- [ ] Clicking a reference navigates to the original object.
- [ ] References survive entity renames because they store IDs, not only visible names.

## Backlinks

- [ ] Show where an object is referenced:
  - notes;
  - storyboard cards;
  - chapters/mentions;
  - timeline;
  - other supported objects.
- [ ] Do not require AI to generate backlinks.

---

# P1 — Figure / entity workspace overhaul

The current figure profile is useful but too prescriptive and the notes area is too small.

## Notes-first profile

- [ ] Make Notes the only default long-form profile field.
- [ ] Give Notes a much larger working area.
- [ ] Add Focus Mode.
- [ ] Keep Notes easy to reach from the entity inspector.

## Flexible fields

- [ ] Stop forcing all new entities to show:
  - Age;
  - Role;
  - Appearance;
  - Background;
  - Voice.
- [ ] Offer those fields as recommendations.
- [ ] Use the same storage model for recommended and user-created fields.
- [ ] Allow arbitrary named fields.
- [ ] Allow optional fields to be removed.
- [ ] Preserve existing 3.0.2 data during migration.

## Entity navigation

- [ ] Add reference/backlink section.
- [ ] Keep relationships and timeline history directly reachable.
- [ ] Consider an entity-centric view of relevant storyboard cards after Storyboard exists.

---

# P1 — Storyboard: fifth and final major page

Storyboard is not a second canon system and not a generic drawing application.

> **Storyboard is Quiltor's free planning layer. Nothing on it has to make sense and nothing on it is canon.**

## Core canvas

- [ ] Add `Storyboard` to the primary workspace navigation.
- [ ] Support multiple boards.
- [ ] Provide one default Main Storyboard.
- [ ] Infinite/large pannable canvas.
- [ ] Zoom and pan.
- [ ] Drag, resize and reorder nodes.
- [ ] Basic connections between nodes.
- [ ] Groups / frames.
- [ ] Undo/redo.
- [ ] Autosave.

## Node types for v1

Keep the node model intentionally small:

- [ ] **Note**
- [ ] **Reference**
- [ ] **Storyboard**
- [ ] **Group / frame**

Reference targets can point to:

- figure/entity;
- place;
- timeline moment;
- chapter;
- storyboard.

Do not build separate copies of those objects inside Storyboard.

## Note cards

- [ ] Storyboard text is a normal Quiltor Note.
- [ ] Drag a Note onto the canvas.
- [ ] Edit directly on the canvas.
- [ ] Resize the note.
- [ ] Open the note in the shared Notes Focus Mode.
- [ ] Use `@` references inside the note.

## Search → Drag & Drop

This is a **required v1 feature**, not a later enhancement.

- [ ] Provide world search inside / beside the Storyboard.
- [ ] Search figures, places, timeline moments, chapters and boards.
- [ ] Drag any search result onto the canvas.
- [ ] Dropping creates a reference node.
- [ ] Double-click/open a reference node to navigate to the source workspace.
- [ ] Reuse the same search candidate/index layer as global search and `@` autocomplete.

## Boards inside boards

- [ ] A board reference opens another Storyboard.
- [ ] Allow arbitrarily deep board linking.
- [ ] Show breadcrumbs.
- [ ] Do not encourage a rigid hierarchy; boards may be used however the author thinks:
  - Acts;
  - arcs;
  - scene ideas;
  - possible endings;
  - loose problems;
  - random ideas.

## Canon boundary

- [ ] Storyboard references mean **relevant to this idea**, not “this is true”.
- [ ] Storyboard connections are visual/planning connections, not canonical relationships.
- [ ] Storyboard mentions do not mutate presence, relationship, timeline or knowledge state.
- [ ] Reality checks do not treat Storyboard content as canon.
- [ ] AI must label Storyboard context as planning context.

## AI inside Storyboard

Keep this deliberately narrow.

Useful:

- [ ] Detect references in free notes.
- [ ] Resolve detected names to existing world objects.
- [ ] Find all cards that reference an entity.
- [ ] Compare a planned sequence with current canon on explicit request.
- [ ] Prepare structured proposals if the author explicitly chooses to promote information.

Not useful / do not build:

- [ ] plot idea generator;
- [ ] next-scene generator;
- [ ] scene prose generator;
- [ ] “improve this idea” generative workflow.

---

# P1 — NEXT: Hierarchical chapter organization

The manuscript frontend must support a real hierarchical binder, not only a flat
chapter list with one optional grouping level.

## Folder tree

- [ ] Allow chapters to be placed inside folders.
- [ ] Allow folders to contain other folders.
- [ ] Support arbitrary nesting depth in the data model and frontend.
- [ ] Do not hard-code a one-level `Part -> Chapter` structure.
- [ ] Root-level chapters and folders may coexist.
- [ ] Support drag-and-drop:
  - chapter → folder;
  - chapter → nested folder;
  - folder → folder;
  - move items back to root;
  - reorder siblings.
- [ ] Prevent invalid tree operations:
  - folder into itself;
  - folder into one of its descendants;
  - duplicate ownership/location of one chapter or folder.
- [ ] Allow folders to be renamed.
- [ ] Allow folders to be collapsed/expanded in the binder.
- [ ] Preserve open/collapsed state as UI preference where useful.

## Manuscript semantics

The folder tree is organizational metadata. It must not alter manuscript prose.

- [ ] Preserve one deterministic flattened chapter order derived from the tree.
- [ ] Use that flattened order for:
  - continuous reading;
  - chapter numbering;
  - word counts;
  - manuscript export;
  - PDF export;
  - assistant whole-manuscript processing;
  - search result ordering;
  - batch processing.
- [ ] Moving a folder moves all descendant chapters as one subtree.
- [ ] Existing flat manuscripts migrate with every chapter at the root and retain
      exactly their current order.
- [ ] Empty folders are valid.
- [ ] Folder depth must not leak into chapter identity or canon.

## Continuous chapter navigation / overscroll switching

The manuscript should feel like one continuous book while still keeping chapters as
clear editing units.

- [ ] When the editor is at the very top of a chapter and the author continues scrolling
      upward, reveal a small **Previous chapter** affordance.
- [ ] When the editor is at the very bottom and the author continues scrolling downward,
      reveal the mirrored **Next chapter** affordance.
- [ ] Do not switch chapters on the first wheel/trackpad event at the boundary.
- [ ] Require a short deliberate continued overscroll / hold, roughly in the range of
      `0.7–1.0 s`, before navigating.
- [ ] Show visual progress while the threshold is being reached.
- [ ] Cancel the pending switch immediately when the author scrolls back in the opposite
      direction.
- [ ] Make the affordance clickable so mouse users can navigate without relying on a
      sustained overscroll gesture.
- [ ] Keep the interaction subtle; the current page may visually give way by a few pixels
      to reveal the navigation element, similar to a restrained pull-to-refresh interaction.
- [ ] Use the binder's single deterministic flattened chapter order.
- [ ] Folder boundaries are transparent to this navigation; moving from the last chapter
      in one nested folder to the first chapter in the next follows the flattened reading order.
- [ ] Navigating forward opens the next chapter at its **top**.
- [ ] Navigating backward opens the previous chapter at its **bottom**.
- [ ] At the first/last chapter, do not show a nonexistent previous/next target.
- [ ] Preserve normal chapter editing: ordinary scrolling inside a chapter must never
      trigger navigation.
- [ ] Keep an explicit keyboard-accessible navigation action in addition to the gesture.

Example at the bottom of a chapter:

```text
──────────────────────────────────────────

        ↓  Chapter 13 · The Escape
           Keep scrolling to open

────────────── Next chapter ──────────────
```

The interaction should reinforce that Quiltor is one manuscript, not a set of isolated
documents, without turning the editor into uncontrolled infinite scrolling.

## Cross-workspace integration

- [ ] Storyboard can reference a chapter regardless of folder depth.
- [ ] Search shows useful folder/breadcrumb context for chapters.
- [ ] Assistant evidence/source navigation opens the correct chapter even when nested.
- [ ] Chapter story-time anchors remain attached to the chapter, not the folder.
- [ ] Folder names may be used as optional context labels, but must never be interpreted
      as manuscript facts/canon.

Example:

```text
Manuscript
├── Prologue
├── Part I
│   ├── Arrival
│   │   ├── Chapter 1
│   │   └── Chapter 2
│   └── Investigation
│       ├── Chapter 3
│       └── Chapter 4
├── Part II
│   └── ...
└── Notes / Cut material
    └── Alternate opening
```

This is a general author workflow and remains independent from any future DM/campaign
mode.

# P1 — Evidence / Provenance

Quiltor should be able to answer:

> **Why do we think this is true?**

## Evidence sources

- [ ] Add provenance for AI-extracted canon proposals.
- [ ] Track:
  - source type;
  - chapter;
  - manuscript revision;
  - source range/span;
  - optional structured reference;
  - creation time.
- [ ] Keep manual facts visibly manual.
- [ ] Mark stale text evidence when its source revision no longer matches.

## Navigation

- [ ] Evidence opens the original source.
- [ ] Evidence links must never point to invented/nonexistent spans.
- [ ] Use exact evidence for semantic continuity findings.

This should reuse concepts from manuscript mentions/references where possible, but evidence has different semantics and lifecycle from a simple `@` link.

---

# P1 — Generalized State Facts

Once `WorldState(t)` is stable, extend beyond relationship/presence/death.

## v1 state dimensions

- [ ] ownership
- [ ] membership
- [ ] knowledge
- [ ] belief
- [ ] status
- [ ] simple attributes

Examples:

```text
owns(anna, silver_key)
member_of(anna, northern_guard)
knows(anna, traitor_identity)
believes(bob, anna_is_dead)
status(anna, injured)
attribute(anna, eye_color, green)
```

Requirements:

- [ ] State changes are temporal.
- [ ] Objective facts and beliefs/knowledge remain distinct.
- [ ] Unknown is represented explicitly.
- [ ] Single-value attributes detect conflicting simultaneous values.
- [ ] Multi-value predicates support several active values.

---

# P1 — Chapter Reality Check

This is the second major LLM use case after manuscript → world extraction.

## Trigger

- [ ] Reality Check for current chapter.
- [ ] Reality Check for selected chapters.
- [ ] Optional check after meaningful author action, never an intrusive every-keystroke AI loop.

## Deterministic first

Check structured state without the LLM wherever possible:

- [ ] invalid event ordering;
- [ ] presence conflicts;
- [ ] acting after death;
- [ ] impossible / suspicious travel;
- [ ] relationship-state misuse;
- [ ] exclusive ownership conflicts;
- [ ] knowledge before acquisition.

## Semantic second

Use the LLM only for things requiring interpretation:

- [ ] factual/detail mismatch;
- [ ] manuscript statement vs structured canon;
- [ ] character knowledge/belief mismatch;
- [ ] world-rule contradiction;
- [ ] other contextual contradiction candidates.

## Output

- [ ] Finding explains the issue.
- [ ] Shows exact evidence.
- [ ] Opens source.
- [ ] Supports:
  - Intentional;
  - Dismiss;
  - Resolve.
- [ ] Never offers replacement prose.

---

# P1 — Persistent Findings

A reality check should not disappear when chat closes.

- [ ] Persist findings.
- [ ] Stable fingerprint for repeat detection.
- [ ] Status:
  - open;
  - intentional;
  - dismissed;
  - resolved.
- [ ] Category / severity / confidence.
- [ ] Link evidence.
- [ ] Link affected canon/state.
- [ ] Re-scan preserves dismissal when the semantic conflict is unchanged.
- [ ] Fix actions navigate to data; they do not rewrite prose.

Start with a compact Findings surface before considering a new major page. Storyboard should remain the final primary workspace.

---

# P2 — Retrieval v2

Do not make embeddings the default response to every retrieval problem.

The current lexical retriever is small, deterministic and testable. Improve it in measured steps.

## Benchmark first

- [ ] Create realistic retrieval fixtures in German and English.
- [ ] Include:
  - exact facts;
  - aliases;
  - paraphrases;
  - synonyms;
  - timeline questions;
  - knowledge questions;
  - evidence lookup.
- [ ] Measure Recall@k / relevant-source rate.

## FTS5 / BM25

- [ ] Evaluate SQLite FTS5.
- [ ] BM25 ranking.
- [ ] Structured filters:
  - chapter;
  - entity;
  - moment;
  - source/evidence kind.
- [ ] Keep graph/world-state expansion.

## Embeddings only if measured

- [ ] Add a semantic fallback/hybrid score only if the benchmark proves it useful.
- [ ] Compare local llama.cpp embedding mode vs lightweight ONNX approach.
- [ ] No PyTorch dependency by default.
- [ ] Cache embeddings by content hash.
- [ ] Re-embed changed chunks only.
- [ ] Never embed the whole corpus on each chat request.

---

# P2 — Incremental manuscript analysis

Whole-book work must scale beyond re-running everything.

- [ ] Content hash per chapter / analysis unit.
- [ ] Track extraction revision.
- [ ] Track dependencies from extracted facts/findings to source revisions.
- [ ] Re-run changed/affected scopes only.
- [ ] Allow full rebuild.
- [ ] Full rebuild and incremental rebuild must converge on equivalent logical results.
- [ ] Keep caches disposable/rebuildable.

---

# P2 — More writing languages

Interface language and manuscript writing language are different concepts.

- [ ] Extend writing-language registry beyond `de-DE`.
- [ ] English first.
- [ ] Capabilities are per language:
  - grammar;
  - dictionary;
  - synonyms;
  - translation.
- [ ] Missing capability degrades gracefully.
- [ ] Preserve local-only default.
- [ ] Keep checksums/licensing/attribution explicit.
- [ ] Add tests per language pack.

---

# P2 — Import existing manuscripts

Important before a real external pilot.

Recommended order:

- [ ] Markdown
- [ ] DOCX
- [ ] TXT / RTF if useful
- [ ] Scrivener later

Import should preserve:

- chapter structure;
- titles;
- paragraphs;
- stable enough source boundaries for evidence;
- manuscript revision provenance.

Do not prioritize Google Docs / Word add-ins before product-market fit.

---

# P2 — Story math and temporal constraints

After the basic resolver is stable:

- [ ] durations;
- [ ] relative before/after;
- [ ] min/max gaps;
- [ ] simultaneous moments;
- [ ] flexible / unknown dates;
- [ ] dependencies;
- [ ] configurable travel assumptions.

Custom fantasy calendars come after these semantics are proven.

---

# P2 — Series / Universe canon

Later, after single-book state works reliably:

- [ ] Shared world canon across books.
- [ ] Book-specific manuscript and narrative order.
- [ ] Explicit retcons.
- [ ] Effective moment/book/revision.
- [ ] Downstream finding invalidation/recalculation.
- [ ] Canon export independent from manuscript.

---

# P2 — MCP/API Story Intelligence

Keep MCP proposal-only for mutations.

Add reusable domain-level tools only after the corresponding app-domain services exist:

- [ ] resolve_entity
- [ ] get_world_state_at
- [ ] get_entity_history
- [ ] search_evidence
- [ ] run_continuity_audit
- [ ] list_findings
- [ ] explain_finding
- [ ] propose_state_change

Never add:

- [ ] `rewrite_manuscript`
- [ ] `continue_story`
- [ ] `apply_without_confirmation`
- [ ] unrestricted delete/canon mutation

---

# P3 — Productization after core workflow proves itself

The repository already has strong packaging, auth, backup and CI foundations. Do not divert core product work into generic infrastructure unless a real release blocker appears.

Later:

- [ ] sample project demonstrating world extraction and reality checks;
- [ ] first-run onboarding:
  - start from scratch;
  - import manuscript;
- [ ] clearer local-AI onboarding;
- [ ] signed/notarized release polish where required;
- [ ] closed pilot with long-form authors.

## Uploaded background map for Places — nice to have

- [ ] Let the author upload an image as the background of the Places canvas.
- [ ] Resize/move the map as one frame while anchored places retain their relative image positions.
- [ ] Keep distance measurements stable by adjusting the map scale when the image is resized.
- [ ] Persist the map and its anchoring metadata locally and include them in backup/restore.
- [ ] Keep this P3: it must not delay core Places or story-intelligence work.

---

# Research / quality track

Run this alongside product work.

## Continuity benchmark

- [ ] Build `quiltor-continuity-bench`.
- [ ] Include supported errors:
  - temporal;
  - presence;
  - knowledge;
  - ownership;
  - factual attribute;
  - world-rule;
  - geography.
- [ ] Include expected non-errors:
  - flashback;
  - lie;
  - false belief;
  - unknown;
  - intentional inconsistency;
  - retcon.
- [ ] Measure:
  - deterministic reproducibility;
  - semantic precision;
  - semantic recall;
  - false-positive rate;
  - evidence resolution rate;
  - retrieval Recall@k;
  - full vs incremental equivalence.

### Non-negotiable benchmark gates

- [ ] 100% of displayed evidence links resolve to real sources.
- [ ] No AI canon mutation without confirmation.
- [ ] No AI manuscript mutation.
- [ ] Deterministic rules produce reproducible results.

---

# Suggested implementation sequence

This is the recommended order, not a promise of version numbers.

## Milestone A — Domain foundation

1. Stable persistence + temporal storage normalization.
2. Signed canonical timeline (`t<0`, `t=0`, `t>0`).
3. Timeline Time System / calendar projection.
4. Canonical `WorldState(t)`.
5. Canonical entity resolver / resolve-first tools.
6. Shared reference identity model.
7. Regression/migration fixtures.

**Exit:** Quiltor can reliably answer “what exists and what state is it in at this moment?” without an LLM.

---

## Milestone B — Writer workflow foundation

1. Shared Notes primitive.
2. Notes Focus Mode.
3. `@` reference autocomplete.
4. Shared search candidate/index layer.
5. Figure/entity Notes overhaul.

**Exit:** Notes are comfortable enough to think/write in and can explicitly reference existing world objects.

---

## Milestone C — Storyboard

1. Fifth workspace + persisted boards.
2. Note/reference/board/group nodes.
3. Search → Drag & Drop.
4. `@` inside storyboard notes.
5. Board-to-board navigation + breadcrumbs.
6. Connections/groups.
7. Backlinks.

**Exit:** An author can freely dump ideas onto connected boards using existing Figures, Places, Timeline and Chapters without creating canon.

---

## Milestone D — Automatic story bookkeeping

1. Bounded read/resolve assistant tool loop.
2. **Update world from manuscript**.
3. Existing proposal kinds first.
4. Evidence on extracted proposals.
5. Claim/knowledge distinction.
6. Extend with generalized state facts.

**Exit:** A long existing manuscript can populate most of its world model through reviewable proposals instead of manual re-entry.

---

## Milestone E — Reality / Continuity

1. Deterministic rule engine.
2. Chapter story-time anchors.
3. Generalized state facts.
4. Reality Check UX.
5. Evidence-backed semantic checks.
6. Persistent Findings.

**Exit:** Quiltor detects useful story-state contradictions without trying to write the correction.

---

## Milestone F — Scale and adoption

1. Retrieval benchmark.
2. FTS5/BM25.
3. Incremental analysis.
4. Embeddings only if justified.
5. Import.
6. English writing tools.
7. Closed pilot.
8. Series canon / advanced temporal logic later.

---

# Explicit non-goals

Do not build these into the near-term roadmap:

- AI prose generation;
- AI scene continuation;
- prompt marketplace;
- dozens of model providers;
- generic Miro/Figma replacement;
- complex diagramming primitives unrelated to stories;
- 18 separate Campfire-style modules;
- collaboration platform before solo-author PMF;
- custom fantasy calendar before temporal semantics;
- separate DM data model before concrete DM workflows justify one;
- cloud dependency for core writing/worldbuilding.

---

# Definition of a rounded Quiltor product

The core product feels complete when an author can:

1. write a manuscript comfortably;
2. keep free notes without fighting tiny text fields;
3. reference existing story objects with `@`;
4. manage people/things/relationships;
5. manage places spatially;
6. manage story time;
7. freely plan on Storyboards without accidentally creating canon;
8. let Quiltor derive structured world data from already-written prose;
9. approve/edit/reject that data;
10. ask for a Reality Check;
11. inspect exact evidence for findings;
12. continue writing rather than maintaining a second manual database.

At that point the five primary workspaces form one coherent system rather than a collection of features:

> **Write in Manuscript. Know the world through Figures, Places and Timeline. Think freely in Storyboard. Let Quiltor handle the bookkeeping around all of it.**
