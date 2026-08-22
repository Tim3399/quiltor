# ADR 0005: Versioned cross-runtime contracts

Status: accepted

## Decision

HTTP, native bridge, MCP, backup, persisted documents and distribution build
profiles are explicit versioned contracts. Shared fixtures are the source of
semantic compatibility across TypeScript, Python and the portable core.

## Consequences

- Transport DTOs are mapped at boundaries and are not domain models.
- Breaking contract changes require a migration or a new version.
- Contract fixtures are exercised in release preflight before version files may
  change.
