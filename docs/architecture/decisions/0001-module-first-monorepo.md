# ADR 0001: Module-first monorepo

Status: accepted

## Decision

Quiltor uses one repository for the shared client, executable hosts, Python
services, portable local core, contracts, independently deployed services and
distribution tooling. Product modules are the primary organising boundary;
technical layers exist inside or behind those modules only where needed.

## Consequences

- Story-world projections share one owned model instead of importing feature
  internals.
- Repository-level contracts and fixtures can be consumed by every runtime.
- `core`, `shared/lib`, `misc` and similarly generic application buckets are
  removed rather than recreated elsewhere.
- Moving code into more directories without changing dependency ownership does
  not satisfy this decision.
