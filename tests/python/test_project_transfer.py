from __future__ import annotations

import io
import json
import os
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path
from unittest.mock import patch

from quiltor.application.document_wire_v1 import decode_document_v1
from quiltor.application.project_transfer import (
    InvalidProjectArchive,
    InvalidProjectAsset,
    ProjectArchiveLimitExceeded,
    ProjectPublicationFailed,
    UnsupportedProjectArchive,
)
from quiltor.domain.story_world.place_map_image import identify
from quiltor.infrastructure.persistence import project_archive
from quiltor.infrastructure.persistence.adapters.worlds import SQLiteWorldRepository
from quiltor.infrastructure.persistence.project_archive import SQLiteProjectTransferRepository
from quiltor.infrastructure.persistence.sqlite import (
    manuscript,
    place_map_images,
    revisions,
    story_world,
    storyboards,
    world_catalog,
)
from quiltor.infrastructure.persistence.sqlite.config import SQLitePaths

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "contracts" / "fixtures" / "application-api"
PNG = (ROOT / "distribution/assets/icons/icon.iconset/icon_128x128.png").read_bytes()


def fixture(kind: str, directory: str) -> dict:
    wire = json.loads((FIXTURES / directory / "wire.v1.json").read_text(encoding="utf-8"))
    return decode_document_v1(kind, wire).payload


def rewrite_manifest(archive: bytes, change) -> bytes:
    source = zipfile.ZipFile(io.BytesIO(archive))
    members = {info.filename: source.read(info) for info in source.infolist()}
    source.close()
    manifest = json.loads(members["manifest.json"])
    change(manifest)
    members["manifest.json"] = json.dumps(manifest, ensure_ascii=False).encode()
    target = io.BytesIO()
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as output:
        for name, content in members.items():
            output.writestr(name, content)
    return target.getvalue()


def rewrite_manifest_bytes(archive: bytes, change) -> bytes:
    with zipfile.ZipFile(io.BytesIO(archive)) as source:
        members = {info.filename: source.read(info) for info in source.infolist()}
    members["manifest.json"] = change(members["manifest.json"])
    target = io.BytesIO()
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as output:
        for name, content in members.items():
            output.writestr(name, content)
    return target.getvalue()


class ProjectTransferTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.paths = SQLitePaths.from_data_directory(Path(self.temp.name))
        self.worlds = SQLiteWorldRepository(self.paths)
        self.worlds.prepare()
        self.transfer = SQLiteProjectTransferRepository(self.paths)
        self.created = self.worlds.create(
            "Die vollständige Welt", "https://backup.example.test/world", "alice"
        )
        self.database = world_catalog.world_db_path(self.created.id, paths=self.paths)
        self.manuscript = fixture("manuscript", "manuscript")
        self.manuscript["chapters"][0]["inBook"] = False
        self.figures = fixture("figures", "story-world")
        self.figures["timeline"].append(
            {"id": "departure", "title": "Abreise", "time": -2, "position": 1}
        )
        self.image = place_map_images.store(
            PNG,
            identify(PNG),
            db_path=self.database,
        )
        self.figures["nodes"][0]["mapImageId"] = self.image.id
        self.storyboards = fixture("storyboards", "storyboards")
        story_world.save(self.figures, db_path=self.database)
        manuscript.save(self.manuscript, db_path=self.database)
        storyboards.save(self.storyboards, db_path=self.database)
        history = self.paths.data / "history" / self.created.id
        history.mkdir(parents=True)
        (history / "excluded.txt").write_text("not transferred", encoding="utf-8")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_round_trip_preview_and_two_independent_imports(self):
        title, archive = self.transfer.export(self.created.id, "alice")
        self.assertEqual(title, "Die vollständige Welt")
        preview = self.transfer.preview(archive).public()
        self.assertEqual(
            preview["counts"],
            {
                "chapters": 1,
                "bookChapters": 0,
                "setAsideChapters": 1,
                "trashedChapters": 1,
                "figures": len(self.figures["nodes"]),
                "storyboards": len(self.storyboards["boards"]),
                "images": 1,
            },
        )
        self.assertEqual(preview["includes"], {"trash": True, "history": False})
        manifest = json.loads(zipfile.ZipFile(io.BytesIO(archive)).read("manifest.json"))
        self.assertNotIn("revision", manifest["documents"]["manuscript"])
        self.assertNotIn("revision", manifest["documents"]["figures"])
        self.assertNotIn("revision", manifest["documents"]["storyboards"])
        self.assertEqual(
            {entry["id"] for entry in manifest["images"]},
            {self.image.id},
        )
        before = [world.id for world in self.worlds.list("alice")]
        with tempfile.TemporaryDirectory() as destination:
            destination_paths = SQLitePaths.from_data_directory(Path(destination))
            destination_worlds = SQLiteWorldRepository(destination_paths)
            destination_worlds.prepare()
            destination_transfer = SQLiteProjectTransferRepository(destination_paths)
            self.assertEqual(destination_worlds.list(), [])

            first = destination_transfer.import_archive(archive, "bob")
            second = destination_transfer.import_archive(archive, "bob")

            self.assertNotEqual(first.id, self.created.id)
            self.assertNotEqual(first.id, second.id)
            self.assertEqual([world.id for world in self.worlds.list("alice")], before)
            for imported in (first, second):
                opened = destination_worlds.open(imported.id, "bob")
                self.assertEqual(opened.summary.backup_url, "")
                imported_db = opened.paths.documents.database
                self.assertNotEqual(imported_db.parent, self.database.parent)
                self.assertEqual(manuscript.load(imported_db), manuscript.load(self.database))
                self.assertEqual(story_world.load(imported_db), story_world.load(self.database))
                self.assertEqual(storyboards.load(imported_db), storyboards.load(self.database))
                self.assertEqual(place_map_images.content(self.image.id, imported_db).data, PNG)
                self.assertFalse((destination_paths.data / "history" / imported.id).exists())
                self.assertEqual(
                    tuple(
                        revisions.revision(kind, db_path=imported_db)
                        for kind in ("manuscript", "figures", "storyboards")
                    ),
                    (0, 0, 0),
                )
                with self.assertRaises(PermissionError):
                    destination_worlds.open(imported.id, "alice")

    def test_preview_never_mutates_catalog(self):
        for kind, state in (
            ("manuscript", self.manuscript),
            ("figures", self.figures),
            ("storyboards", self.storyboards),
        ):
            revisions.save_with_revision(kind, state, 0, db_path=self.database)
        revisions_before = tuple(
            revisions.revision(kind, db_path=self.database)
            for kind in ("manuscript", "figures", "storyboards")
        )
        _title, archive = self.transfer.export(self.created.id, "alice")
        before = [world.id for world in self.worlds.list()]
        self.transfer.preview(archive)
        self.assertEqual([world.id for world in self.worlds.list()], before)
        self.assertEqual(
            tuple(
                revisions.revision(kind, db_path=self.database)
                for kind in ("manuscript", "figures", "storyboards")
            ),
            revisions_before,
        )

    def test_invalid_version_tampered_asset_and_path_trick_are_rejected(self):
        _title, archive = self.transfer.export(self.created.id, "alice")
        incompatible = rewrite_manifest(archive, lambda manifest: manifest.update(version=2))
        with self.assertRaises(UnsupportedProjectArchive):
            self.transfer.preview(incompatible)
        malformed_time = rewrite_manifest(
            archive, lambda manifest: manifest.update(exportedAt="not-a-timestamp")
        )
        with self.assertRaises(InvalidProjectArchive):
            self.transfer.preview(malformed_time)

        source = zipfile.ZipFile(io.BytesIO(archive))
        members = {info.filename: source.read(info) for info in source.infolist()}
        source.close()
        image_name = next(name for name in members if name.startswith("images/"))
        members[image_name] = members[image_name] + b"tampered"
        target = io.BytesIO()
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as output:
            for name, content in members.items():
                output.writestr(name, content)
        with self.assertRaises(InvalidProjectAsset):
            self.transfer.preview(target.getvalue())

        missing = io.BytesIO()
        with (
            zipfile.ZipFile(io.BytesIO(archive)) as source,
            zipfile.ZipFile(missing, "w", zipfile.ZIP_DEFLATED) as output,
        ):
            for info in source.infolist():
                if not info.filename.startswith("images/"):
                    output.writestr(info.filename, source.read(info))
        with self.assertRaises(InvalidProjectArchive):
            self.transfer.preview(missing.getvalue())

        target = io.BytesIO()
        with zipfile.ZipFile(target, "w") as output:
            output.writestr("../manifest.json", b"{}")
        with self.assertRaises(InvalidProjectArchive):
            self.transfer.preview(target.getvalue())

    def test_duplicate_unexpected_and_nonfinite_content_are_rejected(self):
        _title, archive = self.transfer.export(self.created.id, "alice")
        source = zipfile.ZipFile(io.BytesIO(archive))
        manifest = source.read("manifest.json")
        source.close()

        duplicate = io.BytesIO()
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(duplicate, "w") as output:
                output.writestr("manifest.json", manifest)
                output.writestr("manifest.json", manifest)
        with self.assertRaises(InvalidProjectArchive):
            self.transfer.preview(duplicate.getvalue())

        unexpected = io.BytesIO()
        with (
            zipfile.ZipFile(io.BytesIO(archive)) as source,
            zipfile.ZipFile(unexpected, "w", zipfile.ZIP_DEFLATED) as output,
        ):
            for info in source.infolist():
                output.writestr(info.filename, source.read(info))
            output.writestr("notes.txt", b"unexpected")
        with self.assertRaises(InvalidProjectArchive):
            self.transfer.preview(unexpected.getvalue())

        nonfinite = io.BytesIO()
        with zipfile.ZipFile(nonfinite, "w") as output:
            output.writestr("manifest.json", b'{"value":NaN}')
        with self.assertRaises(InvalidProjectArchive):
            self.transfer.preview(nonfinite.getvalue())

        overflow = rewrite_manifest_bytes(
            archive,
            lambda payload: payload.replace(b'"payload":{', b'"payload":{"overflow":1e999,', 1),
        )
        with self.assertRaisesRegex(InvalidProjectArchive, "non-finite"):
            self.transfer.preview(overflow)

        duplicate_key = io.BytesIO()
        with zipfile.ZipFile(duplicate_key, "w") as output:
            output.writestr("manifest.json", b'{"format":"a","format":"b"}')
        with self.assertRaises(InvalidProjectArchive):
            self.transfer.preview(duplicate_key.getvalue())

    def test_inclusion_flags_and_malformed_asset_metadata_are_typed_errors(self):
        _title, archive = self.transfer.export(self.created.id, "alice")
        numeric_flags = rewrite_manifest(
            archive,
            lambda manifest: manifest.update(includes={"trash": 1, "history": 0}),
        )
        with self.assertRaises(InvalidProjectArchive):
            self.transfer.preview(numeric_flags)

        malformed = (
            ("mime", {}),
            ("mime", []),
            ("mime", 7),
            ("width", "128"),
            ("width", True),
            ("height", []),
            ("byteSize", {}),
        )
        for field, value in malformed:
            with self.subTest(field=field, value=value):
                changed = rewrite_manifest(
                    archive,
                    lambda manifest, field=field, value=value: manifest["images"][0].update(
                        {field: value}
                    ),
                )
                with self.assertRaises(InvalidProjectAsset):
                    self.transfer.preview(changed)

    def test_compressed_archive_limit_is_enforced_before_zip_parsing(self):
        _title, archive = self.transfer.export(self.created.id, "alice")
        with (
            patch.object(project_archive, "MAX_ARCHIVE_BYTES", len(archive) - 1),
            self.assertRaises(ProjectArchiveLimitExceeded),
        ):
            self.transfer.preview(archive)

    def test_failed_publication_leaves_catalog_unchanged(self):
        _title, archive = self.transfer.export(self.created.id, "alice")
        before = [world.id for world in self.worlds.list()]
        with (
            patch.object(os, "replace", side_effect=OSError("injected publish failure")),
            self.assertRaises(ProjectPublicationFailed),
        ):
            self.transfer.import_archive(archive, "alice")
        self.assertEqual([world.id for world in self.worlds.list()], before)
        self.assertEqual(list(self.paths.worlds.glob(".*.importing.sqlite3*")), [])


if __name__ == "__main__":
    unittest.main()
