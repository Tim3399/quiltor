# TODO — Quiltor Product Roadmap

**Baseline:** Quiltor `3.7.0` / P0 reviewed on 22 August 2026
**Purpose:** Product roadmap. This file answers **what should be built next and in what order**.

The owner-requested safety and workflow delivery was completed on 2026-09-19 in the
[competition findings sprint plan](plans/competition-findings-sprints.md). That plan
maps all 54 QF-01–QF-09 requirements to bounded tasks and records verification,
including the explicitly closed release gates for an unoffered managed cloud service.

---

# Product direction

Quiltor is writing software for people who want to write themselves.

## P0 repository architecture cutover

The repository/folder cutover is complete. Enforced boundaries live under
`docs/architecture/`; further application, persistence, Assistant and portable
core evolution follows the phased
[`architecture implementation plan`](architecture/implementation-plan.md) and
must not be treated as already implemented.

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

Hierarchical chapter organization, the Figure / entity workspace overhaul and the first usable
**P1 Storyboard** slice are complete. Explicit overlap ordering is now shipped; the deliberately
bounded AI planning features remain open below.

**Import existing manuscripts** is the next high-priority delivery. Intuitiveness testing and
better export follow as P1; device sync is an optional subscription (P2).

Recurring problems of comparable products are collected in
[`competitor pain points`](research/competitor-pain-points.md) (September 2026).

---

# P1 — HIGH PRIORITY: Import existing manuscripts

