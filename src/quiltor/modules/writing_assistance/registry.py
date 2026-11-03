from __future__ import annotations

from typing import Final, TypedDict


class DataRelease(TypedDict):
    """The prebuilt dictionary a release installs: one gzip asset of the data
    release, pinned by its own digest and by the content digest of the SQLite
    file inside (``tools/writing-data/build.py pack`` writes both)."""

    version: str
    url: str
    sha256: str
    bytes: int
    content_sha256: str


# None while no data release is published (3.25.0, D-76). An invented entry
# would only lead to a 404, so the status says "not published" and install
# refuses without touching the network.
DATA: Final[DataRelease | None] = None

# The version an installed database has to carry. Without a published release it
# stays the built-in starter set's, so databases installed before keep working.
CORE_VERSION: Final = "2026.08.09"
MANIFEST_VERSION: Final = DATA["version"] if DATA is not None else CORE_VERSION

SOURCES = {
    "wiktionary": {
        "version": "dewiktionary-2026-08-01",
        "url": "https://dumps.wikimedia.org/dewiktionary/20260801/dewiktionary-20260801-pages-articles.xml.bz2",
        "checksum": "sha1:29018e4b843f122fdca03a3b210779af07114d26",
        "license": "CC BY-SA 4.0 / GFDL",
        "attribution": "Deutschsprachiges Wiktionary; maschinenlesbare Extraktion durch Wiktextract/Kaikki.org",
    },
    "openthesaurus": {
        "version": "2026-08-08",
        "url": "https://www.openthesaurus.de/export/OpenThesaurus-Textversion.zip",
        "checksum": "sha256:4fb8f5544848736fc55797a547d305ccad1d678166738473994ad0b3fa71d5a3",
        "license": "CC BY-SA 4.0",
        "attribution": "OpenThesaurus.de",
    },
}


def data_status(data: DataRelease | None = DATA) -> dict:
    """Whether a dictionary can be downloaded at all, for the status route."""
    if data is None:
        return {"available": False, "reason": "not_published", "version": None, "bytes": None}
    return {"available": True, "reason": None, "version": data["version"], "bytes": data["bytes"]}
