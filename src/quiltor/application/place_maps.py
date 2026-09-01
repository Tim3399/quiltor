"""Storing and serving the images a place's maps are drawn on.

Map images are the one place the product keeps user-supplied binary. They live
in the world database rather than beside it, which is what puts them inside
backup, history and restore without touching the fail-closed backup manifest --
that contract admits `world.sqlite3` and `manuscripts`/`profiles` markdown and
nothing else, and a restore would leave any other directory silently stale.

The document keeps only the frames that reference an image by id; the bytes
never travel with it. A story-world document is re-sent whole on every autosave,
so carrying map bytes inside it would push every keystroke through the request
ceiling.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Protocol

from quiltor.application.errors import ApplicationNotFound, InvalidApplicationInput
from quiltor.domain.story_world.place_map_image import (
    ImageFormat,
    UnsupportedImage,
    identify,
)

#: An image uploaded but never referenced by a saved frame is swept, but only
#: once it is older than this. The client uploads before it can save the frame
#: that points at the new image, and a document written in between must not
#: collect the upload it was about to describe.
UNREFERENCED_GRACE = timedelta(hours=1)


class MapImageRejected(InvalidApplicationInput):
    """The uploaded bytes are not a map image the product will store."""

    code = "place_map.image_rejected"


class MapImageMissing(ApplicationNotFound):
    """No stored image carries that id."""

    code = "place_map.image_missing"


@dataclass(frozen=True, slots=True)
class MapImage:
    """What a caller learns about a stored image, without its bytes."""

    #: The lowercase SHA-256 of the stored bytes.
    id: str
    mime: str
    width: int
    height: int
    byte_size: int


@dataclass(frozen=True, slots=True)
class MapImageContent:
    """A stored image and the type it was proven to be when it arrived."""

    #: The lowercase SHA-256 of `data`, which is also the image's id.
    id: str
    mime: str
    data: bytes


class PlaceMapRepository(Protocol):
    def store(self, payload: bytes, image_format: ImageFormat, database: Path) -> MapImage: ...

    def content(self, image_id: str, database: Path) -> MapImageContent | None: ...

    def prune_unreferenced(
        self,
        referenced: set[str],
        database: Path,
        *,
        stored_before: datetime,
    ) -> int: ...


class PlaceMapUseCases:
    """Accepts map images, hands them back, and forgets the ones nobody kept."""

    def __init__(self, repository: PlaceMapRepository) -> None:
        self._repository = repository

    def store(self, payload: bytes, database: Path) -> MapImage:
        """Identify `payload` by its bytes and keep it, or refuse it.

        The declared content type never reaches this call. What a browser will
        do with these bytes when they are served back is decided by what they
        actually are, so that is what decides whether they may be stored.
        """

        try:
            image_format = identify(payload)
        except UnsupportedImage as error:
            raise MapImageRejected(str(error)) from error
        return self._repository.store(payload, image_format, database)

    def content(self, image_id: str, database: Path) -> MapImageContent:
        found = self._repository.content(image_id, database)
        if found is None:
            raise MapImageMissing("No map image is stored under that id.")
        return found

    def forget_unreferenced(
        self,
        referenced: set[str],
        database: Path,
        *,
        now: datetime | None = None,
    ) -> int:
        """Drop images no saved frame points at any more."""

        moment = now or datetime.now()
        return self._repository.prune_unreferenced(
            referenced,
            database,
            stored_before=moment - UNREFERENCED_GRACE,
        )


__all__ = [
    "UNREFERENCED_GRACE",
    "MapImage",
    "MapImageContent",
    "MapImageMissing",
    "MapImageRejected",
    "PlaceMapRepository",
    "PlaceMapUseCases",
]
