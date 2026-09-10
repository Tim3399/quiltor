"""Local version history (src/quiltor/infrastructure/backup/snapshots.py) and the upload
protocol -- in particular the behaviour the History dialog depends on."""

import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import Mock, patch

from quiltor.application.backup_manifest import BackupContractError
from quiltor.application.backups import (
    BackupAuthorization,
    BackupEndpointNotConfigured,
    BackupGatewayError,
    BackupSnapshotNotFound,
)
from quiltor.infrastructure.backup import SnapshotStore
from quiltor.infrastructure.backup.snapshots import BackupContext


class SnapshotStoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        # As in production: SQLitePaths.from_data_directory calls .resolve() before the
        # data directory reaches anywhere -- a resolved path has, by definition, no linked
        # component left. Without .resolve() the test hands the backup contract something
        # the application never hands it, and trips on macOS over /var/folders, where /var
        # is a symlink to /private/var.
        self.root = Path(self.temp.name).resolve()
        self.store = SnapshotStore(self.root / "history")

    def tearDown(self):
        self.temp.cleanup()

    def _world(self, world_id: str, endpoint: str = "") -> BackupContext:
        database = self.root / f"{world_id}.sqlite3"
        manuscripts = self.root / "manuscripts" / world_id
        profiles = self.root / "profiles" / world_id
        manuscripts.mkdir(parents=True)
        profiles.mkdir(parents=True)
        sqlite3.connect(database).close()
        return self.store.context(world_id, endpoint, database, manuscripts, profiles)

    def _write(self, ctx: BackupContext, text: str, name: str = "01 - Kapitel.md") -> None:
        (ctx.manuscripts / name).write_text(text, encoding="utf-8")

    def _write_chapter_row(
        self,
        ctx: BackupContext,
        chapter_id: str,
        title: str,
        body: str,
        position: int,
    ) -> None:
        with closing(sqlite3.connect(ctx.database)) as database, database:
            database.execute(
                "CREATE TABLE IF NOT EXISTS chapters("
                "id TEXT PRIMARY KEY, position INTEGER, title TEXT, body TEXT)"
            )
            database.execute(
                "INSERT OR REPLACE INTO chapters(id,position,title,body) VALUES(?,?,?,?)",
                (chapter_id, position, title, body),
            )

    def _write_marked_chapter_row(
        self,
        ctx: BackupContext,
        chapter_id: str,
        body: str,
        marks: object,
    ) -> None:
        with closing(sqlite3.connect(ctx.database)) as database, database:
            database.execute(
                "CREATE TABLE IF NOT EXISTS chapters("
                "id TEXT PRIMARY KEY, position INTEGER, title TEXT, body TEXT, extra_json TEXT)"
            )
            database.execute(
                "INSERT OR REPLACE INTO chapters(id,position,title,body,extra_json) "
                "VALUES(?,?,?,?,?)",
                (chapter_id, 0, "Kapitel", body, json.dumps({"marks": marks})),
            )

    # ------------------------------------------------------------ basic flow

    def test_status_reports_the_configured_endpoint(self):
        plain = self.store.status(self._world("world-a"))
        self.assertTrue(plain["ok"])
        self.assertEqual(plain["endpoint"], "")
        configured = self.store.status(self._world("world-b", "https://backup.example.com"))
        self.assertEqual(configured["endpoint"], "https://backup.example.com")

    def test_collect_releases_the_source_database(self):
        ctx = self._world("world-a")
        self.store.status(ctx)

        ctx.database.unlink()
        self.assertFalse(ctx.database.exists())

    def test_commit_creates_a_snapshot_and_history_lists_it(self):
        ctx = self._world("world-a")
        self._write(ctx, "# Kapitel\n\nErster Text.\n")
        result = self.store.commit(ctx, "Erster Stand", push=False)
        self.assertTrue(result["ok"])
        self.assertIn("Snapshot created.", result["log"])

        history = self.store.history(ctx)
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["subject"], "Erster Stand")
        self.assertEqual(history[0]["shortHash"], history[0]["hash"][:8])

    def test_committing_twice_without_edits_is_recognised_as_unchanged(self):
        """sqlite3's backup() output is byte-stable for an unchanged database,
        which is what lets content addressing recognise "nothing happened" and
        skip writing a second, identical snapshot."""
        ctx = self._world("world-a")
        self._write(ctx, "# Kapitel\n\nText.\n")
        self.store.commit(ctx, "Erster Stand", push=False)

        again = self.store.commit(ctx, "Nochmal", push=False)
        self.assertTrue(again["ok"])
        self.assertIn("Everything is already backed up.", again["log"])
        self.assertEqual(len(self.store.history(ctx)), 1)

    def test_history_is_newest_first(self):
        ctx = self._world("world-a")
        for index, text in enumerate(("eins", "zwei", "drei")):
            self._write(ctx, f"# Kapitel\n\n{text}\n")
            self.store.commit(ctx, f"Stand {index}", push=False)
        self.assertEqual(
            [entry["subject"] for entry in self.store.history(ctx)],
            ["Stand 2", "Stand 1", "Stand 0"],
        )

    # ----------------------------------------------------------------- diffs

    def test_working_diff_shows_uncommitted_edits(self):
        ctx = self._world("world-a")
        self._write(ctx, "# Kapitel\n\nAlter Text.\n")
        self.store.commit(ctx, "Alter Stand", push=False)
        self._write(ctx, "# Kapitel\n\nNeuer Text.\n")

        working = self.store.diff(ctx, "WORK")
        self.assertTrue(working["ok"])
        self.assertIn("Neuer", working["diff"])

    def test_diff_output_carries_the_headers_the_history_dialog_parses(self):
        """packages/client/src/modules/history/HistoryDialog.tsx splits segments on the
        'diff --git a/X b/Y' header, so its shape is a contract between the two
        sides, not an implementation detail. The marker is the conventional
        unified-diff one, which is also what makes an exported diff render
        properly in an editor."""
        ctx = self._world("world-a")
        self._write(ctx, "alt\n")
        self.store.commit(ctx, "eins", push=False)
        self._write(ctx, "neu\n")
        text = self.store.diff(ctx, "WORK", word_diff=False)["diff"]
        self.assertIn(
            "diff --git a/manuscripts/01 - Kapitel.md b/manuscripts/01 - Kapitel.md", text
        )
        self.assertIn("@@", text)

    def test_word_diff_uses_the_inline_markers_the_frontend_renders(self):
        ctx = self._world("world-a")
        self._write(ctx, "Der Sturm kam schnell.\n")
        self.store.commit(ctx, "eins", push=False)
        self._write(ctx, "Der Sturm kam langsam.\n")
        text = self.store.diff(ctx, "WORK", word_diff=True)["diff"]
        self.assertIn("[-schnell.-]", text)
        self.assertIn("{+langsam.+}", text)

    def test_word_diff_markers_never_span_a_line_break(self):
        """A marker straddling a newline would make the renderer swallow every
        following line into one unreadable block."""
        ctx = self._world("world-a")
        self._write(ctx, "eins\nzwei\ndrei\n")
        self.store.commit(ctx, "eins", push=False)
        self._write(ctx, "eins\nGEAENDERT\ndrei\n")
        for line in self.store.diff(ctx, "WORK", word_diff=True)["diff"].split("\n"):
            self.assertEqual(line.count("[-"), line.count("-]"))
            self.assertEqual(line.count("{+"), line.count("+}"))

    def test_diff_of_a_named_snapshot_compares_against_its_parent(self):
        ctx = self._world("world-a")
        self._write(ctx, "alt\n")
        self.store.commit(ctx, "eins", push=False)
        self._write(ctx, "neu\n")
        self.store.commit(ctx, "zwei", push=False)

        newest = self.store.history(ctx)[0]["hash"]
        text = self.store.diff(ctx, newest, word_diff=False)["diff"]
        self.assertIn("-alt", text)
        self.assertIn("+neu", text)

    def test_database_is_excluded_from_text_only_diffs_but_still_stored(self):
        ctx = self._world("world-a")
        self._write(ctx, "text\n")
        self.store.commit(ctx, "eins", push=False)
        entry = self.store.entries(ctx)[-1]
        self.assertIn("world.sqlite3", entry["files"])
        self.assertNotIn("world.sqlite3", self.store.diff(ctx, "WORK")["diff"])

    # ------------------------------------------------------------- retrieval

    def test_chapter_version_returns_the_text_at_that_snapshot(self):
        ctx = self._world("world-a")
        self._write(ctx, "# Kapitel\n\nAlter Text.\n")
        self.store.commit(ctx, "Alter Stand", push=False)
        snapshot = self.store.history(ctx)[0]["hash"]
        self._write(ctx, "# Kapitel\n\nNeuer Text.\n")
        self.store.commit(ctx, "Neuer Stand", push=False)

        old = self.store.chapter_version(ctx, snapshot, 1, "Kapitel")
        self.assertFalse(old["isNew"])
        self.assertIn("Alter Text.", old["text"])

    def test_chapter_version_reports_a_chapter_that_did_not_exist_yet(self):
        ctx = self._world("world-a")
        self._write(ctx, "text\n")
        self.store.commit(ctx, "eins", push=False)
        self.assertTrue(self.store.chapter_version(ctx, "HEAD", 9, "Neu")["isNew"])

    def test_chapter_version_normalises_windows_line_endings_before_removing_the_header(self):
        ctx = self._world("world-a")
        (ctx.manuscripts / "01 - Kapitel.md").write_bytes(
            b"# Kapitel\r\n\r\nErste Zeile.\r\nZweite Zeile.\r\n"
        )
        self.store.commit(ctx, "Windows", push=False)

        version = self.store.chapter_version(ctx, "HEAD", 1, "Kapitel")

        self.assertEqual(version["text"], "Erste Zeile.\nZweite Zeile.")

    def test_chapter_comparison_tracks_a_chapter_by_id_across_rename_and_reorder(self):
        ctx = self._world("world-a")
        self._write_chapter_row(ctx, "chapter-stable", "Alter Titel", "Alter Text.", 1)
        self.store.commit(ctx, "Alt", push=False)
        self._write_chapter_row(ctx, "chapter-stable", "Neuer Titel", "Neuer Text.", 9)
        self.store.commit(ctx, "Neu", push=False)

        newest = self.store.history(ctx)[0]["hash"]
        comparison = self.store.chapter_comparison(ctx, newest, "chapter-stable")

        self.assertEqual(
            comparison["selected"],
            {"available": True, "exists": True, "text": "Neuer Text.", "marks": []},
        )
        self.assertEqual(
            comparison["previous"],
            {"available": True, "exists": True, "text": "Alter Text.", "marks": []},
        )

    def test_chapter_comparison_keeps_historical_marks_when_only_formatting_changed(self):
        ctx = self._world("world-a")
        body = "😀Mara bleibt."
        self._write_marked_chapter_row(
            ctx,
            "chapter-stable",
            body,
            [{"from": 2, "to": 6, "kind": "italic"}],
        )
        self.store.commit(ctx, "Italic", push=False)
        self._write_marked_chapter_row(
            ctx,
            "chapter-stable",
            body,
            [{"from": 2, "to": 6, "kind": "bold"}],
        )
        self.store.commit(ctx, "Bold", push=False)

        comparison = self.store.chapter_comparison(ctx, "HEAD", "chapter-stable")

        self.assertEqual(comparison["selected"]["text"], body)
        self.assertEqual(comparison["selected"]["marks"], [{"from": 2, "to": 6, "kind": "bold"}])
        self.assertEqual(comparison["previous"]["text"], body)
        self.assertEqual(comparison["previous"]["marks"], [{"from": 2, "to": 6, "kind": "italic"}])

    def test_chapter_comparison_keeps_selected_text_when_parent_is_missing_locally(self):
        ctx = self._world("world-a")
        self._write_chapter_row(ctx, "chapter-stable", "Kapitel", "Alt.", 1)
        self.store.commit(ctx, "Alt", push=False)
        self._write_chapter_row(ctx, "chapter-stable", "Kapitel", "Neu.", 1)
        self.store.commit(ctx, "Neu", push=False)
        newest = self.store.entries(ctx)[-1]
        (ctx.root / "index.jsonl").write_text(
            json.dumps(newest, ensure_ascii=False) + "\n", encoding="utf-8"
        )

        comparison = self.store.chapter_comparison(ctx, newest["id"], "chapter-stable")

        self.assertEqual(comparison["selected"]["text"], "Neu.")
        self.assertEqual(
            comparison["previous"],
            {"available": False, "exists": False, "text": "", "marks": []},
        )

    def test_chapter_comparison_marks_a_snapshot_without_chapter_schema_unavailable(self):
        ctx = self._world("world-a")
        self._write(ctx, "# Kapitel\n\nNur Spiegel.\n")
        self.store.commit(ctx, "Altformat", push=False)

        comparison = self.store.chapter_comparison(ctx, "HEAD", "chapter-stable")

        self.assertEqual(
            comparison["selected"],
            {"available": False, "exists": False, "text": "", "marks": []},
        )

    def test_chapter_comparison_treats_legacy_chapter_rows_as_unformatted(self):
        ctx = self._world("world-a")
        self._write_chapter_row(ctx, "chapter-stable", "Kapitel", "Legacy.", 0)
        self.store.commit(ctx, "Legacy", push=False)

        record = self.store.chapter_comparison(ctx, "HEAD", "chapter-stable")["selected"]

        self.assertEqual(
            record,
            {"available": True, "exists": True, "text": "Legacy.", "marks": []},
        )

    def test_chapter_comparison_defaults_missing_persisted_marks_to_empty(self):
        ctx = self._world("world-a")
        with closing(sqlite3.connect(ctx.database)) as database, database:
            database.execute(
                "CREATE TABLE chapters("
                "id TEXT PRIMARY KEY, position INTEGER, title TEXT, body TEXT, extra_json TEXT)"
            )
            database.execute(
                "INSERT INTO chapters VALUES(?,?,?,?,?)",
                ("chapter-stable", 0, "Kapitel", "Text.", json.dumps({"future": True})),
            )
        self.store.commit(ctx, "Snapshot", push=False)

        record = self.store.chapter_comparison(ctx, "HEAD", "chapter-stable")["selected"]

        self.assertEqual(record["marks"], [])
        self.assertTrue(record["available"])

    def test_chapter_comparison_rejects_malformed_or_unsafe_historical_marks(self):
        invalid_marks = (
            "not-json",
            json.dumps({"marks": [{"from": 1, "to": 2, "kind": "underline"}]}),
            json.dumps({"marks": [{"from": 0, "to": 1, "kind": []}]}),
            "[" * 1100 + "0" + "]" * 1100,
            json.dumps({"marks": [{"from": 1, "to": 2, "kind": "bold"}]}),
            json.dumps(
                {
                    "marks": [
                        {"from": 0, "to": 3, "kind": "bold"},
                        {"from": 2, "to": 4, "kind": "bold"},
                    ]
                }
            ),
        )
        bodies = ("Text", "Text", "Text", "Text", "😀Text", "Text")
        for index, (extra_json, body) in enumerate(zip(invalid_marks, bodies)):
            with self.subTest(index=index):
                ctx = self._world(f"world-invalid-{index}")
                with closing(sqlite3.connect(ctx.database)) as database, database:
                    database.execute(
                        "CREATE TABLE chapters("
                        "id TEXT PRIMARY KEY, position INTEGER, title TEXT, body TEXT, "
                        "extra_json TEXT)"
                    )
                    database.execute(
                        "INSERT INTO chapters VALUES(?,?,?,?,?)",
                        ("chapter-stable", 0, "Kapitel", body, extra_json),
                    )
                self.store.commit(ctx, "Invalid", push=False)

                record = self.store.chapter_comparison(ctx, "HEAD", "chapter-stable")["selected"]

                self.assertEqual(
                    record,
                    {"available": False, "exists": False, "text": "", "marks": []},
                )

    def test_chapter_comparison_bounds_historical_extension_reads(self):
        ctx = self._world("world-a")
        self._write_marked_chapter_row(ctx, "chapter-stable", "Text", [])
        self.store.commit(ctx, "Snapshot", push=False)

        with patch("quiltor.infrastructure.backup.snapshots._MAX_CHAPTER_EXTRA_BYTES", 1):
            record = self.store.chapter_comparison(ctx, "HEAD", "chapter-stable")["selected"]

        self.assertEqual(
            record,
            {"available": False, "exists": False, "text": "", "marks": []},
        )

    def test_chapter_comparison_reports_a_missing_chapter_with_empty_marks(self):
        ctx = self._world("world-a")
        self._write_chapter_row(ctx, "chapter-other", "Kapitel", "Text.", 0)
        self.store.commit(ctx, "Snapshot", push=False)

        record = self.store.chapter_comparison(ctx, "HEAD", "chapter-missing")["selected"]

        self.assertEqual(
            record,
            {"available": True, "exists": False, "text": "", "marks": []},
        )

    # --------------------------------------------------------------- storage

    def test_unchanged_files_are_stored_once_across_snapshots(self):
        """Content addressing is what makes snapshotting the whole world on every
        commit affordable."""
        ctx = self._world("world-a")
        self._write(ctx, "unveraendert\n", "01 - Eins.md")
        self._write(ctx, "erste fassung\n", "02 - Zwei.md")
        self.store.commit(ctx, "eins", push=False)
        self._write(ctx, "zweite fassung\n", "02 - Zwei.md")
        self.store.commit(ctx, "zwei", push=False)

        first, second = self.store.entries(ctx)
        self.assertEqual(
            first["files"]["manuscripts/01 - Eins.md"], second["files"]["manuscripts/01 - Eins.md"]
        )
        self.assertNotEqual(
            first["files"]["manuscripts/02 - Zwei.md"], second["files"]["manuscripts/02 - Zwei.md"]
        )

    def test_entries_carry_a_format_and_encryption_marker(self):
        """Encryption is not implemented yet; the fields exist from the start so
        adding it later is a format bump rather than a migration."""
        ctx = self._world("world-a")
        self._write(ctx, "text\n")
        self.store.commit(ctx, "eins", push=False)
        entry = self.store.entries(ctx)[-1]
        self.assertEqual(entry["format"], 2)
        self.assertEqual(entry["encryption"], "none")

    def test_a_torn_final_index_line_does_not_lose_the_history_behind_it(self):
        ctx = self._world("world-a")
        self._write(ctx, "text\n")
        self.store.commit(ctx, "eins", push=False)
        with (ctx.root / "index.jsonl").open("a", encoding="utf-8") as index:
            index.write(
                '{"id": "half-written',
            )
        self.assertEqual(len(self.store.entries(ctx)), 1)

    def test_index_line_endings_do_not_count_toward_the_manifest_size_limit(self):
        ctx = self._world("world-a")
        self._write(ctx, "Text")
        self.store.commit(ctx, "Snapshot", push=False)
        payload = (ctx.root / "index.jsonl").read_bytes().rstrip(b"\r\n")
        with patch("quiltor.infrastructure.backup.snapshots.MAX_MANIFEST_BYTES", len(payload)):
            self.assertEqual(len(self.store.entries(ctx)), 1)

    def test_commits_recover_a_torn_tail_and_separate_a_complete_final_line(self):
        for tail in (b'{"id":"torn', b'{"message":"\xc3', b""):
            with self.subTest(tail=tail):
                ctx = self._world(f"world-{tail.hex() or 'complete'}")
                self._write(ctx, "First text")
                self.store.commit(ctx, "First", push=False)
                first = self.store.entries(ctx)[0]
                index = ctx.root / "index.jsonl"
                original = index.read_bytes()
                index.write_bytes(original + tail if tail else original.rstrip(b"\r\n"))

                for message in ("Second", "Third"):
                    self._write(ctx, message)
                    self.assertTrue(self.store.commit(ctx, message, push=False)["ok"])

                entries = self.store.entries(ctx)
                self.assertEqual(
                    [entry["message"] for entry in entries], ["First", "Second", "Third"]
                )
                self.assertEqual(entries[0], first)
                self.assertEqual(entries[1]["parent"], first["id"])
                self.assertEqual(entries[2]["parent"], entries[1]["id"])

    def test_restore_repairs_the_index_before_recording_the_restored_snapshot(self):
        for tail in (b'{"id":"torn', b""):
            with self.subTest(tail=tail):
                ctx = self._world(f"restore-{tail.hex() or 'complete'}")
                self._write_chapter_row(ctx, "c1", "Chapter", "Original", 0)
                self.store.commit(ctx, "First", push=False)
                first = self.store.entries(ctx)[0]
                self._write_chapter_row(ctx, "c1", "Chapter", "Later", 0)
                self.store.commit(ctx, "Second", push=False)
                second = self.store.entries(ctx)[1]
                index = ctx.root / "index.jsonl"
                original = json.dumps(first, ensure_ascii=False).encode("utf-8")
                index.write_bytes(original + b"\n" + tail if tail else original)

                self.assertTrue(self.store.restore(ctx, second)["ok"])

                self.assertEqual(self.store.entries(ctx), [first, second])

    def test_a_complete_invalid_index_entry_is_never_discarded_as_a_torn_tail(self):
        ctx = self._world("world-a")
        self._write(ctx, "First")
        self.store.commit(ctx, "First", push=False)
        index = ctx.root / "index.jsonl"
        index.write_bytes(index.read_bytes() + b'{"id":"one","id":"two"}')
        before = index.read_bytes()
        self._write(ctx, "Second")
        with self.assertRaises(BackupContractError):
            self.store.commit(ctx, "Second", push=False)
        self.assertEqual(index.read_bytes(), before)

    def test_two_worlds_never_cross_talk(self):
        ctx_a, ctx_b = self._world("world-a"), self._world("world-b")
        self._write(ctx_a, "# Kapitel\n\nWelt A.\n")
        self._write(ctx_b, "# Kapitel\n\nWelt B.\n")
        self.store.commit(ctx_a, "A", push=False)
        self.store.commit(ctx_b, "B", push=False)

        self.assertIn("Welt A.", self.store.chapter_version(ctx_a, "HEAD", 1, "Kapitel")["text"])
        self.assertIn("Welt B.", self.store.chapter_version(ctx_b, "HEAD", 1, "Kapitel")["text"])
        self.assertNotEqual(ctx_a.root, ctx_b.root)

    # ---------------------------------------------------------------- upload

    def test_upload_fails_when_there_is_no_world_or_local_snapshot(self):
        ctx = self.store.context(
            "missing-world",
            "https://backup.example.com",
            self.root / "missing.sqlite3",
            self.root / "missing-manuscripts",
            self.root / "missing-profiles",
        )
        with self.assertRaises(BackupSnapshotNotFound):
            self.store.commit(ctx, "Upload", push=True)

    def test_an_unchanged_local_snapshot_can_be_uploaded_later(self):
        gateway = Mock()
        self.store = SnapshotStore(self.root / "history", gateway)
        ctx = self._world("world-a", "https://backup.example.com")
        authorization = BackupAuthorization(ctx.endpoint_url, "synthetic-token")
        self._write(ctx, "Local text")
        self.store.commit(ctx, "Local snapshot", push=False)
        original = self.store.entries(ctx)[0]

        result = self.store.commit(ctx, "Upload", push=True, authorization=authorization)

        self.assertTrue(result["ok"])
        self.assertIn("Snapshot uploaded to the backup endpoint.", result["log"])
        gateway.push.assert_called_once()
        self.assertEqual(gateway.push.call_args.args[1], original)
        self.assertEqual(self.store.entries(ctx), [original])

    def test_a_failed_upload_is_retried_without_creating_a_duplicate_snapshot(self):
        gateway = Mock()
        self.store = SnapshotStore(self.root / "history", gateway)
        ctx = self._world("world-a", "https://backup.example.com")
        authorization = BackupAuthorization(ctx.endpoint_url, "synthetic-token")
        self._write(ctx, "Local text")
        gateway.push.side_effect = RuntimeError("Simulated network failure")
        with self.assertRaises(BackupGatewayError):
            self.store.commit(ctx, "First attempt", push=True, authorization=authorization)
        original = self.store.entries(ctx)[0]
        gateway.push.side_effect = None

        result = self.store.commit(ctx, "Retry", push=True, authorization=authorization)

        self.assertTrue(result["ok"])
        self.assertEqual(gateway.push.call_count, 2)
        self.assertEqual(gateway.push.call_args.args[1], original)
        self.assertEqual(self.store.entries(ctx), [original])

    def test_an_unchanged_upload_without_an_endpoint_still_reports_failure(self):
        ctx = self._world("world-a")
        self._write(ctx, "Local text")
        self.store.commit(ctx, "Local snapshot", push=False)
        with self.assertRaises(BackupEndpointNotConfigured):
            self.store.commit(ctx, "Upload", push=True)

    def test_push_without_a_configured_endpoint_fails_clearly(self):
        ctx = self._world("world-a")  # no endpoint URL
        self._write(ctx, "text\n")
        with self.assertRaises(BackupEndpointNotConfigured) as caught:
            self.store.commit(ctx, "eins", push=True)
        self.assertEqual(caught.exception.params["snapshotCreated"], True)
        # The snapshot itself was still written: local history must not depend on
        # a reachable endpoint.
        self.assertEqual(len(self.store.history(ctx)), 1)


if __name__ == "__main__":
    unittest.main()
