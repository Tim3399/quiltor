from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from quiltor.infrastructure.persistence.assistant_progress import (
    SQLiteAssistantProgressStore,
)


class AssistantProgressStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "progress.sqlite3"
        self.now = 1_000.0
        self.store = SQLiteAssistantProgressStore(self.path, clock=lambda: self.now)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_chapter_titles_are_scoped_to_both_owner_and_world(self) -> None:
        self.store.start("alice", "world-a", "same-id", 2)
        self.store.update(
            "alice",
            "world-a",
            "same-id",
            1,
            "chapterGroupLabel",
            {"titles": "Alice's secret chapter"},
        )
        self.assertEqual(
            self.store.read("alice", "world-a", "same-id")["labelParams"]["titles"],
            "Alice's secret chapter",
        )
        self.assertIsNone(self.store.read("bob", "world-a", "same-id"))
        self.assertIsNone(self.store.read("alice", "world-b", "same-id"))

    def test_progress_survives_runtime_reconstruction(self) -> None:
        self.store.start("alice", "world-a", "progress", 3)
        self.store.update("alice", "world-a", "progress", 2, "chapterGroupLabel", {"index": 2})
        restarted = SQLiteAssistantProgressStore(self.path, clock=lambda: self.now)
        self.assertEqual(restarted.read("alice", "world-a", "progress")["done"], 2)

    def test_expired_progress_is_pruned_without_cross_scope_effects(self) -> None:
        self.store.start("alice", "world-a", "old", 1)
        self.now += 301
        self.assertIsNone(self.store.read("alice", "world-a", "old"))


if __name__ == "__main__":
    unittest.main()
