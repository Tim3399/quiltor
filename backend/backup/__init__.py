"""Version history and cloud backup for a world.

Two separate concerns that Git used to cover jointly, deliberately split apart:

  - snapshots.py -- the local, append-only version history. Owns the on-disk
    format, produces the diffs the History dialog renders, and works with no
    network and no external tools.
  - remote.py    -- pushes those snapshots to a configurable HTTP endpoint.
    Optional; history works fully without one.

Nothing here shells out. The previous implementation drove the `git` binary,
which is a problem well beyond the Mac App Store sandbox: /usr/bin/git on macOS
is an Xcode Command Line Tools shim that opens an installer dialog when the
tools are absent, and plenty of Windows and Linux machines have no git at all.
Standard library only, so `python3 server.py` keeps working untouched.
"""
from backend.backup.snapshots import BackupContext, SnapshotStore

__all__ = ["BackupContext", "SnapshotStore"]