Most authors arrive with a manuscript that already exists. Import is the moment they decide
whether to switch, and comparable products lose trust exactly here: a LivingWriter import shrank a
290-page manuscript to 56 pages, and Papyrus users lose their structure when a Word file comes back
from the editor. Evidence:
[`competitor pain points`](research/competitor-pain-points.md#2-import-that-silently-drops-text).

## Formats

- [ ] DOCX — the format most authors and their editors already use.
- [ ] Markdown.
- [ ] TXT / RTF if useful.
- [ ] Scrivener `.scriv` projects — Scrivener is the tool most authors switch from.
- Papyrus `.pap` stays out of scope; Papyrus exports DOCX and RTF.

## Trustworthy import

- [ ] Preview the detected chapter and folder split before anything is written.
- [ ] Let the author correct the split (headings, scene separators, page breaks) in the preview.
- [ ] Compare word and paragraph counts of source and result; never lose text silently.
- [ ] Preserve:
  - chapter structure and folder hierarchy;
  - titles;
  - paragraphs;
  - italics, bold and scene separators;
  - stable enough source boundaries for evidence;
  - manuscript revision provenance.
- [ ] Report content Quiltor cannot represent yet (footnotes, comments, images) instead of dropping
      it.
- [ ] Import into a new world or append to an existing manuscript; one undo step either way.
- [ ] Create a snapshot before importing into an existing world.

## After import

- [ ] Offer **Update world from manuscript** directly after import, so figures, places and timeline
      fill themselves instead of being re-entered.
- [ ] Show progress and keep the manuscript usable while a whole-book scan runs.

## Editor round-trip (later)

- [ ] Re-import a DOCX that came back from an editor with tracked changes into the existing chapters
      without losing notes, references, story-time anchors or folder structure.
- [ ] Present the editor's changes as reviewable differences instead of replacing chapters.

Do not prioritize Google Docs / Word add-ins before product-market fit.

---

# P1 — Intuitiveness: Quiltor must not feel overwhelming

Five workspaces, a signed time axis, calendars, presence and an assistant are a lot to meet at once.
Scrivener's compile, the Papyrus timeline and Aeon Timeline's terminology show how powerful features
go unused when they feel like configuration. Evidence:
[`competitor pain points`](research/competitor-pain-points.md#7-complexity-and-learning-curve).

## Test with authors, not only by review

- [ ] Run moderated think-aloud sessions with about five authors per round who have never used
      Quiltor.
- [ ] Use fixed tasks:
  - write a first chapter and find out whether it is saved;
  - import an existing manuscript;
  - create a figure and a relationship;
  - record where a figure is at a moment;
  - find every mention of a figure;
  - run **Update world from manuscript** and review the proposals;
  - restore an earlier version of a chapter;
  - export the manuscript.
- [ ] Record task success, time, errors and the moments of hesitation.
- [ ] Ask one ease-of-use question per task and a short questionnaire per session.
- [ ] Repeat the round after the design overhaul and after each major workflow change.
- [ ] Keep the findings with the change each one caused.

## UI/UX review

- [ ] Heuristic review of every workspace: visible state, recognition over recall, consistency,
      error prevention and recovery.
- [ ] Audit German labels for jargon (`Kanon`, `Präsenz`, relative coordinates such as `t+4`) and
      test replacements with authors.
- [ ] Progressive disclosure: calendars, relative time coordinates, custom fields and layer controls
      appear when needed, not on first contact.
- [ ] Every setting must justify its existence; remove or merge overlapping ones.
- [ ] Empty states explain the next useful step in one sentence.
- [ ] Writing a first sentence requires no setup of world, timeline or assistant.
- [ ] Without an installed model, assistant surfaces explain what is missing instead of failing.

## Let the assistant take over bookkeeping

- [ ] List every manual maintenance task in Quiltor and classify it:
  - deterministic and automatic;
  - assistant proposal the author confirms;
  - necessarily manual.
- [ ] Move tasks up that list wherever the product invariant allows, for example aliases, presence
      changes, relationship changes and story-time anchors for chapters.
- [ ] Never ask the author to re-enter what the manuscript already says.
- [ ] Keep proposal review light: grouping, accepting a whole group, no flood of low-confidence
      proposals.
- [ ] Count the steps of the fixed tasks above before and after each change.

---

# P1 — Better export

Today Quiltor exports one 6 × 9 in book PDF. Authors need files for editors, agents, shops and
print. Comparable products fail in two ways: a compile designer nobody understands (Scrivener) and
exports that break later (EPUB rejected on upload, chapter numbers missing in DOCX). Evidence:
[`competitor pain points`](research/competitor-pain-points.md#3-export-and-compile-as-a-configuration-maze).

## Formats

- [ ] DOCX manuscript for editors and agents.
- [ ] German standard manuscript page (`Normseite`) as a one-click preset.
- [ ] EPUB 3.
- [ ] Print PDF in common trim sizes, not only 6 × 9 in.
- [ ] Markdown / plain text for portability.
- [ ] World data (figures, places, timeline) in a readable format.

## Presets instead of a compile designer

- [ ] Named presets (manuscript for an editor, Normseite, e-book, paperback) with few, clear options:
      title page, chapter numbering, scene separator, font.
- [ ] Preview before the file is written.
- [ ] Carry chapter numbers, titles, italics and scene separators into every format, in the binder's
      flattened order.

## Verify before the author uploads

- [ ] Validate EPUB output against the EPUB 3 specification in the release suite.
- [ ] Report word and chapter counts of the export next to the manuscript's.
- [ ] Round-trip test: import an exported DOCX and compare it with the source.

---

# P1 — Shared Notes system

Notes should become a first-class writer workflow, not small textareas scattered through the UI.

## One Notes primitive

- [x] Create one reusable note editor for all currently shipped note owners:
  - figure/entity notes;
  - place notes;
  - timeline moment notes;
  - chapter notes.
- [x] Reuse the same editor for storyboard note cards.
- [x] Preserve plain author-owned text.
- [x] Preserve note presentation separately from that text:
  - bold;
  - italic;
  - heading levels 1–3.
- [x] Use the same formatting contract for chapter, figure/place, timeline and Storyboard notes.
- [x] Keep references and formatting mapped to the same UTF-16 text revision.
- [x] Autosave through the owning document/workspace.
- [x] Undo/redo consistent with the owning workspace.
- [x] Large comfortable editing surface.

## Focus Mode

- [x] Every substantial note can open in **Focus Mode**.
- [x] Focus Mode uses nearly the full writing surface.
- [x] Reuse the existing Quiltor focus/overlay conventions.
- [x] Clear return path to the owning object.
- [x] Keyboard-accessible close/return.
- [x] Do not create a second independent document when entering focus.

## `@` references

- [x] Typing `@` opens keyboard-accessible entity/reference autocomplete.
- [x] Reuse the same world-search candidate index used elsewhere.
- [x] Support references to every currently shipped target:
  - figures/entities;
  - places;
  - timeline moments;
  - chapters.
- [x] Add Storyboard targets.
- [x] References are explicit links, not inferred canon facts.
- [x] Clicking a reference navigates to the original object.
- [x] References survive entity renames because they store IDs, not only visible names.

## Backlinks

- [x] Show where an object is referenced across every currently shipped source:
  - [x] notes;
  - [x] storyboard cards;
  - [x] chapters/mentions;
  - [x] timeline;
- [x] Require future reference-capable objects to join the same derived backlink index.
- [x] Do not require AI to generate backlinks.

---

# P1 — Figure / entity workspace overhaul

The current figure profile is useful but too prescriptive and the notes area is too small.

## Notes-first profile

- [x] Make Notes the only default long-form profile field.
- [x] Give Notes a much larger working area.
- [x] Add Focus Mode.
- [x] Keep Notes easy to reach from the entity inspector.

## Flexible fields

- [x] Stop forcing all new entities to show:
  - Age;
  - Role;
  - Appearance;
  - Background;
  - Voice.
- [x] Offer those fields as recommendations.
- [x] Use the same storage model for recommended and user-created fields.
- [x] Allow arbitrary named fields.
- [x] Allow optional fields to be removed.
- [x] Preserve existing 3.0.2 data during migration.

## Entity navigation

- [x] Add reference/backlink section.
- [x] Keep relationships and timeline history directly reachable.
- [x] Add an entity-centric view of relevant storyboard cards through backlinks.

---

# P1 — Storyboard: fifth and final major page

Storyboard is not a second canon system and not a generic drawing application.

> **Storyboard is Quiltor's free planning layer. Nothing on it has to make sense and nothing on it is canon.**

The first usable workspace slice shipped on 30 August 2026 with independent
history/autosave, multiple boards, all four v1 node types, shared Note cards,
search/drag references, connections and navigation breadcrumbs. Explicit
front/back controls and dragging a newly created Note from the element library
shipped on 1 September 2026. Provenance-safe, read-only Assistant context for
Storyboard planning shipped the same day.

Real browser acceptance creates isolated worlds for board/Note persistence,
reference drag/open, connections and moved-node positions. Backlink coverage
also opens an entity profile, follows a Storyboard source and verifies the exact
board and selected card. Ordering acceptance now covers overlapping cards,
persisted z-indices and wheel zoom over card content. Palette acceptance drags a
blank Note to a deliberate canvas position and verifies reload persistence.

## Core canvas

- [x] Add `Storyboard` to the primary workspace navigation.
- [x] Support multiple boards.
- [x] Provide one default Main Storyboard.
- [x] Infinite/large pannable canvas.
- [x] Zoom and pan.
- [x] Drag and resize nodes.
- [x] Add explicit front/back ordering controls for overlapping nodes.
- [x] Basic connections between nodes.
- [x] Groups / frames.
- [x] Undo/redo.
- [x] Autosave.

## Node types for v1

Keep the node model intentionally small:

- [x] **Note**
- [x] **Reference**
- [x] **Storyboard**
- [x] **Group / frame**

Reference targets can point to:

- figure/entity;
- place;
- timeline moment;
- chapter;
- storyboard.

Do not build separate copies of those objects inside Storyboard.

## Note cards

- [x] Storyboard text is a normal Quiltor Note.
- [x] Drag a Note onto the canvas.
- [x] Edit directly on the canvas.
- [x] Resize the note.
- [x] Open the note in the shared Notes Focus Mode.
- [x] Use `@` references inside the note.

## Search → Drag & Drop

This is a **required v1 feature**, not a later enhancement.

- [x] Provide world search inside / beside the Storyboard.
- [x] Search figures, places, timeline moments, chapters and boards.
- [x] Drag any search result onto the canvas.
- [x] Dropping creates a reference node.
- [x] Double-click/open a reference node to navigate to the source workspace.
- [x] Reuse the same search candidate/index layer as global search and `@` autocomplete.

## Boards inside boards

- [x] A board reference opens another Storyboard.
- [x] Allow arbitrarily deep board linking.
- [x] Show breadcrumbs.
- [x] Do not encourage a rigid hierarchy; boards may be used however the author thinks:
  - Acts;
  - arcs;
  - scene ideas;
  - possible endings;
  - loose problems;
  - random ideas.

## Canon boundary

- [x] Storyboard references mean **relevant to this idea**, not “this is true”.
- [x] Storyboard connections are visual/planning connections, not canonical relationships.
- [x] Storyboard mentions do not mutate presence, relationship, timeline or knowledge state.
- [x] Reality checks do not treat Storyboard content as canon.
- [x] AI must label Storyboard context as planning context.

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

- [x] Allow chapters to be placed inside folders.
- [x] Allow folders to contain other folders.
- [x] Support arbitrary nesting depth in the data model and frontend.
- [x] Do not hard-code a one-level `Part -> Chapter` structure.
- [x] Root-level chapters and folders may coexist.
- [x] Support drag-and-drop:
  - chapter → folder;
  - chapter → nested folder;
  - folder → folder;
  - move items back to root;
  - reorder siblings.
- [x] Prevent invalid tree operations:
  - folder into itself;
  - folder into one of its descendants;
  - duplicate ownership/location of one chapter or folder.
- [x] Allow folders to be renamed.
- [x] Allow folders to be collapsed/expanded in the binder.
- [x] Preserve open/collapsed state as UI preference where useful.

## Manuscript semantics

The folder tree is organizational metadata. It must not alter manuscript prose.

- [x] Preserve one deterministic flattened chapter order derived from the tree.
- [x] Use that flattened order for:
  - continuous reading;
  - chapter numbering;
  - word counts;
  - manuscript export;
  - PDF export;
  - assistant whole-manuscript processing;
  - search result ordering;
  - batch processing.
- [x] Moving a folder moves all descendant chapters as one subtree.
- [x] Existing flat manuscripts migrate with every chapter at the root and retain
      exactly their current order.
- [x] Empty folders are valid.
- [x] Folder depth must not leak into chapter identity or canon.

## Continuous chapter navigation / overscroll switching

The manuscript should feel like one continuous book while still keeping chapters as
clear editing units.

- [x] When the editor is at the very top of a chapter and the author continues scrolling
      upward, reveal a small **Previous chapter** affordance.
- [x] When the editor is at the very bottom and the author continues scrolling downward,
      reveal the mirrored **Next chapter** affordance.
- [x] Do not switch chapters on the first wheel/trackpad event at the boundary.
- [x] Require a short deliberate continued overscroll / hold, roughly in the range of
      `0.7–1.0 s`, before navigating.
- [x] Show visual progress while the threshold is being reached.
- [x] Cancel the pending switch immediately when the author scrolls back in the opposite
      direction.
- [x] Make the affordance clickable so mouse users can navigate without relying on a
      sustained overscroll gesture.
- [x] Keep the interaction subtle; the current page may visually give way by a few pixels
      to reveal the navigation element, similar to a restrained pull-to-refresh interaction.
- [x] Use the binder's single deterministic flattened chapter order.
- [x] Folder boundaries are transparent to this navigation; moving from the last chapter
      in one nested folder to the first chapter in the next follows the flattened reading order.
- [x] Navigating forward opens the next chapter at its **top**.
- [x] Navigating backward opens the previous chapter at its **bottom**.
- [x] At the first/last chapter, do not show a nonexistent previous/next target.
- [x] Preserve normal chapter editing: ordinary scrolling inside a chapter must never
      trigger navigation.
- [x] Keep an explicit keyboard-accessible navigation action in addition to the gesture.

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

- [x] Storyboard can reference a chapter regardless of folder depth.
- [x] Search shows useful folder/breadcrumb context for chapters.
- [x] Assistant evidence/source navigation opens the correct chapter even when nested.
- [x] Chapter story-time anchors remain attached to the chapter, not the folder.
- [x] Folder names may be used as optional context labels, but must never be interpreted
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

# P2 — Device sync and cloud storage (optional subscription)

Quiltor stays fully usable on one device without an account. Sync between devices and cloud storage
can be booked as a subscription. Comparable products show what must not happen: Scrivener projects
break inside Dropbox, iCloud and OneDrive folders, Dabble cannot merge offline work from two devices,
and cloud-first apps lock authors out when the login or the service fails. Evidence:
[`competitor pain points`](research/competitor-pain-points.md#4-sync-between-devices).

## Principles

- [ ] The local world stays authoritative and fully usable offline.
- [ ] Sync runs through Quiltor's own revision-aware service, never by placing the SQLite database
      in a third-party sync folder.
- [ ] End-to-end encryption: the service stores what it cannot read.
- [ ] Sync is not backup: local backups and restore keep working without a subscription.
- [ ] Ending the subscription leaves every world local, complete and editable.

## Behaviour

- [ ] Sync per document revision (manuscript, story world, storyboard), reusing the existing revision
      checks.
- [ ] Conflicting edits from two devices are shown side by side and never resolved by overwriting.
- [ ] Offline edits on two devices merge per chapter where they do not overlap.
- [ ] Visible sync state: last sync, pending changes, conflicts.
- [ ] Evaluate whether `services/backup-server` can become the sync and storage backend.
- [ ] Transfer changed chapters and assets only; this needs the
      [storage foundation](#storage-foundation-snapshot-units-end-to-end-encryption-retention) first.

## Storage foundation: snapshot units, end-to-end encryption, retention

Cloud backup is the first paid part of this subscription, and sync builds on the same storage. Today
it would not pay for itself. Every snapshot stores the whole world database as one blob
(`snapshots.py`, `_collect`). In the largest local test world that is 4.47 MB, of which 4.0 MB are
two place-map images and 177 KB are chapter text, so changing a comma stores the images again.
Snapshots are manual only, only the newest one is uploaded, `encryption` must be `none`, and the
reference server never deletes anything.

### Decisions

- Keycloak stays the identity provider for the hosted web app and the store apps.
- One backup client for every host: the Python process on desktop, in store apps and in the hosted
  web app. The web app runs the same end-to-end code, but there the server decrypts; the browser
  version says so plainly ("decrypted on the server, not end-to-end").
- A forgotten passphrase is covered by a recovery key that is shown once. Losing both loses the
  cloud copy; local worlds are untouched.
- Retention: every snapshot of the last 30 days, then the newest snapshot of each calendar month
  (UTC) with no end date. The newest snapshot overall is always kept. The same rule applies locally
  and on the server.
- Automatic snapshots at most every 10 minutes, plus an upload queue for every snapshot that is not
  on the server yet.

### Phase 1 — Snapshot format v3: units instead of the database (local, plaintext)

- [ ] Split a snapshot into canonical JSON units (sorted keys, compact, UTF-8) built from the v1
      document contracts (`application/document_wire_v1.py`), so equal content yields the same blob:
  - `world.json`: world title and document contract versions;
  - `manuscript/index.json`: chapter order, `structure`, `language`, `grammarMode`, `words`,
    `activeSymbols`, `hiddenElements`;
  - `manuscript/chapters/<id-hash>.json`: one chapter as in the v1 document;
  - `story-world/index.json`: node order, `edges`, `timeline`, `presence`, `canvasSize`,
    `mapScale`, `timeSystem`;
  - `story-world/nodes/<id-hash>.json`: one element with its profile and aliases;
  - `storyboards/index.json` and `storyboards/boards/<id-hash>.json`: one board with its nodes and
    edges;
  - `assets/place-maps/<sha256>`: image bytes, only for images that a `mapImageId` references;
  - `assistant/interactions/<id-hash>.json`: one immutable assistant log row.
- [ ] `<id-hash>` is a shortened SHA-256 of the id, so the path is always portable; the id itself
      lives inside the unit.
- [ ] Exclude revisions, `owner_sub`, `backup_endpoint`, `schema_version`, the Markdown mirrors
      (derived), indexes and unreferenced images. Backups stop depending on the SQLite schema.
- [ ] Pure `split_world` / `join_world` in `application/backup_units.py`, with round-trip tests
      over the `wire.v1` fixtures.
- [ ] `_collect` reads all three documents in one read transaction; `load` in
      `sqlite/manuscript.py`, `sqlite/story_world.py` and `sqlite/storyboards.py` gains the optional
      `conn` parameter that `save` already has.
- [ ] Restore: `join_world` → the domain validators (`valid_figures`, `valid_manuscript`,
      `valid_storyboard_document`, `story_time_anchor_issue`) → a fresh staged database via
      `schema.initialize` → `story_world.save`, `manuscript.save`, `storyboards.save`, then images
      and assistant rows, in that order for the foreign keys → `quick_check` → the existing atomic
      swap → regenerate the mirrors (`mirror_text`, `mirror_profiles`) → `finalize_restore`.
- [ ] Blob writes skip digests that already exist instead of re-reading and decompressing them;
      reads keep verifying.
- [ ] History keeps its client contract:
  - `status` still lists chapters as `manuscripts/NN - Title.md` and elements as
    `profiles/NN - Name.md`;
  - the new display paths `storyboards/…` and `assets/…` get their own kinds in
    `modules/history/pathNames.ts`;
  - `diff` renders chapter text with `markdown_body` / `note_markdown` from `mirror.py`, so the
    output matches today's;
  - `chapter_version` and `chapter_comparison` read the chapter unit by id without decompressing a
    database.
- [ ] v1 and v2 snapshots stay readable and restorable through the existing code path.
- [ ] Manifest v3 in `application/backup_manifest.py`: `CURRENT_FORMAT_VERSION = 3`, supported
      {1, 2, 3}; `world.json` required; new field `kind` (`manual`, `automatic`, `before-restore`);
      limits per unit kind (images 10 MiB, chapters large enough for 10 million characters of
      UTF-8, 1 GiB in total).
- [ ] Contracts: `contracts/backup/v3.md`, `v3.schema.json` and
      `contracts/fixtures/backup/snapshot.v3.json`, registered in `contracts/manifest.json`; update
      `tests/python/test_architecture_contracts.py`.
- [ ] Update the History port wording in `docs/architecture/implementation-plan.md`, where it still
      reads chapters "from immutable snapshot SQLite".

**Exit:** a v3 snapshot restores on a fresh machine; v2 snapshots still restore; editing one chapter
adds only that chapter unit and `manuscript/index.json` (asserted by blob count);
`tests/e2e/history-design.spec.ts` stays green; the change is proven with `tools/dev/mutate.mjs`.

### Phase 2 — Local retention and automatic snapshots

- [ ] Pure, standard-library `retained(items, now) -> frozenset[str]` in
      `application/backup_retention.py`: keep everything with `at >= now - 30 days`, the newest
      snapshot of each calendar month (UTC) and the newest snapshot overall. A timestamp in the
      future counts as `now`; ties are broken by id.
- [ ] Fixture `contracts/fixtures/backup/retention.v1.json`: month boundary, February in a leap
      year, tie, empty list, timestamp in the future.
- [ ] Ship the module in the backup-server image next to `backup_manifest.py`: Dockerfile `COPY`,
      `artifact-contract.json` payload, `tests/python/test_distribution.py`,
      `tests/python/test_release.py`.
- [ ] Thin the local history after each commit under a new per-world lock, in process and as a lock
      file in the history directory (there is none today, and two server processes can run at
      once): rewrite `index.jsonl` atomically (temporary file, fsync, `os.replace`), then mark and
      sweep unreferenced blobs. A crash in between leaves only orphan blobs for the next run.
- [ ] When a snapshot's `parent` was thinned, `diff` and `chapter_comparison` compare with the
      nearest older retained snapshot instead of an empty base.
- [ ] Automatic snapshots next to `backup_if_due` in `application/documents/use_cases.py`, after the
      save and outside its path: when the last snapshot is older than 10 minutes and something
      changed, commit with `kind=automatic` and the `_describe_changes` message. Failures are
      logged and never fail a save.
- [ ] The 40 rotating SQLite copies (`sqlite/restore.py`) stay as they are.

**Exit:** the retention fixture is green; crash tests pass at every thinning step; autosave creates
at most one snapshot per 10 minutes; History shows each snapshot's kind.

### Phase 3 — End-to-end encryption and upload queue

- [ ] Account key: 32 random bytes per Keycloak `sub`, wrapped twice: by a passphrase key derived
      with Argon2id (`cryptography` 50.0.0 ships `kdf.argon2`, so no new dependency) and by a
      recovery key (32 random bytes, shown once as grouped Base32, with a confirmation step).
      Per-world keys come from HKDF-SHA256 (`…/{world}/enc`, `…/{world}/dedup`).
- [ ] Key document at `GET/PUT /v2/keys`, with `If-Match` against lost updates; the server checks
      its structure only.
- [ ] Key cache:
  - desktop and store apps use the `CredentialVault`; first fix the macOS adapter, which passes the
    secret to `security -w` as a command-line argument
    (`infrastructure/platform/adapters/credentials.py`);
  - the hosted web app keeps the key in session memory only (`infrastructure/identity/runtime.py`),
    so backup pauses after a restart until the passphrase is entered again.
- [ ] Blob: zlib, then AES-256-GCM (random nonce, AAD = world id + unit digest), stored as
      `version ‖ nonce ‖ ciphertext` and named by its SHA-256. The standard-library server keeps
      checking `sha256(body) == name` without any cryptography.
- [ ] The v3 manifest (paths, titles, messages, `kind`, local snapshot id and, per unit,
      `keyedDigest = HMAC(dedup key, plaintext)`, `size`, `blob`) is encrypted as its own blob. The
      server sees only the envelope
      `{format, encryption, world, id, parent, created, keyId, manifest, blobs[{sha256, size}]}`,
      i.e. world ids, times, sizes and counts; document that.
- [ ] Dedup: reuse a blob when its `keyedDigest` appears in the last uploaded manifest, cached under
      `history/{world}/remote/` and rebuildable from the server.
- [ ] Protocol `/v2/`:
  - a snapshot `PUT` checks that the blobs exist and have the right size instead of re-hashing
    every blob;
  - `GET /v2/worlds` returns no titles; the client decrypts them;
  - the client no longer writes plaintext v1/v2 uploads;
  - touches `infrastructure/backup/remote.py`, `adapters.py`, `services/backup-server/server.py`
    and `contracts/backup/v1.md`.
- [ ] Upload queue as an after-commit job: uploads every retained snapshot that is not on the server
      yet, oldest first, and resumes after offline periods and restarts. The snapshot dialog shows
      the last upload and the number of pending snapshots.
- [ ] Hosted web app: request the `quiltor.backup` scope when a backup endpoint is configured
      (`identity/runtime.py`, today only `openid email profile`); document the Keycloak client
      scope in the README.
- [ ] Flows:
  - set up: choose a passphrase, confirm the recovery key;
  - new device: log in, enter the passphrase, pick a world;
  - change the passphrase: re-wrap the account key only;
  - recover: recovery key, new passphrase, new recovery key;
  - log out: delete the cached key.
- [ ] Contracts `contracts/backup/remote-envelope.v1.*` and `key-document.v1.*`, with fixed test
      vectors (key, nonce) so future Swift and Kotlin apps verify the same bytes.

**Exit:** the server holds no plaintext (a test searches the stored files for a known chapter
sentence); swapped blobs, a wrong world AAD or an altered envelope fail closed; a fresh machine
restores with the passphrase and with the recovery key; unchanged chapters are not uploaded again;
the hosted web flow works with the session key.

### Phase 4 — Server retention, garbage collection and usage

- [ ] The server records `receivedAt` per envelope and applies `backup_retention.retained` to it, so
      client clocks and forged `created` values do not matter.
- [ ] `server.py gc` (cron or timer), plus a per-world run after each snapshot `PUT`: delete
      envelopes that fall out of retention, then sweep unreferenced blobs older than a 24-hour grace
      period.
- [ ] Races: a `PUT` of an existing blob refreshes its modification time (`os.utime`); an envelope
      `PUT` naming a missing blob answers `409 backup.blob_missing`, and the client uploads it
      again and retries once.
- [ ] `GET /v2/usage` returns `{bytes, blobs, worlds, quota}`. The quota comes from configuration
      for now; exceeding it answers `507 backup.quota_exceeded`, which is shown plainly while local
      snapshots continue.
- [ ] `DELETE /v2/worlds/{w}`, confirmed in the interface.

**Exit:** GC tests pass with a frozen clock; an upload during GC loses nothing; reported usage
matches the disk.

### Out of scope here

- Sync conflicts and merging (see Behaviour).
- Buying and unlocking the subscription, e.g. mapping a store receipt to a Keycloak role.
- Key rotation; `keyId` keeps it open.
- Retention for the rotating SQLite copies.
- Pricing.

### Risks

- Restoring through documents instead of a database file: stricter validators could later reject old
  snapshots. Keep the units on the v1 document contract and keep fixtures of older snapshots in the
  tests for good.
- Forgotten passphrases create support requests, so setup has to be explicit and honest.
- Compressing before encrypting reveals each unit's size; acceptable and documented.
- The hosted web app is not end-to-end encrypted, and the browser says so.

## Subscription hygiene

- [ ] Remind before renewal; cancelling is as easy as subscribing.
- [ ] Storage limits are shown plainly and never block local writing.

## Until sync exists

- [ ] Warn when the data or backup directory lies inside OneDrive, iCloud Drive or Dropbox, where
      online-only placeholders make projects appear lost.

---

# Consideration — stronger assistant for power users (subscription)

The local model stays the default and keeps every assistant feature working. A subscription could
additionally offer a stronger hosted model for authors who run large whole-book analyses. Quiltor is
not meant to be AI-heavy, so this is a power-user option, not the centre of the product.

Conditions if it is built:

- [ ] Same tool surface and invariants as the local assistant: proposals only, no prose tools.
- [ ] Opt-in per world, with a clear notice that manuscript text leaves the device.
- [ ] The interface always shows whether the local or the hosted model is answering.
- [ ] No core feature depends on the hosted model.
- [ ] No credits or token counters in the writing flow; fair-use limits are stated plainly.
- [ ] No training on authors' text, contractually; hosting and data processing documented.
- [ ] Measure first: the retrieval and continuity benchmarks must show that the hosted model finds
      what the local one misses.

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

# Candidates from competitor research

Not prioritized. Each item answers a recurring complaint in
[`competitor pain points`](research/competitor-pain-points.md); decide per item before it moves into
a milestone.

- [ ] **Visible safety:** show last save, last backup and where the world lives; restore an earlier
      version without contacting support. (Scrivener "lost work" threads, Dabble.)
- [ ] **Safe tree operations:** regression tests that moving and sorting chapters and folders can
      never delete content; a trash with restore. (Manuskript #1392.)
- [ ] **Authorship record:** export a readable writing history from snapshots as evidence of human
      authorship; the no-prose assistant makes it credible. (Scrivener forum, August 2026; publisher
      AI disputes in 2026.)
- [ ] **Find the passage:** semantic search that returns verbatim passages with links, never
      paraphrased summaries. (Papyrus users exporting HTML to external AI, June–July 2026; see
      Retrieval v2.)
- [ ] **Simple timeline answers:** a list view that answers "which weekday / which period is this?"
      without configuring the full timeline. (Papyrus users planning in calendars and spreadsheets.)
- [ ] **Performance budget:** measure graph, Storyboard and timeline against a large fixture world
      (a complete novel with a realistic cast; size to be defined). (Campfire, Plottr, Aeon Timeline,
      World Anvil.)
- [ ] **Self-service support:** error messages that say what happened and what to do, and a
      diagnostics bundle the author can send. (Papyrus, Dabble, LivingWriter support reviews.)
- [ ] **Maintenance signals:** public changelog and release cadence visible from the app and the store
      page. (Manuskript "Abandonware?", Scrivener for Windows.)
- [ ] **No nagging:** upgrade hints never interrupt writing and can be dismissed for good.
      (bibisco #395.)

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
5. English writing tools.
6. Closed pilot.
7. Series canon / advanced temporal logic later.

Import is no longer part of this milestone; it moved forward to the high-priority P1 section.

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
