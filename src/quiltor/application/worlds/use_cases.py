"""World catalogue and ownership use cases."""

from __future__ import annotations

from pathlib import Path

from quiltor.application.telemetry import UseCaseObserver
from quiltor.application.worlds.ports import WorldRepository
from quiltor.application.worlds.types import OpenedWorld, WorldPaths


class WorldUseCases:
    def __init__(self, worlds: WorldRepository, observer: UseCaseObserver) -> None:
        self._worlds = worlds
        self._observer = observer

    @property
    def data_directory(self) -> Path:
        return self._worlds.data_directory

    @property
    def worlds_directory(self) -> Path:
        return self._worlds.worlds_directory

    def prepare(self) -> None:
        with self._observer.observe("persistence", "prepare"):
            self._worlds.prepare()

    def is_valid_id(self, world_id: str) -> bool:
        return self._worlds.is_valid_id(world_id)

    def list(self, owner_sub: str | None = None) -> list[dict[str, str]]:
        return [world.public() for world in self._worlds.list(owner_sub)]

    def create(self, title: str, backup_url: str, owner_sub: str) -> dict[str, str]:
        with self._observer.observe("persistence", "create_world"):
            return self._worlds.create(title, backup_url, owner_sub).public()

    def open(self, world_id: str, owner_sub: str | None = None) -> OpenedWorld:
        with self._observer.observe("persistence", "open_world"):
            return self._worlds.open(world_id, owner_sub)

    def paths_for(self, world_id: str) -> WorldPaths:
        return self._worlds.paths_for(world_id)

    def delete(self, world_id: str, owner_sub: str) -> None:
        with self._observer.observe("persistence", "delete_world"):
            self._worlds.delete(world_id, owner_sub)

    def assign_owner(self, world_id: str, owner_sub: str) -> None:
        self._worlds.assign_owner(world_id, owner_sub)


__all__ = ["WorldUseCases"]
