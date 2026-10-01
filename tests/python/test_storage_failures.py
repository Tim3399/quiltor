"""Real SQLite storage errors preserve content and produce actionable HTTP failures."""

from __future__ import annotations

import errno
import sqlite3
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

from quiltor.delivery.http.errors import from_exception
from quiltor.infrastructure.persistence.sqlite import manuscript, revisions, schema


def state(body: str) -> dict:
    return {"chapters": [{"id": "chapter", "title": "Anfang", "body": body, "note": ""}]}


class StorageFailureTests(unittest.TestCase):
    def test_real_storage_failures_keep_the_saved_revision_and_allow_retry(self):
        for failure in ("read_only", "full", "locked"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "world.sqlite3"
                schema.initialize(path)
                revisions.save_with_revision("manuscript", state("Gesicherter Text."), 0, path)
                before = manuscript.load(path)
                draft = state("Neuer ungesicherter Text. " * 100_000)
                blocker = None
                if failure == "locked":
                    blocker = sqlite3.connect(path)
                    blocker.execute("BEGIN IMMEDIATE")

                @contextmanager
                def restricted_connection(database_path, *, failure=failure):
                    uri = (
                        f"{database_path.resolve().as_uri()}?mode=ro"
                        if failure == "read_only"
                        else str(database_path)
                    )
                    connection = sqlite3.connect(uri, uri=failure == "read_only", timeout=0.01)
                    connection.row_factory = sqlite3.Row
                    try:
                        if failure == "full":
                            page_count = connection.execute("PRAGMA page_count").fetchone()[0]
                            connection.execute(f"PRAGMA max_page_count={page_count}")
                        with connection:
                            yield connection
                    finally:
                        connection.close()

                try:
                    with (
                        patch.object(revisions, "connection", restricted_connection),
                        self.assertRaises(sqlite3.OperationalError) as caught,
                    ):
                        revisions.save_with_revision("manuscript", draft, 1, path)
                finally:
                    if blocker is not None:
                        blocker.rollback()
                        blocker.close()

                error = from_exception(caught.exception)
                self.assertEqual(error.code, f"storage.{failure}")
                self.assertEqual(error.status, 503)
                self.assertTrue(error.retryable)
                self.assertFalse(error.payload()["ok"])
                self.assertNotIn(str(path), str(error.payload()))
                self.assertEqual(manuscript.load(path), before)
                self.assertEqual(revisions.revision("manuscript", db_path=path), 1)
                self.assertEqual(revisions.save_with_revision("manuscript", draft, 1, path), 2)
                self.assertEqual(
                    manuscript.load(path)["chapters"][0]["body"], draft["chapters"][0]["body"]
                )

    def test_filesystem_failures_are_not_misrepresented_as_authentication_errors(self):
        for number, code in ((errno.ENOSPC, "storage.full"), (errno.EROFS, "storage.read_only")):
            with self.subTest(number=number):
                error = from_exception(OSError(number, "private filesystem detail"))
                self.assertEqual(error.code, code)
                self.assertEqual(error.status, 503)
                self.assertNotIn("private", str(error.payload()))
        self.assertEqual(from_exception(PermissionError("different owner")).status, 403)


if __name__ == "__main__":
    unittest.main()
