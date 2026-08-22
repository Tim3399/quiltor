# Application API

The application API is independent of its transport. HTTP and native hosts
implement the same operation names and response semantics.

`GET` and `PUT` on `/api/state` and `/api/manuscript` exchange the explicit
`quiltor.story-world` or `quiltor.manuscript` v1 wire envelope. Persistence keeps
the payload itself unchanged; the HTTP producer wraps after loading and the
consumer unwraps before validation and storage. `contract`, `version`, and
`payload` are required; an absent `revision` supports read-only and
non-concurrent transports. Explicit `null` is not absence and is rejected, as
are explicit nulls for every other non-nullable optional property.

Payload schemas require only fields already required by the current application
validators. The envelope is strict and rejects unknown routing or protocol
fields. `additionalProperties: true` remains deliberate at payload and record
levels because SQLite round-trips extensions it does not understand.
JSON Schema validates wire shape; referential rules (unique IDs, valid edge
endpoints, mention ranges, and temporal ordering) remain semantic validation.

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
