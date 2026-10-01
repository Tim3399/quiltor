# Manual synchronization protocol v1

The existing v2 immutable snapshot/blob contract remains unchanged. The new head is
separate mutable coordination metadata, never a replacement for retained backup history.
All requests except existing discovery metadata require the endpoint-bound authorization.
The server derives ownership from the authenticated subject.

`GET /v1/worlds/{world}/sync` returns a [head](sync-head/v1.schema.json). Empty worlds
return generation zero and a null snapshot id. Committed generations are positive safe
integers and point to an already validated immutable snapshot for that same account/world.

`PUT /v1/worlds/{world}/sync` accepts exactly `expectedGeneration` and `snapshotId`.
Every referenced blob must exist and validate before publication. The per-account critical
section serializes quota checks and head updates. A competing update returns HTTP 409,
`{"code":"sync.conflict","head":{...}}`. Replaying the already-current snapshot is
idempotent and must not increment the generation. The stored snapshot must still validate.

`GET /v1/account` returns a stable nonsecret `accountId`, `access` (`read-write` or
`read-only`), `usedBytes`, nullable `limitBytes`, and nullable UTC `deleteAfter`.
The local baseline is scoped to endpoint + remote account + project; credentials are never
stored in it. Clients must not substitute a local user id for missing remote identity.

Storage usage includes retained snapshots, blobs and synchronization metadata. Duplicate
uploads consume no additional allowance. HTTP 507 with `cloud.quota_exceeded` affects only
remote publication. HTTP 403 with `cloud.read_only` blocks uploads while allowing reads.
Expired policy access uses `cloud.account_expired`. Invalid credentials remain HTTP 401.

The app exposes world-owned `/api/sync` GET/POST and `/api/sync/preview` GET. A preview
validates the exact immutable remote head in staging. Explicit `keep-local`/`use-remote`
resolution carries the displayed generation and local semantic fingerprint. Either changing
invalidates the decision. Pulling keeps a local safety snapshot and invalidates stale editor
revisions. After applying a remote version, the UI requires a reload before editing continues.

Before applying a remote snapshot, a durable `pendingPull` record identifies the selected
head, staged semantic fingerprint and local safety snapshot. Recovery acknowledges it only
when the active content and remote head match. Baseline persistence failure after applying
content returns `reloadRequired: true` with `sync.state_not_saved`; it must not imply that
the active editor still represents the previous content. Pending publish records similarly
allow acknowledgment after a lost CAS response. State files are flushed before atomic
replacement; POSIX also fsyncs the containing directory. Python's standard library cannot
provide equivalent directory fsync on Windows, so power-loss durability of directory metadata
depends on the host filesystem there.

Network operations must not hold the app's document-save lock. Local content is captured
or applied inside short critical sections, with fingerprints rechecked after remote waits.
Synchronization is initiated explicitly; this version does not implement background polling,
automatic text merging or propagation of entire-project deletion. Chapter trash is part of
the synchronized manuscript. Local removal of a project does not purge remote backups.

Reference server operating constraints and account maintenance are documented in
[the service guide](../../services/backup-server/README.md). Commercial launch decisions
are separate from this wire contract.
