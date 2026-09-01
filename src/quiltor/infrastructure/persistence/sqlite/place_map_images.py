"""Content-addressed storage for the images a place's maps are drawn on."""

from __future__ import annotations

import hashlib
from datetime import datetime
from pathlib import Path

from quiltor.application.place_maps import MapImage, MapImageContent
from quiltor.domain.story_world.place_map_image import ImageFormat
from quiltor.infrastructure.persistence.sqlite.connection import connect, connection


def digest(payload: bytes) -> str:
    """The id an image is stored under: the lowercase SHA-256 of its bytes."""

    return hashlib.sha256(payload).hexdigest()


def store(
    payload: bytes,
    image_format: ImageFormat,
    db_path: Path | None = None,
) -> MapImage:
    """Keep `payload`, or recognise that it is already kept.

    Storing is idempotent because the id is the digest: dropping the same map
    onto two places costs one row, and a repeated upload after a failed save
    cannot leave a second copy behind.
    """

    image_id = digest(payload)
    with connection(db_path) as database:
        database.execute(
            """
            INSERT INTO place_map_images(id,mime,width,height,byte_size,created_at,data)
            VALUES(?,?,?,?,?,?,?)
            ON CONFLICT(id) DO NOTHING
            """,
            (
                image_id,
                image_format.mime,
                image_format.width,
                image_format.height,
                len(payload),
                datetime.now().isoformat(),
                payload,
            ),
        )
    return MapImage(
        id=image_id,
        mime=image_format.mime,
        width=image_format.width,
        height=image_format.height,
        byte_size=len(payload),
    )


def content(image_id: str, db_path: Path | None = None) -> MapImageContent | None:
    database = connect(db_path)
    try:
        row = database.execute(
            "SELECT mime,data FROM place_map_images WHERE id=?", (image_id,)
        ).fetchone()
    finally:
        database.close()
    if row is None:
        return None
    return MapImageContent(id=image_id, mime=row[0], data=bytes(row[1]))


def catalog(db_path: Path | None = None) -> list[MapImage]:
    """Every stored image, without its bytes."""

    database = connect(db_path)
    try:
        rows = database.execute(
            "SELECT id,mime,width,height,byte_size FROM place_map_images ORDER BY created_at,id"
        ).fetchall()
    finally:
        database.close()
    return [
        MapImage(id=row[0], mime=row[1], width=row[2], height=row[3], byte_size=row[4])
        for row in rows
    ]


def prune_unreferenced(
    referenced: set[str],
    stored_before: datetime,
    db_path: Path | None = None,
) -> int:
    """Delete images no frame points at, sparing anything stored recently.

    The date guard is not tidiness. An image is uploaded before the document
    that describes its frame can be saved, so a save arriving in between would
    otherwise collect the upload it was about to reference.
    """

    cutoff = stored_before.isoformat()
    with connection(db_path) as database:
        candidates = [
            row[0]
            for row in database.execute(
                "SELECT id FROM place_map_images WHERE created_at < ?", (cutoff,)
            ).fetchall()
        ]
        doomed = [image_id for image_id in candidates if image_id not in referenced]
        for image_id in doomed:
            database.execute("DELETE FROM place_map_images WHERE id=?", (image_id,))
    return len(doomed)


__all__ = ["catalog", "content", "digest", "prune_unreferenced", "store"]
