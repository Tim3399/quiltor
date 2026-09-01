"""SQLite adapter for map images."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from quiltor.application.place_maps import MapImage, MapImageContent
from quiltor.domain.story_world.place_map_image import ImageFormat
from quiltor.infrastructure.persistence.sqlite import place_map_images


class SQLitePlaceMapRepository:
    def store(self, payload: bytes, image_format: ImageFormat, database: Path) -> MapImage:
        return place_map_images.store(payload, image_format, db_path=database)

    def content(self, image_id: str, database: Path) -> MapImageContent | None:
        return place_map_images.content(image_id, db_path=database)

    def prune_unreferenced(
        self,
        referenced: set[str],
        database: Path,
        *,
        stored_before: datetime,
    ) -> int:
        return place_map_images.prune_unreferenced(referenced, stored_before, db_path=database)


__all__ = ["SQLitePlaceMapRepository"]
