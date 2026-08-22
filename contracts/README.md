# Quiltor contracts

This directory owns formats shared by more than one runtime or independently
deployed component. [`manifest.json`](manifest.json) is the machine-readable
registry. Every registered contract declares its owner, compatibility rule,
versioned schema or reference, and the fixtures that pin its behaviour.

- `application-api/`: host-neutral application payloads and structured errors.
- `native-bridge/`: messages between the React client and native hosts.
- `mcp/`: the versioned MCP tool catalogue.
- `backup/`: content-addressed remote-backup protocol.
- `persistence/`: persisted schema and forward-migration contracts.
- `semantics/`: schemas for cross-runtime golden semantic fixtures.
- `fixtures/`: canonical examples consumed by every implementation.

Run `node tools/quality/check_contracts.mjs` after changing a contract. The
checker uses only the Node standard library and verifies the registry, canonical
schema IDs, references, versions, and every JSON fixture against its schema.
Document-wire differential corpora use the registered `differential` role and
are checked against their own corpus schema plus a same-contract base fixture.

Unknown domain fields are deliberately accepted and preserved by the story-world
and manuscript v1 schemas. This matches Quiltor's round-trip storage behaviour
and permits additive evolution. Strict transport envelopes, such as the native
bridge, require a new major contract version for an incompatible field change.

Contracts must not contain translated user-facing messages. Errors use stable
codes plus structured parameters.
