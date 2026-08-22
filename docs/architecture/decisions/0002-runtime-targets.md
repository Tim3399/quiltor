# ADR 0002: Separate host, platform, distribution and entitlement

Status: accepted

## Decision

Host, platform, distribution target, release channel and user entitlement are
independent values. Each artifact embeds a validated build profile. Runtime
detection verifies OS, architecture and sandbox facts but does not infer how an
artifact was distributed.

Publication destination is a separate axis again: `google-play`, `app-store`, an
OCI registry, or GitHub Release says where bytes live. The release channel and
rollout track say whether those bytes serve stable, beta, nightly, TestFlight,
internal Play, or production-store audiences. Runtime retains the release channel
and background-execution capability instead of reconstructing either from the
destination.

Product code asks capability questions. Store names and platform branches stay
inside bootstrap, platform adapters, commerce adapters and distribution tools.

## Consequences

- A Microsoft Store EXE and an MSIX no longer rely on the same runtime
  detection heuristic.
- Store builds and direct builds may share platform adapters.
- Store receipts cannot leak into distribution-policy code.
- Test overrides are explicit and cannot become production configuration.
