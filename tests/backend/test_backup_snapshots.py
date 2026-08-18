"""Local version history (backend/core/backup/snapshots.py) and the upload
protocol -- in particular the behaviour the History dialog depends on."""

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from backend.core.backup import SnapshotStore
from backend.core.backup.snapshots import BackupContext


class SnapshotStoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
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

    # ------------------------------------------------------------ basic flow

    def test_status_reports_the_configured_endpoint(self):
        plain = self.store.status(self._world("world-a"))
        self.assertTrue(plain["ok"])
        self.assertEqual(plain["endpoint"], "")
        configured = self.store.status(self._world("world-b", "https://backup.example.com"))
        self.assertEqual(configured["endpoint"], "https://backup.example.com")

    def test_commit_creates_a_snapshot_and_history_lists_it(self):
        ctx = self._world("world-a")
        self._write(ctx, "# Kapitel\n\nErster Text.\n")
        result = self.store.commit(ctx, "Erster Stand", push=False)
        self.assertTrue(result["ok"])
        self.assertIn("Snapshot created.", result["log"])

        history = self.store.history(ctx)
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["betreff"], "Erster Stand")
        self.assertEqual(history[0]["kurz"], history[0]["hash"][:8])

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
            [entry["betreff"] for entry in self.store.history(ctx)],
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
        """src/features/tools/HistoryDialog.tsx splits segments on the
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
        self.assertFalse(old["neu"])
        self.assertIn("Alter Text.", old["text"])

    def test_chapter_version_reports_a_chapter_that_did_not_exist_yet(self):
        ctx = self._world("world-a")
        self._write(ctx, "text\n")
        self.store.commit(ctx, "eins", push=False)
        self.assertTrue(self.store.chapter_version(ctx, "HEAD", 9, "Neu")["neu"])

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
        self.assertEqual(entry["format"], 1)
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

    def test_push_without_a_configured_endpoint_fails_clearly(self):
        ctx = self._world("world-a")  # no endpoint URL
        self._write(ctx, "text\n")
        result = self.store.commit(ctx, "eins", push=True)
        self.assertFalse(result["ok"])
        self.assertIn("No backup endpoint", result["grund"])
        # The snapshot itself was still written: local history must not depend on
        # a reachable endpoint.
        self.assertEqual(len(self.store.history(ctx)), 1)


if __name__ == "__main__":
    unittest.main()
