# Optional cloud service: capability and release gates

This is the QF-08/QF-09 acceptance boundary, not an announcement or a service offer.
It distinguishes delivered local features, the existing remote-backup protocol and
a future managed subscription. Check evidence is maintained in the
[sprint ledger](competition-findings-sprints.md).

## Current product boundary

| Capability                   | Current implementation                                                                      | Permitted public claim                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Local writing                | Local SQLite worlds, no cloud account required                                              | No subscription is needed to write locally, within the published licence terms.               |
| Save state                   | Document save acknowledgement and optimistic revisions                                      | Saved state describes the current host's successful save, not a remote backup or device sync. |
| Local safety copies          | Automatic SQLite copies and explicit restore                                                | Local backups do not depend on remote login or a cloud subscription.                          |
| Named history snapshots      | Local content-addressed history with optional upload                                        | An explicitly saved version can optionally be sent to a configured backup endpoint.           |
| Remote backup                | Authenticated immutable blobs/manifests, download and restore                               | Optional remote backup; uploading a snapshot is not continuous multi-device synchronization.  |
| Multi-device synchronization | Not implemented or offered                                                                  | Do not advertise automatic sync, conflict merging or device combinations.                     |
| Managed subscription         | No confirmed offer in this delivery                                                         | Do not publish a price, checkout, allowance or retention promise.                             |
| Encryption                   | The current snapshot manifest supports unencrypted content; HTTPS protects remote transport | Do not claim end-to-end encryption.                                                           |
| Hosted web                   | Storage/processing belongs to the configured server                                         | Do not tell a hosted-web author that their browser stores everything locally.                 |

The suggested EUR 2.99 has no confirmed billing period or commercial specification.
It is not a released price. The existing licence remains authoritative; this document
does not change licence rights or create service obligations.

## Mandatory managed-backup launch decisions

All entries below block sale of a managed service until confirmed and implemented.
Local product delivery is independent.

| Gate            | Required evidence                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Offer           | Owner-approved billing period, price, taxes/regions as applicable and exact included features.                                       |
| Storage         | Enforced allowance, visible usage, explicit full-quota handling, and capacity/cost validation for the promised retention.            |
| Retention       | Exact recoverable period and restore tests at retention boundaries; old snapshots retained independently from synchronized deletion. |
| Cancellation    | Defined grace/read/export period and cloud-copy deletion time; cancellation or payment failure cannot revoke local content access.   |
| Identity expiry | Expired/invalid remote credentials produce remote-only error and retain local work and retryable snapshots.                          |
| Outage          | Timeout/interrupted upload does not acknowledge an incomplete snapshot; local save/export/restore continues.                         |
| Privacy claims  | Only verified encryption, host region and access guarantees; distinguish local and hosted web operation.                             |
| Support matrix  | Tested runtime/release combinations and published limitations; a scaffold is not a released mobile app.                              |

The owner must decide commercial terms when launching a service. Engineering must not
invent them to turn a checklist green. This delivery adds no billing activation.

## Additional gate before calling the service synchronization

The following must be exercised against an actual sync implementation, not passed off as
remote-backup unit tests:

1. Device A deletes a chapter while device B edits it offline. Preserve both intent and
   recoverable text; no silent overwrite and no unexplained resurrection.
2. Concurrent edits retain both revisions until an explicit resolution; stale retries cannot
   overwrite the winner. Independent chapters may merge only under a tested contract.
3. Connection loss at every publish boundary, expired tokens and full quota cannot corrupt
   local state or falsely report successful transfer.
4. Show last successful transfer, pending changes and conflicts independently of local save.
5. Restore a retained snapshot after a synchronized deletion on every advertised host pair.

Gate result for the current delivery: **sync launch closed because no sync service is
offered**. This is a capability exclusion, not a claim that those five tests passed.

## Local independence regression contract

Local save, manuscript/project trash, restore and portable project transfer must not call a
remote entitlement check or require remote authorization. A separately requested upload may
fail without discarding the already created local snapshot. Test remote-disabled, unavailable,
unauthorized and quota-error boundaries where implemented; do not simulate subscription
cancellation as a complete billing integration that does not exist.
