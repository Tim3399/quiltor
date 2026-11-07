"""Characterises the remote restore and the delegating backup use cases (T-19 P8).

Written before `backups/use_cases.py` and its ports were typed strictly. The restore picks
the snapshot to bring back, so its choice and its two not-found failures are pinned here.
"""

from __future__ import annotations

import unittest
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

from quiltor.application.backups.errors import BackupSnapshotNotFound
from quiltor.application.backups.use_cases import BackupUseCases
from quiltor.application.documents.types import DocumentLocation

LOCATION = DocumentLocation(Path("world.sqlite3"), Path("backups"), Path("m"), Path("p"))
# Stand-ins: the ports are mocks, so the use cases only pass these values through.
TOKEN: Any = "token"
CONTEXT: Any = "context"
SNAPSHOTS = [
    {"id": "aaa111", "title": "Erster Stand", "created": "2026-01-01T00:00:00Z"},
    {"id": "bbb222", "title": "Zweiter Stand", "created": "2026-01-02T00:00:00Z"},
    {"id": "aaa333", "created": "2026-01-03T00:00:00Z"},
]


class Ports:
    def __init__(self, *, exists: bool = True, opened: bool = True) -> None:
        self.worlds = MagicMock()
        self.documents = MagicMock()
        self.local = MagicMock()
        self.history = MagicMock()
        self.remote = MagicMock()
        self.login = MagicMock()
        observer = MagicMock()
        observer.observe.side_effect = lambda *_: nullcontext()
        self.documents.exists.return_value = exists
        self.documents.revision_checkpoint.return_value = {"manuscript": 3}
        summary = SimpleNamespace(title="Hafen", backup_url="https://backup.test")
        if opened:
            self.worlds.open.return_value = SimpleNamespace(
                summary=summary, paths=SimpleNamespace(documents=LOCATION)
            )
        else:
            self.worlds.open.side_effect = FileNotFoundError
        self.worlds.paths_for.return_value = SimpleNamespace(documents=LOCATION)
        self.history.context.return_value = "context"
        self.history.restore.return_value = {"restored": 2}
        self.remote.snapshots.return_value = [dict(snapshot) for snapshot in SNAPSHOTS]
        self.use_cases = BackupUseCases(
            self.worlds, self.documents, self.local, self.history, self.remote, self.login, observer
        )

    def restore(self, snapshot_id: str) -> dict[str, Any]:
        return self.use_cases.restore_remote("w", "owner", snapshot_id, "https://e", TOKEN)


class RemoteRestoreTests(unittest.TestCase):
    def test_no_snapshot_at_all_is_not_found(self) -> None:
        ports = Ports()
        ports.remote.snapshots.return_value = []
        with self.assertRaises(BackupSnapshotNotFound) as caught:
            ports.restore("")
        self.assertEqual(caught.exception.params, {"operation": "restore"})
        ports.history.restore.assert_not_called()

    def test_an_unknown_snapshot_is_not_found(self) -> None:
        ports = Ports()
        with self.assertRaises(BackupSnapshotNotFound) as caught:
            ports.restore("ccc")
        self.assertEqual(caught.exception.params, {"operation": "restore"})
        ports.worlds.finalize_restore.assert_not_called()

    def test_an_empty_id_restores_the_newest(self) -> None:
        ports = Ports()
        result = ports.restore("")
        self.assertEqual(ports.history.restore.call_args.args[1]["id"], "aaa333")
        self.assertEqual(
            result, {"ok": True, "restored": 2, "title": "", "created": "2026-01-03T00:00:00Z"}
        )

    def test_a_prefix_restores_the_newest_match(self) -> None:
        ports = Ports()
        self.assertEqual(ports.restore("aaa")["created"], "2026-01-03T00:00:00Z")
        self.assertEqual(ports.restore("bbb222")["title"], "Zweiter Stand")
        self.assertEqual(ports.restore("aaa111")["title"], "Erster Stand")

    def test_an_existing_database_is_committed_before_the_restore(self) -> None:
        ports = Ports()
        ports.restore("")
        ports.history.commit.assert_called_once_with(
            "context", "Before restore", push=False, authorization=None, kind="before-restore"
        )
        ports.worlds.finalize_restore.assert_called_once_with("w", "owner", {"manuscript": 3})

    def test_a_missing_database_and_an_unopened_world(self) -> None:
        ports = Ports(exists=False, opened=False)
        ports.restore("")
        ports.history.commit.assert_not_called()
        ports.worlds.paths_for.assert_called_once_with("w")
        self.assertEqual(ports.history.context.call_args.kwargs, {"title": ""})

    def test_the_fetch_goes_to_the_remote_with_the_same_authorization(self) -> None:
        ports = Ports()
        ports.restore("")
        fetch = ports.history.restore.call_args.kwargs["fetch"]
        ports.remote.fetch_blob.return_value = b"blob"
        self.assertEqual(fetch("d" * 64), b"blob")
        ports.remote.fetch_blob.assert_called_once_with("context", "d" * 64, "token")


class DelegationTests(unittest.TestCase):
    def test_simple_calls_reach_their_port(self) -> None:
        ports = Ports()
        use_cases = ports.use_cases
        ports.history.status.return_value = {"state": "clean"}
        self.assertEqual(use_cases.status(CONTEXT), {"state": "clean"})
        ports.remote.worlds.return_value = [{"id": "w"}]
        self.assertEqual(use_cases.list_remote_worlds("https://e", TOKEN), [{"id": "w"}])
        self.assertEqual(use_cases.endpoint_for_world("w", "owner"), "https://backup.test")
        ports.worlds.open.return_value.summary.backup_url = ""
        ports.remote.default_endpoint.return_value = "https://default.test"
        self.assertEqual(use_cases.endpoint_for_world("w", "owner"), "https://default.test")
        ports.login.status.return_value = {"signedIn": False}
        self.assertEqual(use_cases.login_status("https://e"), {"signedIn": False})
        ports.login.begin.return_value = "https://login"
        self.assertEqual(use_cases.begin_login("https://e", "https://back"), "https://login")
        use_cases.end_login("https://e")
        ports.login.sign_out.assert_called_once_with("https://e")
        use_cases.complete_login("code", "state", "https://back")
        ports.login.complete.assert_called_once_with("code", "state", "https://back")
        ports.login.access_token.return_value = "token"
        self.assertEqual(use_cases.access_token("https://e"), "token")
        ports.local.list_local.return_value = [{"created": "gestern"}]
        self.assertEqual(use_cases.list_local(Path("backups")), [{"created": "gestern"}])
        ports.local.list_local.assert_called_with(Path("backups"))


if __name__ == "__main__":
    unittest.main()
