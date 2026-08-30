# ADR 0003: Portable local core for mobile

Status: superseded by
[`ADR 0006`](0006-portable-core-boundary-and-migration-gates.md)

## Context

The desktop host can embed Python, run a loopback HTTP server and supervise
helper processes. iOS and Android cannot be treated as additional variants of
that host without fragile packaging and duplicated product logic.

## Decision

This decision originally moved persistence and deterministic use cases
operation by operation into a portable Rust core. That migration mechanic is no
longer active because it can create split write ownership across Python and
Rust. ADR 0006 retains the portable-core goal while replacing the cutover plan.

Assistant inference, proofreading and OS integration remain replaceable ports.
Mobile may provide an in-process implementation, a remote implementation or no
implementation according to its capabilities.

## Consequences

- Historical only. See ADR 0006 for the current consequences and gates.
