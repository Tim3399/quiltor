# Application API

The application API is independent of its transport. HTTP and native hosts
implement the same operation names and response semantics.

`GET` and `PUT` on document routes exchange the explicit `quiltor.story-world`,
`quiltor.manuscript`, or `quiltor.storyboards` v1 wire envelope. Persistence
keeps the payload itself unchanged; the HTTP producer wraps after loading and
the consumer unwraps before validation and storage. `contract`, `version`, and
`payload` are required; an absent `revision` supports read-only and
non-concurrent transports. Explicit `null` is not absence and is rejected, as
are explicit nulls for every other non-nullable optional property.

Payload schemas require only fields already required by the current application
validators. The envelope is strict and rejects unknown routing or protocol
fields. `additionalProperties: true` remains deliberate at payload and record
levels because SQLite round-trips extensions it does not understand.
JSON Schema validates wire shape; referential rules (unique IDs, valid edge
endpoints, mention ranges, and temporal ordering) remain semantic validation.

An optional manuscript chapter `storyTime` reference has a required
`startMomentId` and an optional distinct `endMomentId`. The referenced IDs belong
to the canonical story-world timeline. Absence means that the chapter is
deliberately unanchored. A single start identifies one moment; start plus end is
an inclusive chronological range whose end must be later. A one-moment chapter
omits the end instead of storing an equal pair. This metadata never controls
chapter array order, so narrative order and flashbacks remain independent from
world time.

Each operation is added here before a native implementation is introduced.
Golden examples pin document round-trips, while the registered differential
corpora are consumed by both Python and TypeScript to pin absence versus null,
safe integers, Unicode code-point lengths, aliases, booleans, and extension
fields. Structured errors never contain translated user-facing prose: clients
resolve their stable `code` and `params` in the active interface locale.

Manuscript v1 mention and mark offsets are zero-based UTF-16 code-unit offsets,
matching CodeMirror and JavaScript string indexing. Both ends of a range must be
Unicode-scalar boundaries; an offset between the surrogate halves of an astral
character is invalid. Human-readable string length limits continue to count
Unicode code points as required by JSON Schema.

Story-world alias identity is frozen as
`quiltor.story-world.alias-ascii-v1`; its committed table lives in
`story-world/alias-normalization.v1.json`. It folds only ASCII `A-Z`, treats the
listed ASCII control/punctuation ranges as collapsed separators, and preserves
every non-ASCII code point exactly. It never depends on a runtime Unicode
version. Adding non-ASCII case folding or normalization therefore requires a
new version and a migration rather than silently changing existing identities.

Canonical entity resolution semantics are frozen by
`semantics.entity-resolution` v3. The resolver returns only `resolved`,
`ambiguous`, or `not_found`; exact name/alias collisions never use context to
guess, while local context may break a conservative fuzzy tie only when it
selects exactly one candidate. Candidate ordering and reasons are deterministic.

Assistant and MCP create workflows additionally use revision-bound `ensure_*`
decisions for elements, relationships, timeline moments, presence, and aliases.
Only a server-created `not_found` decision may produce a create proposal;
`resolved` becomes reuse, update, or an idempotent no-op, and `ambiguous` requires
author choice. Serialized resolution mappings are audit receipts, not authority:
consumers cannot submit `checked` or `status` metadata to bypass resolution, and
results become non-actionable when their figures revision is stale. Manual UI
creation remains a separate author-controlled path.

Before producing its final structured reply, the local Assistant can run a
backend-controlled JSON tool loop over exactly six transport-neutral operations:
`resolve_entity`, `get_entity`, `get_relationships`, `find_timeline_events`,
`get_world_state`, and `search_manuscript`. Every operation reads copied document
snapshots, returns a revision-bound bounded envelope, and is declared read-only
and side-effect-free. A step may contain at most six calls, the loop may execute
at most four read rounds, and aggregate call/result budgets are enforced by the
backend. Invalid catalogs, calls, revisions, or results fail closed without
proposals. Apply, delete, filesystem, SQL, URL, and manuscript-mutation
operations are not part of this interface. MCP exposes the same service with a
host-only `worldId` argument while retaining its separate proposal-only tools.

The explicit Assistant manuscript-extraction workflow is selected with
`mode: "world_extraction"`. Its server-owned prompt and empty history prevent UI
text from redefining the task; `chapterIds` selects the current/selected scope,
while an empty list means the whole manuscript. Extraction always uses batch
orchestration and returns `proposalGroups`, aligned `proposalEnvelopes`, and an
`extraction` scope summary. Each envelope contains its evidence, optional entity
resolution receipt, and begins with `claimStatus: "unresolved"`. The author must
classify a statement as `objective_fact` before the current world proposal kinds
may be applied. Narrator claims, character knowledge/belief/claims, and unresolved
statements remain non-canon review outcomes until generalized epistemic state can
represent them without information loss.

The `quiltor.storyboards` document is an independent, non-canon planning
aggregate. Its flat `boards`, `nodes`, and `edges` arrays keep one revision for
all boards while preserving explicit board ownership on every canvas record.
Node kinds are limited to `note`, `reference`, `storyboard`, and `group` in v1.
Reference nodes point to existing world-object IDs, board-link nodes point to a
board in the same document, and edges may connect only nodes on their declared
board. Cycles between board links are valid because navigation uses a stack,
not a persisted parent tree. The registered default fixture pins one empty
`Main Storyboard`; this planning state never implies a Story World mutation.
Storyboard-owned board, node, edge, and note-reference record IDs use the
document's compact generated-ID limit. A reference target ID instead preserves
the complete non-empty ID accepted by its source document; it is not truncated,
trimmed, or otherwise normalized at this boundary.
