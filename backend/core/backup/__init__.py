"""Version history and cloud backup for a world -- two separate concerns:

  - snapshots.py -- the local, append-only version history. Owns the on-disk
    format, produces the diffs the History dialog renders, and works with no
    network and no external tools.
  - remote.py    -- pushes those snapshots to a configurable HTTP endpoint.
    Optional; history works fully without one.

Nothing here shells out, and nothing may start doing so: the Mac App Store
sandbox forbids launching anything outside the app bundle, and a writing tool
should not depend on what a reader happens to have installed. Standard library
only.
"""

from backend.core.backup.snapshots import BackupContext, SnapshotStore

__all__ = ["BackupContext", "SnapshotStore"]
