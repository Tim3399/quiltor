from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from quiltor.application.backup_manifest import (
    BackupContractError,
    build_manifest_files,
    manifest_identifier,
    strict_json_loads,
    validate_manifest,
)
from quiltor.infrastructure.backup import snapshots
from quiltor.infrastructure.backup.snapshots import SnapshotStore


class BackupManifestSecurityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.store = SnapshotStore(self.root / "history")
        self.context = self.store.context(
            "world-a",
            "",
            self.root / "world.sqlite3",
            self.root / "manuscripts",
            self.root / "profiles",
        )
        self.context.manuscripts.mkdir()
        self.context.profiles.mkdir()
        self._database(self.context.database, "old")
        (self.context.manuscripts / "01 - Existing.md").write_text("old chapter", encoding="utf-8")

        source = self.root / "incoming.sqlite3"
        self._database(source, "new")
        self.payloads = {
            "world.sqlite3": source.read_bytes(),
            "manuscripts/01 - Restored.md": b"new chapter",
            "profiles/01 - Person.md": b"new profile",
        }

    def tearDown(self) -> None:
        self.temporary.cleanup()

    @staticmethod
    def _database(path: Path, marker: str) -> None:
        connection = sqlite3.connect(path)
        try:
            connection.execute("CREATE TABLE marker(value TEXT NOT NULL)")
            connection.execute("INSERT INTO marker VALUES (?)", (marker,))
            connection.commit()
        finally:
            connection.close()

    def _manifest(self, files: dict[str, bytes] | None = None, *, version: int = 2) -> dict:
        payloads = files or self.payloads
        descriptors = build_manifest_files(payloads.items())
        if version == 1:
            descriptors = {path: descriptor["sha256"] for path, descriptor in descriptors.items()}
        body = {
            "format": version,
            "encryption": "none",
            "created": "2026-08-21T12:34:56+00:00",
            "world": "world-a",
            "title": "World A",
            "message": "secure restore",
            "parent": "",
            "files": descriptors,
        }
        return {**body, "id": manifest_identifier(body, version)}

    @staticmethod
    def _with_path(entry: dict, old: str, new: str) -> dict:
        body = {key: value for key, value in entry.items() if key != "id"}
        body["files"] = dict(body["files"])
        body["files"][new] = body["files"].pop(old)
        return {**body, "id": manifest_identifier(body, body["format"])}

    def test_path_traversal_and_portability_tricks_are_rejected(self) -> None:
        entry = self._manifest()
        unsafe = (
            "profiles/../../../VERSION",
            "profiles/..\\..\\VERSION.md",
            "/absolute.md",
            "C:/drive.md",
            "\\\\server\\share.md",
            "profiles/%2e%2e.md",
            "profiles/fullwidth／slash.md",
            "profiles/trailing.md ",
            "profiles/CON.md",
        )
        for logical_path in unsafe:
            with self.subTest(path=logical_path):
                malicious = self._with_path(entry, "profiles/01 - Person.md", logical_path)
                with self.assertRaises(BackupContractError):
                    validate_manifest(malicious, expected_world="world-a")

    def test_case_and_unicode_collisions_fail_closed(self) -> None:
        entry = self._manifest()
        body = {key: value for key, value in entry.items() if key != "id"}
        body["files"] = dict(body["files"])
        body["files"]["profiles/01 - PERSON.md"] = body["files"]["profiles/01 - Person.md"]
        colliding = {**body, "id": manifest_identifier(body, 2)}
        with self.assertRaises(BackupContractError):
            validate_manifest(colliding)

        decomposed = self._with_path(entry, "profiles/01 - Person.md", "profiles/Cafe\u0301.md")
        with self.assertRaises(BackupContractError):
            validate_manifest(decomposed)

    def test_duplicate_json_keys_and_non_exact_schema_are_rejected(self) -> None:
        with self.assertRaises(BackupContractError):
            strict_json_loads(b'{"format":2,"format":1}', maximum_bytes=1024)
        entry = self._manifest()
        entry["unexpected"] = True
        with self.assertRaises(BackupContractError):
            validate_manifest(entry)

    def test_manifest_id_world_and_declared_size_are_verified(self) -> None:
        for mutation in ("id", "world", "size"):
            with self.subTest(mutation=mutation):
                entry = self._manifest()
                if mutation == "id":
                    entry["id"] = "0" * 64
                elif mutation == "world":
                    entry["world"] = "world-b"
                    body = {key: value for key, value in entry.items() if key != "id"}
                    entry["id"] = manifest_identifier(body, 2)
                else:
                    entry["files"]["world.sqlite3"]["size"] += 1
                    body = {key: value for key, value in entry.items() if key != "id"}
                    entry["id"] = manifest_identifier(body, 2)
                if mutation == "size":
                    validated = validate_manifest(entry, expected_world="world-a")
                    database_record = next(
                        record
                        for record in validated.files
                        if record.logical_path == "world.sqlite3"
                    )
                    from quiltor.application.backup_manifest import verify_blob

                    with self.assertRaises(BackupContractError):
                        verify_blob(database_record, self.payloads["world.sqlite3"])
                else:
                    with self.assertRaises(BackupContractError):
                        validate_manifest(entry, expected_world="world-a")

    def test_digest_mismatch_or_partial_fetch_never_mutates_world(self) -> None:
        entry = self._manifest()
        before_database = self.context.database.read_bytes()
        before_chapter = (self.context.manuscripts / "01 - Existing.md").read_bytes()
        by_digest = {
            record["sha256"]: self.payloads[path] for path, record in entry["files"].items()
        }
        bad_digest = entry["files"]["profiles/01 - Person.md"]["sha256"]

        def fetch(digest: str) -> bytes:
            return b"tampered" if digest == bad_digest else by_digest[digest]

        with self.assertRaises(BackupContractError):
            self.store.restore(self.context, entry, fetch=fetch)
        self.assertEqual(self.context.database.read_bytes(), before_database)
        self.assertEqual(
            (self.context.manuscripts / "01 - Existing.md").read_bytes(), before_chapter
        )
        self.assertFalse(self.context.root.exists())

    def test_failed_swap_rolls_back_database_and_both_mirror_trees(self) -> None:
        entry = self._manifest()
        by_digest = {
            record["sha256"]: self.payloads[path] for path, record in entry["files"].items()
        }
        before_database = self.context.database.read_bytes()
        before_chapter = (self.context.manuscripts / "01 - Existing.md").read_bytes()
        real_replace = os.replace

        def fail_during_manuscript_swap(source, target):
            if Path(target) == self.context.manuscripts and Path(source).name.startswith(
                ".quiltor-restore-stage-"
            ):
                raise OSError("simulated swap failure")
            return real_replace(source, target)

        with patch.object(snapshots.os, "replace", side_effect=fail_during_manuscript_swap):
            with self.assertRaises(BackupContractError):
                self.store.restore(self.context, entry, fetch=lambda digest: by_digest[digest])
        self.assertEqual(self.context.database.read_bytes(), before_database)
        self.assertEqual(
            (self.context.manuscripts / "01 - Existing.md").read_bytes(), before_chapter
        )
        self.assertEqual(list(self.context.profiles.iterdir()), [])

    def test_valid_v1_is_explicitly_supported(self) -> None:
        entry = self._manifest(version=1)
        validated = validate_manifest(entry, expected_world="world-a")
        self.assertEqual(validated.document["format"], 1)


if __name__ == "__main__":
    unittest.main()
