"""A cloud pull of a snapshot written by 3.25 is migrated before it is checked (T-177, F-177-1).

Device A plays 3.25: its world is schema 14 and its reference cards still carry text, which
today's validator refuses, so A pushes with that validator out of the way. Device B runs this
version and pulls.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from typing import Any, cast
from unittest.mock import patch

from quiltor.application.backups import BackupAuthorization, WorldBackupContext
from quiltor.application.document_wire_v1 import DocumentKind
from quiltor.application.synchronization import SynchronizationUseCases
from quiltor.application.worlds import WorldRepository
from quiltor.infrastructure.backup.snapshots import SnapshotStore
from quiltor.infrastructure.backup.sync_state import JsonSyncStateStore
from quiltor.infrastructure.persistence.adapters.documents import SQLiteDocumentRepository
from quiltor.infrastructure.persistence.sqlite import revisions, schema
from quiltor.infrastructure.persistence.sqlite.connection import connection
from tests.python.test_cloud_sync_application import _Remote, _Worlds

KINDS: tuple[DocumentKind, ...] = ("manuscript", "figures", "storyboards")
WORLD_ID = "0123456789abcdef0123456789abcdef"


class _MigratingWorlds(_Worlds):
    """Like the real repository: a restored world is opened, and opening migrates it."""

    def finalize_restore(self, world_id, owner_sub, previous_revisions):
        del world_id, owner_sub
        schema.initialize(self.database)
        revisions.advance_restore_revisions(previous_revisions, db_path=self.database)


class ReferenceNotePullTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.remote = _Remote()
        self.documents = SQLiteDocumentRepository()
        self.authorization = BackupAuthorization(self.remote.default_endpoint(), "token")
        self.devices: dict[str, tuple[WorldBackupContext, SynchronizationUseCases]] = {}
        for name in ("a", "b"):
            base = self.root / name
            database = base / "world.sqlite3"
            schema.initialize(database)
            context = WorldBackupContext(
                root=base / "history" / WORLD_ID,
                database=database,
                manuscripts=base / "manuscripts",
                profiles=base / "profiles",
                endpoint_url=self.remote.default_endpoint(),
                title="Novel",
            )
            worlds = _MigratingWorlds()
            worlds.database = database
            worlds.context = context
            sync = SynchronizationUseCases(
                cast(WorldRepository, worlds),
                self.documents,
                SnapshotStore(base / "history", self.remote),
                self.remote,
                JsonSyncStateStore(base / "sync"),
            )
            self.devices[name] = (context, sync)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _push_from_325(self, *, card_text: str | None) -> None:
        context, service = self.devices["a"]
        chapters = [{"id": "k1", "title": "Ankunft", "body": "Text.", "note": "Notiz."}]
        self.documents.save("manuscript", {"chapters": chapters}, None, context.database)
        with connection(context.database) as database:
            if card_text is not None:
                database.execute(
                    "INSERT INTO storyboard_nodes("
                    " id,board_id,position,kind,x,y,text,target_kind,target_id,extra_json"
                    ") VALUES('card','main-storyboard',0,'reference',0,0,?,'chapter','k1',?)",
                    (card_text, '{"text": "' + card_text + '"}'),
                )
            database.execute("UPDATE meta SET value='14' WHERE key='schema_version'")
        with patch(
            "quiltor.infrastructure.persistence.sqlite.storyboards.valid_storyboard_document",
            return_value=True,
        ):
            pushed = service.synchronize(context, "owner", self.authorization, "sync")
        self.assertEqual(pushed["state"], "synced")

    def _pull(self) -> dict[str, Any]:
        context, service = self.devices["b"]
        unlinked = service.status(context, "owner", self.authorization)
        return service.synchronize(
            context,
            "owner",
            self.authorization,
            "use-remote",
            expected_generation=unlinked["remote"]["generation"],
            expected_local_fingerprint=unlinked["localFingerprint"],
        )

    def _entry(self) -> dict[str, Any]:
        (entry,) = self.remote.snapshots_by_world[WORLD_ID].values()
        return entry

    def test_a_325_snapshot_with_card_text_is_pulled_migrated(self) -> None:
        self._push_from_325(card_text="Hafen")

        pulled = self._pull()

        self.assertEqual(pulled["state"], "synced")
        context_b, _ = self.devices["b"]
        self.assertEqual(
            self.documents.load("manuscript", context_b.database)["chapters"][0]["note"],
            "Notiz.\n\n— Aus Storyboard „Main Storyboard“ —\nHafen",
        )
        (card,) = self.documents.load("storyboards", context_b.database)["nodes"]
        self.assertNotIn("text", card)

    def test_validating_the_same_snapshot_twice_gives_one_fingerprint(self) -> None:
        self._push_from_325(card_text="Hafen")
        context_b, service_b = self.devices["b"]

        first = service_b._validated_remote_documents(context_b, self._entry(), self.authorization)
        second = service_b._validated_remote_documents(context_b, self._entry(), self.authorization)
        self._pull()

        self.assertEqual(first[0], second[0])
        self.assertEqual(first[2], second[2])
        self.assertEqual(
            first[2],
            service_b.fingerprint(
                WorldBackupContext(
                    root=context_b.root,
                    database=context_b.database,
                    manuscripts=context_b.manuscripts,
                    profiles=context_b.profiles,
                    endpoint_url=context_b.endpoint_url,
                    title=str(self._entry().get("title", "")),
                )
            ),
        )

    def test_a_325_snapshot_without_reference_cards_arrives_unchanged(self) -> None:
        self._push_from_325(card_text=None)
        context_a, _ = self.devices["a"]
        expected: dict[DocumentKind, dict[str, Any]] = {
            kind: self.documents.load(kind, context_a.database) for kind in KINDS
        }

        self.assertEqual(self._pull()["state"], "synced")

        context_b, _ = self.devices["b"]
        for kind, document in expected.items():
            self.assertEqual(self.documents.load(kind, context_b.database), document, kind)

    # F-177-9: a snapshot from a newer version names the problem, not a generic refusal.
    def test_a_snapshot_from_a_newer_schema_says_so(self) -> None:
        from quiltor.application.errors import SchemaNewerThanSupported
        from quiltor.delivery.http.errors import from_exception

        context_a, service_a = self.devices["a"]
        self.documents.save(
            "manuscript",
            {"chapters": [{"id": "k1", "title": "A", "body": "T.", "note": ""}]},
            None,
            context_a.database,
        )
        with connection(context_a.database) as database:
            database.execute(
                "UPDATE meta SET value=? WHERE key='schema_version'",
                (str(schema.SCHEMA_VERSION + 1),),
            )
        self.assertEqual(
            service_a.synchronize(context_a, "owner", self.authorization, "sync")["state"], "synced"
        )

        with self.assertRaises(SchemaNewerThanSupported) as raised:
            self._pull()

        self.assertEqual(
            raised.exception.params,
            {"found": schema.SCHEMA_VERSION + 1, "supported": schema.SCHEMA_VERSION},
        )
        failure = from_exception(raised.exception)
        self.assertEqual(failure.status, 400)
        self.assertEqual(failure.code, "storage.schema_newer")


if __name__ == "__main__":
    unittest.main()
