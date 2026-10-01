# Quiltor backup server

The reference remote-backup endpoint is a dependency-free Python service with an
independent container and data volume. It requires OIDC configuration and refuses
to start without authentication; see `.env.example` and the `with-backup` profile
in `docker-compose.yml`.

Run from a source checkout:

```bash
python services/backup-server/server.py --port 9000
```

## Hosted sync and account policy

The service keeps uploaded blobs and snapshots immutable. A client publishes a
validated snapshot as the current sync head with
`PUT /v1/worlds/{world}/sync`; the request contains `expectedGeneration` and
`snapshotId`. The server verifies the stored manifest and every referenced blob
before advancing the generation. A competing writer receives `409` with
`sync.conflict`; replaying the already-current snapshot succeeds without another
generation increment. `GET /v1/account` reports the authenticated account's
stable hashed `accountId`, access phase, actual stored bytes, configured byte
limit, and optional deletion date.

Operators may set `QUILTOR_BACKUP_POLICY_FILE` to an absolute path containing a
JSON document such as:

```json
{
  "accounts": {
    "oidc-subject-123": {
      "access": "read-only",
      "limitBytes": 1073741824,
      "deleteAfter": "2027-01-31T00:00:00Z"
    }
  }
}
```

The keys are OIDC `sub` values. `access` is `read-write` or `read-only`,
`limitBytes` is a nonnegative byte count or `null`, and `deleteAfter` is a UTC
ISO 8601 timestamp or `null`. Fields may be omitted to select read-write,
unlimited, and no deletion date. Invalid policy fails server startup. With no
policy file, existing behavior remains read-write with no configured quota.

This example is an operator configuration format, **not a published tariff or a
commercial promise**. The service contains no billing, checkout, or default
price and does not infer retention from a quota or access phase. Making an
account read-only preserves listing and download/export access while rejecting
all writes.

At `deleteAfter`, HTTP access fails closed. The timestamp is the earliest time
the account is eligible for deletion, not a guarantee of an exact deletion
time. Schedule the following maintenance command according to the operator's
retention process. Stop the backup-server process first; the command takes an
operating-system advisory lock on the storage root and refuses to run while a
server using that root is active:

```bash
python services/backup-server/server.py --purge-expired --dry-run
python services/backup-server/server.py --purge-expired
```

The purge reads only explicitly configured dates, validates that the selected
account tree stays under the storage root and contains no links or reparse
points, atomically moves that one account into an internal quarantine, and then
deletes it. It refuses unsafe or unexpectedly large/deep trees. Repeated HTTP
access never postpones expiry. Run the maintenance command with the same
`QUILTOR_BACKUP_ROOT` and policy file as the service. Snapshot history is never
pruned merely because a sync head changes. If deletion is interrupted after the
quarantine move, rerun the same purge command; it validates and removes retained
quarantines belonging to that explicitly expired account.

Build only this service from the repository root. The root context is required
because the image embeds the shared manifest contract and legal documents:

```bash
python distribution/tooling/container_contract.py check
docker build --file services/backup-server/Dockerfile --tag quiltor-backup .
```
