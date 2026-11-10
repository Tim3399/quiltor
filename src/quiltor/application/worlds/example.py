"""Opening the example world as a preview (T-214-5a, D-127).

Every request makes a fresh preview: a world that is hidden from the list and marked as
coming from the example world. The server fills it without making it real
(`promote=False`); the first change a route writes makes it a real world. A preview left
unchanged is discarded when its tab leaves or, at the latest, after a day.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from quiltor.application.documents import DocumentKind, DocumentUseCases
from quiltor.application.errors import ApplicationError
from quiltor.application.place_maps import PlaceMapUseCases
from quiltor.application.worlds.use_cases import WorldUseCases

EXAMPLE_LANGUAGES = ("de", "en")
# German leads (D-119): any other interface language gets the German world (F19).
FALLBACK_LANGUAGE = "de"
EXAMPLE_FORMAT = "quiltor.example-world.v1"
# The story world goes first: the manuscript's story-time anchors are checked against it.
_DOCUMENTS: tuple[tuple[str, DocumentKind], ...] = (
    ("storyWorld", "figures"),
    ("manuscript", "manuscript"),
    ("storyboards", "storyboards"),
)


@dataclass(frozen=True)
class ExampleWorldSource:
    """One language of the shipped example world: the document and its map image."""

    document: dict[str, Any]
    map_image: bytes


class ExampleWorldFailed(ApplicationError):
    """Answered 500 by the route: the shipped world itself is broken or could not be stored."""

    code = "world.example_failed"
    retryable = True


def example_language(requested: object) -> str:
    return requested if requested in EXAMPLE_LANGUAGES else FALLBACK_LANGUAGE


class ExampleWorldUseCases:
    def __init__(
        self,
        worlds: WorldUseCases,
        documents: DocumentUseCases,
        place_maps: PlaceMapUseCases,
        source: Callable[[str], ExampleWorldSource],
    ) -> None:
        self._worlds = worlds
        self._documents = documents
        self._place_maps = place_maps
        self._source = source

    def open(self, owner_sub: str, requested_language: object) -> dict[str, Any]:
        """Make a fresh preview for `owner_sub` and return its record (`preview: true`)."""

        self._worlds.discard_expired_previews()
        try:
            source = self._source(example_language(requested_language))
            document = source.document
            if document.get("format") != EXAMPLE_FORMAT:
                raise ValueError("unknown example world format")
            title = str(document["title"])
        except (KeyError, OSError, ValueError) as exc:
            raise ExampleWorldFailed("the example world cannot be read") from exc
        summary = self._worlds.create_preview(title, owner_sub)
        try:
            location = self._worlds.paths_for(summary.id).documents
            image = self._place_maps.store(source.map_image, location.database)
            if image.id != document["mapImage"]["id"]:
                raise ValueError("the stored map image does not match the example world")
            for field, kind in _DOCUMENTS:
                self._documents.save_with_status(
                    kind, document[field], None, location, promote=False
                )
            return self._worlds.open(summary.id, owner_sub).summary.public()
        except Exception as exc:
            # Nothing of a half-made preview stays behind, and it never showed in the list.
            self._worlds.discard_preview(summary.id, owner_sub)
            raise ExampleWorldFailed("the example world could not be opened") from exc


__all__ = [
    "EXAMPLE_LANGUAGES",
    "ExampleWorldFailed",
    "ExampleWorldSource",
    "ExampleWorldUseCases",
    "example_language",
]
