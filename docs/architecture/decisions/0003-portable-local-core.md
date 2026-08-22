# ADR 0003: Portable local core for mobile

Status: accepted

## Context

The desktop host can embed Python, run a loopback HTTP server and supervise
helper processes. iOS and Android cannot be treated as additional variants of
that host without fragile packaging and duplicated product logic.

## Decision

Canonical local persistence, migrations, validation and deterministic use cases
move incrementally into a portable Rust core. Python binds it through PyO3;
Apple and Android hosts use a stable FFI/UniFFI boundary. The React client uses
the same application contract through either HTTP or a native bridge.

Assistant inference, proofreading and OS integration remain replaceable ports.
Mobile may provide an in-process implementation, a remote implementation or no
implementation according to its capabilities.

## Consequences

- Mobile remains local-first without separate Swift and Kotlin domain models.
- The existing Python implementation is migrated behind contracts rather than
  rewritten in one unreviewable step.
- Every migrated operation must pass the same fixtures through Python, Rust and
  the client contract.
