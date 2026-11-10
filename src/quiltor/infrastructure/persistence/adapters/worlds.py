"""SQLite adapter for the world catalogue and ownership port."""

from __future__ import annotations

import logging
from pathlib import Path

from quiltor.application.documents import DocumentLocation
from quiltor.application.worlds import OpenedWorld, WorldPaths, WorldSummary
from quiltor.domain.manuscript import flatten_tree, structure_or_flat
from quiltor.infrastructure.persistence import mirror
from quiltor.infrastructure.persistence.sqlite import (
    config,
    revisions,
    schema,
    story_world,
    world_catalog,
)
from quiltor.infrastructure.persistence.sqlite import manuscript as manuscript_store
from quiltor.infrastructure.persistence.sqlite.connection import connection

_log = logging.getLogger(__name__)


def _refresh_mirrors(location: DocumentLocation) -> None:
    """Rewrite the Markdown mirrors from the migrated database.

    A migration can change notes (schema 15 appends card texts to their elements' notes), and
    the mirrors are otherwise only written when a document is saved. They are derived files: a
    failure here is logged and never keeps the world from opening.
    """

    try:
        state = manuscript_store.load(location.database)
        chapters = {chapter["id"]: chapter for chapter in state["chapters"]}
        structure = structure_or_flat(chapters, state.get("structure"))
        mirror.mirror_text(
            [chapters[chapter_id] for chapter_id in flatten_tree(chapters, structure)],
            manuscript_dir=location.manuscript_mirrors,
        )
        mirror.mirror_profiles(
            story_world.load(location.database), profile_dir=location.story_world_mirrors
        )
    except Exception:  # noqa: BLE001 - derived files must not block opening a migrated world
        _log.warning(
            "The Markdown mirrors could not be refreshed after a migration.", exc_info=True
        )


def _summary(record: dict[str, str]) -> WorldSummary:
    return WorldSummary(
        id=record["id"],
        title=record["title"],
        backup_url=record.get("backupUrl", ""),
        updated=record.get("updated", ""),
        deleted_at=record.get("deletedAt", ""),
        origin=record.get("origin", ""),
        preview=bool(record.get("previewCreatedAt")),
    )


class SQLiteWorldRepository:
    def __init__(self, paths: config.SQLitePaths) -> None:
        self.paths = paths

    @property
    def data_directory(self) -> Path:
        return self.paths.data

    @property
    def worlds_directory(self) -> Path:
        return self.paths.worlds

    def prepare(self) -> None:
        self.paths.data.mkdir(parents=True, exist_ok=True)
        self.paths.backups.mkdir(parents=True, exist_ok=True)
        self.paths.worlds.mkdir(parents=True, exist_ok=True)
        schema.initialize(self.paths.database)
        # Previews nobody changed or discarded: a crash, a closed laptop, a lost beacon.
        world_catalog.discard_expired_previews(paths=self.paths)

    def is_valid_id(self, world_id: str) -> bool:
        return world_catalog.WORLD_ID_RE.fullmatch(world_id or "") is not None

    def list(self, owner_sub: str | None = None) -> list[WorldSummary]:
        return [
            _summary(record)
            for record in world_catalog.list_worlds(owner_sub=owner_sub, paths=self.paths)
        ]

    def list_trash(self, owner_sub: str) -> list[WorldSummary]:
        return [
            _summary(record)
            for record in world_catalog.list_worlds(
                owner_sub=owner_sub, paths=self.paths, deleted=True
            )
        ]

    def create(self, title: str, backup_url: str, owner_sub: str) -> WorldSummary:
        return _summary(
            world_catalog.create_world(title, backup_url, owner_sub=owner_sub, paths=self.paths)
        )

    def create_preview(self, title: str, owner_sub: str) -> WorldSummary:
        return _summary(
            world_catalog.create_world(
                title, "", owner_sub=owner_sub, paths=self.paths, preview=True
            )
        )

    def discard_preview(self, world_id: str, owner_sub: str | None) -> None:
        world_catalog.discard_preview_world(world_id, owner_sub=owner_sub, paths=self.paths)

    def discard_expired_previews(self) -> list[str]:
        return world_catalog.discard_expired_previews(paths=self.paths)

    def finish_promotion(self, world_id: str) -> WorldSummary:
        return _summary(world_catalog.finish_promotion(world_id, paths=self.paths))

    def set_backup_url(self, world_id: str, backup_url: str) -> str:
        return world_catalog.set_backup_url(world_id, backup_url, paths=self.paths)

    def open(self, world_id: str, owner_sub: str | None = None) -> OpenedWorld:
        if not self.is_valid_id(world_id):
            raise ValueError("Invalid world id.")
        owner = world_catalog.get_world_owner(world_id, paths=self.paths)
        if owner is None:
            raise FileNotFoundError("This world does not exist.")
        if owner_sub is not None and owner != owner_sub:
            raise PermissionError("This world belongs to a different account.")
        paths = self.paths_for(world_id)
        if schema.initialize(paths.documents.database):
            _refresh_mirrors(paths.documents)
        record = next(
            (
                world
                # None: a preview of the example world is opened by its id too, and says so.
                for world in world_catalog.list_worlds(
                    owner_sub=owner_sub, paths=self.paths, preview=None
                )
                if world["id"] == world_id
            ),
            None,
        )
        if record is None:
            raise FileNotFoundError("This world does not exist.")
        return OpenedWorld(_summary(record), paths)

    def paths_for(self, world_id: str) -> WorldPaths:
        if not self.is_valid_id(world_id):
            raise ValueError("Invalid world id.")
        manuscripts = self.paths.data / "manuscripts" / world_id
        story_worlds = self.paths.data / "profiles" / world_id
        manuscripts.mkdir(parents=True, exist_ok=True)
        story_worlds.mkdir(parents=True, exist_ok=True)
        return WorldPaths(
            DocumentLocation(
                database=world_catalog.world_db_path(world_id, paths=self.paths),
                backups=self.paths.data / "backups" / world_id,
                manuscript_mirrors=manuscripts,
                story_world_mirrors=story_worlds,
            )
        )

    def delete(self, world_id: str, owner_sub: str) -> None:
        world_catalog.delete_world(world_id, owner_sub=owner_sub, paths=self.paths)

    def restore(self, world_id: str, owner_sub: str) -> None:
        world_catalog.restore_world(world_id, owner_sub=owner_sub, paths=self.paths)

    def purge(self, world_id: str, owner_sub: str) -> None:
        world_catalog.purge_world(world_id, owner_sub=owner_sub, paths=self.paths)

    def assign_owner(self, world_id: str, owner_sub: str) -> None:
        path = world_catalog.world_db_path(world_id, paths=self.paths)
        with connection(path) as database:
            database.execute(
                "INSERT OR REPLACE INTO meta(key,value) VALUES('owner_sub',?)",
                (owner_sub,),
            )

    def finalize_restore(
        self,
        world_id: str,
        owner_sub: str,
        previous_revisions: dict[str, int],
    ) -> None:
        path = world_catalog.world_db_path(world_id, paths=self.paths)
        schema.initialize(path)
        revisions.advance_restore_revisions(previous_revisions, db_path=path)
        self.assign_owner(world_id, owner_sub)


__all__ = ["SQLiteWorldRepository"]
