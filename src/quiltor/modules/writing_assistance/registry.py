from __future__ import annotations

from typing import Final, NotRequired, TypedDict


class DataRelease(TypedDict):
    """The prebuilt dictionary a release installs: one gzip asset of the data
    release, pinned by its own digest and by the content digest of the SQLite
    file inside (``tools/writing-data/build.py pack`` writes both).

    ``license`` names the data's licence for the release contract (CC BY-SA 4.0); the
    installer and the status do not read it, the footer names what the installed
    database itself records."""

    version: str
    url: str
    sha256: str
    bytes: int
    content_sha256: str
    license: str
    # Size of the unpacked database (the manifest's ``sqlite.bytes``). The space
    # check estimates it from the asset size while a release does not pin it.
    unpacked_bytes: NotRequired[int]


# None while no data release is published (3.25.0, D-76). An invented entry
# would only lead to a 404, so the status says "not published" and install
# refuses without touching the network.
DATA: Final[DataRelease | None] = None

# The version an installed database has to carry. Without a published release it
# stays the built-in starter set's, so databases installed before keep working.
CORE_VERSION: Final = "2026.08.09"
MANIFEST_VERSION: Final = DATA["version"] if DATA is not None else CORE_VERSION


def data_status(data: DataRelease | None = DATA) -> dict[str, object]:
    """Whether a dictionary can be downloaded at all, for the status route."""
    if data is None:
        return {"available": False, "reason": "not_published", "version": None, "bytes": None}
    return {"available": True, "reason": None, "version": data["version"], "bytes": data["bytes"]}
