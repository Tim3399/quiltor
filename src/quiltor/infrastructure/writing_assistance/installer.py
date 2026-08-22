from __future__ import annotations

import hashlib
import os
import gzip
import tarfile
import zipfile
from pathlib import Path

from quiltor.modules.writing_assistance.providers import (
    parse_freedict,
    parse_openthesaurus,
    parse_wiktionary,
)
from quiltor.modules.writing_assistance.registry import MANIFEST_VERSION
from quiltor.infrastructure.persistence.writing_assistance import initialize, insert

# A small immediately usable offline core. Full upstream importers live in providers/
# and write the exact same normalized schema; distributions may replace this database.
CORE = [
    (
        "de-DE",
        "dictionary",
        "Haus",
        "Haus",
        "Substantiv",
        "Gebäude, das Menschen als Wohnung dient.",
        [],
        "wiktionary",
    ),
    ("de-DE", "dictionary", "gehen", "gehen", "Verb", "Sich zu Fuß fortbewegen.", [], "wiktionary"),
    (
        "de-DE",
        "synonyms",
        "schnell",
        "schnell",
        "Adjektiv",
        "",
        ["rasch", "flink", "zügig"],
        "openthesaurus",
    ),
    (
        "de-DE",
        "synonyms",
        "schön",
        "schön",
        "Adjektiv",
        "",
        ["hübsch", "reizvoll", "ansehnlich"],
        "openthesaurus",
    ),
    (
        "de-DE",
        "translation",
        "Haus",
        "Haus",
        "Substantiv",
        "",
        ["house", "home"],
        "freedict-deu-eng",
    ),
    ("de-DE", "translation", "gehen", "gehen", "Verb", "", ["go", "walk"], "freedict-deu-eng"),
    ("en-GB", "translation", "house", "house", "noun", "", ["Haus", "Gebäude"], "freedict-eng-deu"),
    (
        "en-GB",
        "translation",
        "walk",
        "walk",
        "verb",
        "",
        ["gehen", "Spaziergang"],
        "freedict-eng-deu",
    ),
]


def validate_checksum(path: Path, checksum: str) -> bool:
    algorithm, expected = checksum.split(":", 1)
    digest = hashlib.new(algorithm)
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest() == expected


def install(path: Path) -> dict:
    temporary = path.with_suffix(".installing")
    temporary.unlink(missing_ok=True)
    conn = initialize(temporary, MANIFEST_VERSION)
    try:
        for row in CORE:
            insert(conn, *row)
        conn.commit()
    finally:
        conn.close()
    os.replace(temporary, path)
    return {"version": MANIFEST_VERSION, "entries": len(CORE)}


def install_from_sources(path: Path, sources: dict[str, Path], source_manifest: dict) -> dict:
    """Build the production DB from verified upstream archives supplied by a distributor.

    Downloads and Wiktionary extraction stay outside this module so distribution/CLI layers
    can show progress and ask permission. The supplied distributor manifest must point at
    the resulting Wiktextract JSONL gzip. No archive is trusted before its digest matches.
    """
    required = {"wiktionary", "openthesaurus", "freedict-deu-eng", "freedict-eng-deu"}
    if set(sources) != required or not all(
        source_manifest.get(name, {}).get("checksum") for name in required
    ):
        raise ValueError("incomplete language data manifest")
    for name, source in sources.items():
        if not validate_checksum(source, source_manifest[name]["checksum"]):
            raise ValueError(f"checksum mismatch: {name}")
    temporary = path.with_suffix(".installing")
    temporary.unlink(missing_ok=True)
    conn = initialize(temporary, MANIFEST_VERSION)
    count = 0
    try:
        with zipfile.ZipFile(sources["openthesaurus"]) as archive:
            with archive.open("openthesaurus.txt") as lines:
                for item in parse_openthesaurus(lines):
                    insert(
                        conn,
                        item["language"],
                        item["mode"],
                        item["query"],
                        item["lemma"],
                        item["part_of_speech"],
                        item["meaning"],
                        item["values"],
                        item["source"],
                    )
                    count += 1
        with gzip.open(sources["wiktionary"], "rt", encoding="utf-8") as lines:
            for item in parse_wiktionary(lines):
                insert(
                    conn,
                    item["language"],
                    item["mode"],
                    item["query"],
                    item["lemma"],
                    item["part_of_speech"],
                    item["meaning"],
                    item["values"],
                    item["source"],
                )
                count += 1
        for name, source_language, target_language in (
            ("freedict-deu-eng", "de-DE", "en-GB"),
            ("freedict-eng-deu", "en-GB", "de-DE"),
        ):
            with tarfile.open(sources[name], "r:bz2") as archive:
                member = next(
                    (item for item in archive.getmembers() if item.name.endswith(".tei")), None
                )
                if member is None:
                    raise ValueError(f"TEI dictionary missing: {name}")
                extracted = archive.extractfile(member)
                if extracted is None:
                    raise ValueError(f"TEI dictionary unreadable: {name}")
                for item in parse_freedict(extracted, source_language, target_language):
                    insert(
                        conn,
                        item["language"],
                        item["mode"],
                        item["query"],
                        item["lemma"],
                        item["part_of_speech"],
                        item["meaning"],
                        item["values"],
                        name,
                    )
                    count += 1
        conn.commit()
    except Exception:
        conn.close()
        temporary.unlink(missing_ok=True)
        raise
    conn.close()
    os.replace(temporary, path)
    return {"version": MANIFEST_VERSION, "entries": count}


class CoreWritingAssistanceInstaller:
    def __init__(self, path: Path) -> None:
        self.path = path

    def install(self) -> dict:
        return install(self.path)
