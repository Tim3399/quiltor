"""SQLite adapter for the world catalogue and ownership port."""

from __future__ import annotations

from pathlib import Path

from quiltor.application.documents import DocumentLocation
from quiltor.application.worlds import OpenedWorld, WorldPaths, WorldSummary
from quiltor.infrastructure.persistence.sqlite import config, revisions, schema, world_catalog
from quiltor.infrastructure.persistence.sqlite.connection import connection


def _summary(record: dict[str, str]) -> WorldSummary:
    return WorldSummary(
        id=record["id"],
        title=record["title"],
        backup_url=record.get("backupUrl", ""),
        updated=record.get("updated", ""),
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

    def is_valid_id(self, world_id: str) -> bool:
        return world_catalog.WORLD_ID_RE.fullmatch(world_id or "") is not None

    def list(self, owner_sub: str | None = None) -> list[WorldSummary]:
        return [
            _summary(record)
            for record in world_catalog.list_worlds(owner_sub=owner_sub, paths=self.paths)
        ]

    def create(self, title: str, backup_url: str, owner_sub: str) -> WorldSummary:
        return _summary(
            world_catalog.create_world(title, backup_url, owner_sub=owner_sub, paths=self.paths)
        )

    def open(self, world_id: str, owner_sub: str | None = None) -> OpenedWorld:
        if not self.is_valid_id(world_id):
            raise ValueError("Invalid world id.")
        owner = world_catalog.get_world_owner(world_id, paths=self.paths)
        if owner is None:
            raise FileNotFoundError("This world does not exist.")
        if owner_sub is not None and owner != owner_sub:
            raise PermissionError("This world belongs to a different account.")
        paths = self.paths_for(world_id)
        schema.initialize(paths.documents.database)
        record = next(
            (
                world
                for world in world_catalog.list_worlds(owner_sub=owner_sub, paths=self.paths)
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
