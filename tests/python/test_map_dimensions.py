"""A map with a picture but no frame size takes the picture's size when it is read.

The client used to invent one (2400 by 2400, or 640 by 420). The server knows the
picture's real pixel size, so documents read through `DocumentUseCases` and imported
projects carry it instead. Reading writes nothing: the size reaches the disk with the
next ordinary save. Backups, sync and export keep reading the stored bytes as they are.
"""

from __future__ import annotations

import copy
import io
import json
import sqlite3
import tempfile
import unittest
import zipfile
from contextlib import nullcontext
from pathlib import Path
from typing import Any, ClassVar, cast

from quiltor.application.backups.ports import BackupRepository
from quiltor.application.backups.use_cases import BackupUseCases
from quiltor.application.documents import DocumentUseCases
from quiltor.application.documents.types import DocumentLocation
from quiltor.application.project_transfer import InvalidProjectAsset
from quiltor.application.telemetry import UseCaseObserver
from quiltor.domain.story_world.map_dimensions import with_map_dimensions
from quiltor.domain.story_world.place_map_image import identify
from quiltor.infrastructure.persistence.adapters.documents import SQLiteDocumentRepository
from quiltor.infrastructure.persistence.adapters.place_maps import SQLitePlaceMapRepository
from quiltor.infrastructure.persistence.adapters.worlds import SQLiteWorldRepository
from quiltor.infrastructure.persistence.project_archive import SQLiteProjectTransferRepository
from quiltor.infrastructure.persistence.sqlite import (
    place_map_images,
    revisions,
    schema,
    story_world,
    world_catalog,
)
from quiltor.infrastructure.persistence.sqlite.config import SQLitePaths

ROOT = Path(__file__).resolve().parents[2]
# The test world's harbour plan: 1200 by 800 pixels.
HARBOUR = (ROOT / "tests/world/harbour-map.png").read_bytes()
UNKNOWN = "f" * 64


class _Observer:
    def observe(self, *_args, **_kwargs):
        return nullcontext()


class _Backups:
    def __init__(self) -> None:
        self.mirrored: list[dict[str, Any]] = []

    def backup_if_due(self, *_args, **_kwargs):
        return False

    def restore_local(self, *_args, **_kwargs):
        return None

    def mirror_manuscript(self, *_args, **_kwargs):
        return None

    def mirror_story_world(self, state, *_args, **_kwargs):
        self.mirrored.append(state)


def _map(node_id: str, image_id: str, **extra: Any) -> dict[str, Any]:
    return {
        "id": node_id,
        "name": node_id,
        "x": 0,
        "y": 0,
        "type": "ort",
        "mapImageId": image_id,
        "mapExpanded": True,
        **extra,
    }


def _figures(*nodes: dict[str, Any]) -> dict[str, Any]:
    return {"nodes": list(nodes), "edges": [], "timeline": []}


def _node(state: dict[str, Any], node_id: str) -> dict[str, Any]:
    return next(node for node in state["nodes"] if node["id"] == node_id)


class WithMapDimensionsTests(unittest.TestCase):
    dims: ClassVar[dict[str, tuple[int, int]]] = {"harbour": (1200, 800)}

    def test_a_map_without_size_takes_its_pictures(self):
        sized = with_map_dimensions(_figures(_map("karte", "harbour")), self.dims)
        self.assertEqual(
            (sized["nodes"][0]["mapWidth"], sized["nodes"][0]["mapHeight"]), (1200, 800)
        )

    def test_a_map_with_a_size_keeps_it(self):
        state = _figures(_map("karte", "harbour", mapWidth=1500, mapHeight=1000))
        sized = with_map_dimensions(state, self.dims)
        self.assertEqual(
            (sized["nodes"][0]["mapWidth"], sized["nodes"][0]["mapHeight"]), (1500, 1000)
        )

    def test_one_side_alone_is_replaced_by_both_of_the_pictures(self):
        for extra in ({"mapWidth": 1500}, {"mapHeight": 1000}, {"mapWidth": 1500, "mapHeight": 0}):
            with self.subTest(extra=extra):
                sized = with_map_dimensions(_figures(_map("karte", "harbour", **extra)), self.dims)
                node = sized["nodes"][0]
                self.assertEqual((node["mapWidth"], node["mapHeight"]), (1200, 800))

    def test_an_unknown_picture_leaves_the_map_alone(self):
        sized = with_map_dimensions(_figures(_map("karte", UNKNOWN)), self.dims)
        self.assertNotIn("mapWidth", sized["nodes"][0])
        self.assertNotIn("mapHeight", sized["nodes"][0])

    def test_only_places_are_sized_and_the_input_is_never_changed(self):
        person = {
            "id": "mara",
            "name": "Mara",
            "x": 0,
            "y": 0,
            "type": "person",
            "mapImageId": "harbour",
        }
        state = _figures(_map("karte", "harbour"), person)
        before = copy.deepcopy(state)
        sized = with_map_dimensions(state, self.dims)
        self.assertEqual(state, before)
        self.assertNotIn("mapWidth", _node(sized, "mara"))
        self.assertIsNot(sized, state)


class LoadingSizesMapsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.location = DocumentLocation(
            database=root / "world.sqlite3",
            backups=root / "backups",
            manuscript_mirrors=root / "manuscript",
            story_world_mirrors=root / "story-world",
        )
        self.database = self.location.database
        schema.initialize(self.database)
        self.image = place_map_images.store(HARBOUR, identify(HARBOUR), db_path=self.database)
        story_world.save(
            _figures(
                _map("masslos", self.image.id),
                _map("halb", self.image.id, mapWidth=1500),
                _map("vermessen", self.image.id, mapWidth=1500, mapHeight=1000),
                _map("fremd", UNKNOWN),
            ),
            db_path=self.database,
        )
        self.backups = _Backups()
        self.documents = DocumentUseCases(
            SQLiteDocumentRepository(),
            cast(BackupRepository, self.backups),
            cast(UseCaseObserver, _Observer()),
            SQLitePlaceMapRepository(),
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _size(self, state: dict[str, Any], node_id: str) -> tuple[Any, Any]:
        node = _node(state, node_id)
        return node.get("mapWidth"), node.get("mapHeight")

    def test_load_fills_in_the_pictures_size(self):
        state = self.documents.load("figures", self.database).state
        self.assertEqual(self._size(state, "masslos"), (1200, 800))
        self.assertEqual(self._size(state, "halb"), (1200, 800))
        self.assertEqual(self._size(state, "vermessen"), (1500, 1000))
        self.assertEqual(self._size(state, "fremd"), (None, None))

    def test_load_pair_fills_in_the_pictures_size_too(self):
        _manuscript, figures = self.documents.load_pair(self.database)
        self.assertEqual(self._size(figures, "masslos"), (1200, 800))

    def test_loading_writes_nothing(self):
        def snapshot() -> tuple[bytes, int, list[tuple[Any, ...]]]:
            with sqlite3.connect(self.database) as database:
                database.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                meta = database.execute("SELECT key,value FROM meta ORDER BY key").fetchall()
            database.close()
            return (
                self.database.read_bytes(),
                revisions.revision("figures", db_path=self.database),
                meta,
            )

        before = snapshot()
        loaded = self.documents.load("figures", self.database)
        self.documents.load_pair(self.database)
        after = snapshot()
        self.assertEqual(loaded.revision, before[1])
        self.assertEqual(after, before)
        # Stored as it was: the size reaches the disk only with the next ordinary save.
        self.assertNotIn("mapWidth", _node(story_world.load(self.database), "masslos"))

    def test_a_backup_restore_mirrors_the_stored_document_unsized(self):
        backups = BackupUseCases(
            cast(Any, None),
            SQLiteDocumentRepository(),
            cast(BackupRepository, self.backups),
            cast(Any, None),
            cast(Any, None),
            cast(Any, None),
            cast(UseCaseObserver, _Observer()),
        )
        self.assertEqual(backups.restore_local("any", self.location), {"ok": True})
        self.assertEqual(len(self.backups.mirrored), 1)
        self.assertNotIn("mapWidth", _node(self.backups.mirrored[0], "masslos"))


def _edit_figures(archive: bytes, edit: Any) -> bytes:
    """Apply `edit` to every node of the archived story world."""

    with zipfile.ZipFile(io.BytesIO(archive)) as source:
        members = {info.filename: source.read(info) for info in source.infolist()}
    manifest = json.loads(members["manifest.json"])
    for node in manifest["documents"]["figures"]["payload"]["nodes"]:
        edit(node)
    members["manifest.json"] = json.dumps(manifest, ensure_ascii=False).encode()
    target = io.BytesIO()
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as output:
        for name, content in members.items():
            output.writestr(name, content)
    return target.getvalue()


class ImportSizesMapsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.source_paths = SQLitePaths.from_data_directory(Path(self.temp.name) / "source")
        self.target_paths = SQLitePaths.from_data_directory(Path(self.temp.name) / "target")
        for paths in (self.source_paths, self.target_paths):
            SQLiteWorldRepository(paths).prepare()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _round_trip(self, figures: dict[str, Any], *, with_image: bool, edit: Any = None) -> Path:
        worlds = SQLiteWorldRepository(self.source_paths)
        created = worlds.create("Hafen", "", "alice")
        database = world_catalog.world_db_path(created.id, paths=self.source_paths)
        if with_image:
            place_map_images.store(HARBOUR, identify(HARBOUR), db_path=database)
        story_world.save(figures, db_path=database)
        _title, archive = SQLiteProjectTransferRepository(self.source_paths).export(
            created.id, "alice"
        )
        if edit is not None:
            archive = _edit_figures(archive, edit)
        imported = SQLiteProjectTransferRepository(self.target_paths).import_archive(archive, "bob")
        return world_catalog.world_db_path(imported.id, paths=self.target_paths)

    def _stored_node(self, database: Path, node_id: str) -> dict[str, Any]:
        # Straight from the table: what is on disk, not what loading would make of it.
        with sqlite3.connect(database) as connection:
            row = connection.execute(
                "SELECT extra_json FROM figures WHERE id=?", (node_id,)
            ).fetchone()
        connection.close()
        return json.loads(row[0]) if row[0] else {}

    def test_an_imported_map_without_size_is_stored_with_its_pictures(self):
        image_id = place_map_images.digest(HARBOUR)
        database = self._round_trip(_figures(_map("masslos", image_id)), with_image=True)
        stored = self._stored_node(database, "masslos")
        self.assertEqual((stored.get("mapWidth"), stored.get("mapHeight")), (1200, 800))

    def test_an_archive_naming_a_picture_it_does_not_carry_is_refused_before_any_sizing(self):
        # The import validates image references before anything is staged, so an unknown
        # picture never reaches the sizing step there. Loading covers the unknown case.
        with self.assertRaises(InvalidProjectAsset):
            self._round_trip(
                _figures({k: v for k, v in _map("fremd", UNKNOWN).items() if k != "mapImageId"}),
                with_image=False,
                edit=lambda node: node.update(mapImageId=UNKNOWN),
            )
        self.assertEqual(SQLiteWorldRepository(self.target_paths).list("bob"), [])


if __name__ == "__main__":
    unittest.main()
