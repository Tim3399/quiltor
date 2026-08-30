# ADR 0006: Portable-core boundary and migration gates

Status: accepted; supersedes
[`ADR 0003`](0003-portable-local-core.md)

## Context

Quiltor needs a portable deterministic seam for future iOS and Android hosts.
The current Rust core owns timeline ordering and a small FFI contract, while
Python owns the application runtime, SQLite writes and migrations.

Moving persistence operation by operation would let Python and Rust become
joint owners of the same database during a long transition. Cross-aggregate
transactions, crash recovery and migrations would then depend on two runtimes
with different lifecycles. The mobile hosts are not yet mature enough to prove
that this cost is necessary.

## Decision

Quiltor keeps a portable-core target, but applies it in gated stages:

1. Extract pure deterministic rules with shared fixtures and no persistence or
   platform dependency.
2. Expose only high-level operations through stable PyO3/UniFFI DTOs. Typing,
   pointer movement and other high-frequency UI loops do not cross FFI.
3. Build and test a real mobile bridge prototype, including lifecycle,
   cancellation, latency and memory measurements.
4. Decide through a new go/no-go ADR whether the measured benefit justifies
   transferring the complete World Storage boundary.
5. If approved, SQLite writes, migrations, connection lifecycle and transaction
   ownership move together. Python and Rust never independently implement
   canonical writes for different operations against the same database.

The existing versioned application and native-bridge contracts remain the
compatibility boundary throughout the evaluation.

## Consequences

- Mobile can still become local-first without separate Swift and Kotlin domain
  models.
- Cross-runtime fixtures validate pure rules before storage is put at risk.
- A useful portable policy core is a valid final state if benchmarks do not
  justify moving persistence.
- A complete storage cutover is larger than an operation-by-operation change,
  but it has one owner, one transaction model and an explicit rollback point.
- Provider/model runtime isolation remains a separate port and is not coupled
  to the storage decision.

## Traceability

The required phases and exit gates are defined in the
[`architecture implementation plan`](../implementation-plan.md#phase-6--validate-and-if-justified-migrate-the-portable-core).
