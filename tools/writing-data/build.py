# pyright: strict
"""Build the shipped writing-assistance dictionary from pinned upstream sources.

Three steps, each its own subcommand:

- ``fetch`` downloads the dewiktionary extract and the OpenThesaurus export and
  records what it got in ``sources.lock.json``: URL, ETag, size, SHA-256.
- ``build`` checks every file against that lock and writes a schema-2 database:
  dictionary and en translations from Wiktionary, synonyms from OpenThesaurus,
  inflected forms, license metadata. Rows are inserted sorted, so the same lock
  and the same tool commit give the same ``content_sha256`` on any machine.
- ``pack`` gzips the database without a timestamp and writes the release
  manifest and ``LICENSE-DATA.txt`` next to it.

Run it through the launcher so it finds the project:
``node tools/dev/python.mjs -m ...`` does not apply to a path, so use
``py -3.12 tools/writing-data/build.py <step> ...`` with ``src`` on PYTHONPATH.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import shutil
import sqlite3
import tempfile
import urllib.error
import urllib.request
import zipfile
import zlib
from collections.abc import Callable, Iterable, Iterator, Mapping
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

from quiltor.infrastructure.persistence.writing_assistance import (
    DICTIONARY_SCHEMA,
    SCHEMA,
    initialize,
    insert,
    insert_form,
)
from quiltor.modules.writing_assistance.providers import (
    parse_openthesaurus,
    parse_wiktionary_records,
)

LOCK_VERSION = 1
MANIFEST_VERSION = 1

# Upstream locations (plan T-88, section 2). The archive copies live in the data
# release next to the database, so a lock can still be rebuilt after upstream moves on.
SOURCES: dict[str, dict[str, str]] = {
    "dewiktionary": {
        "url": "https://kaikki.org/dewiktionary/raw-wiktextract-data.jsonl.gz",
        "archive_name": "source-dewiktionary-{tag}.jsonl.gz",
    },
    "openthesaurus": {
        "url": "https://www.openthesaurus.de/export/OpenThesaurus-Textversion.zip",
        "archive_name": "source-openthesaurus-{tag}.zip",
    },
}
OPENTHESAURUS_MEMBER = "openthesaurus.txt"

LICENSE = "CC-BY-SA-4.0"
LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/"
ATTRIBUTION = (
    "Wiktionary-Autorinnen und -Autoren, de.wiktionary.org, CC BY-SA 4.0; "
    "maschinenlesbar aufbereitet durch Wiktextract/kaikki.org. "
    "OpenThesaurus.de, Daniel Naber, CC BY-SA 4.0, https://www.openthesaurus.de. "
    "Auszug, umformatiert."
)
LICENSE_TEXT = f"""Quiltor writing data
====================

This database is a derivative of the sources below and is licensed as a whole
under Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0):
{LICENSE_URL}

Sources:
- Wiktionary contributors, de.wiktionary.org, CC BY-SA 4.0, extracted with
  Wiktextract and published by kaikki.org (https://kaikki.org/dewiktionary/).
- OpenThesaurus.de, Daniel Naber, CC BY-SA 4.0 (dual-licensed with LGPL;
  CC BY-SA 4.0 chosen), https://www.openthesaurus.de

Changes: excerpt only (German lemmas, glosses, inflected forms, English
translations, synonym groups), reformatted into SQLite.

The Quiltor application only reads this file; it is a separate work and is not
covered by Quiltor's own license.
"""

# The dictionary tables in the order the canonical dump visits them, each with
# the columns that make up its content. ``entries.id`` is left out: it only
# records insertion order, which the sorted insert already fixes.
CANONICAL_TABLES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("metadata", ("key", "value")),
    (
        "entries",
        (
            "language",
            "mode",
            "query",
            "lemma",
            "part_of_speech",
            "meaning",
            "values_json",
            "source",
        ),
    ),
    ("forms", ("language", "form", "lemma")),
)

Opener = Callable[[urllib.request.Request], Any]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


# --- fetch -------------------------------------------------------------------


def _download(request: urllib.request.Request, target: Path, opener: Opener) -> dict[str, Any]:
    digest = hashlib.sha256()
    size = 0
    headers: Any = None
    partial = target.with_name(target.name + ".part")
    try:
        with opener(request) as response, partial.open("wb") as handle:
            headers = response.headers
            for chunk in iter(lambda: response.read(1024 * 1024), b""):
                digest.update(chunk)
                size += len(chunk)
                handle.write(chunk)
        partial.replace(target)
    finally:
        partial.unlink(missing_ok=True)
    return {
        "etag": headers.get("ETag") if headers else None,
        "last_modified": headers.get("Last-Modified") if headers else None,
        "bytes": size,
        "sha256": digest.hexdigest(),
    }


def fetch(
    directory: Path,
    previous: Mapping[str, Any] | None = None,
    sources: Mapping[str, Mapping[str, str]] = SOURCES,
    archive_base: str | None = None,
    opener: Opener = urllib.request.urlopen,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> dict[str, Any]:
    """Download every source into ``directory`` and return the lock.

    A source whose ETag still matches the previous lock answers 304 and keeps
    the file and lock entry it had.
    """
    directory.mkdir(parents=True, exist_ok=True)
    known = cast(dict[str, Any], (previous or {}).get("sources", {}))
    locked: dict[str, Any] = {}
    for name, source in sources.items():
        url = source["url"]
        target = directory / f"{name}{_suffix(url)}"
        request = urllib.request.Request(url)
        prior = cast(dict[str, Any] | None, known.get(name))
        if prior and prior.get("etag") and target.exists():
            request.add_header("If-None-Match", str(prior["etag"]))
        try:
            got = _download(request, target, opener)
        except urllib.error.HTTPError as error:
            if error.code != 304 or prior is None:
                raise
            locked[name] = prior
            continue
        tag = (got["etag"] or got["sha256"][:16]).strip('"').replace("/", "-")
        archive_name = source["archive_name"].format(tag=tag)
        locked[name] = {
            "file": target.name,
            "upstream_url": url,
            "archive_name": archive_name,
            "archive_url": f"{archive_base.rstrip('/')}/{archive_name}" if archive_base else None,
            **got,
            "fetched_at": now().strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
    return {"lockVersion": LOCK_VERSION, "sources": locked}


def _suffix(url: str) -> str:
    name = url.rsplit("/", 1)[-1]
    return ".jsonl.gz" if name.endswith(".jsonl.gz") else Path(name).suffix


def verify_sources(lock: Mapping[str, Any], directory: Path) -> dict[str, Path]:
    """Paths of the locked source files, each checked against its SHA-256."""
    sources = cast(dict[str, dict[str, Any]], lock["sources"])
    if set(sources) != set(SOURCES):
        raise ValueError(f"lock must name exactly {sorted(SOURCES)}")
    paths: dict[str, Path] = {}
    for name, entry in sources.items():
        path = directory / str(entry["file"])
        if not path.is_file():
            raise FileNotFoundError(f"source file missing: {path}")
        if sha256_file(path) != entry["sha256"]:
            raise ValueError(f"checksum mismatch: {name}")
        paths[name] = path
    return paths


# --- build -------------------------------------------------------------------


_STAGE = """
CREATE TABLE entries(seq INTEGER PRIMARY KEY, language TEXT, mode TEXT, query TEXT,
 lemma TEXT, part_of_speech TEXT, meaning TEXT, values_json TEXT, source TEXT);
CREATE TABLE forms(language TEXT, form TEXT, lemma TEXT);
CREATE TABLE reverse(seq INTEGER PRIMARY KEY, en TEXT, de TEXT);
"""


def _stage_rows(stage: sqlite3.Connection, rows: Iterable[Mapping[str, Any]]) -> None:
    for row in rows:
        stage.execute(
            "INSERT INTO entries(language,mode,query,lemma,part_of_speech,meaning,values_json,source)"
            " VALUES(?,?,?,?,?,?,?,?)",
            (
                row["language"],
                row["mode"],
                str(row["query"]).casefold(),
                row["lemma"],
                row["part_of_speech"],
                row["meaning"],
                json.dumps(row["values"], ensure_ascii=False),
                row["source"],
            ),
        )
        if row["mode"] == "translation" and row["language"] == "de-DE":
            for english in cast(list[str], row["values"]):
                stage.execute("INSERT INTO reverse(en,de) VALUES(?,?)", (english, row["lemma"]))


def _openthesaurus_lines(path: Path) -> Iterator[str]:
    with zipfile.ZipFile(path) as archive, archive.open(OPENTHESAURUS_MEMBER) as raw:
        yield from io.TextIOWrapper(raw, encoding="utf-8")


def _reverse_rows(stage: sqlite3.Connection) -> Iterator[dict[str, Any]]:
    """en->de rows from the de->en pairs, grouped by English word in source order."""
    current: str | None = None
    lemmas: list[str] = []
    for english, lemma in stage.execute("SELECT en, de FROM reverse ORDER BY en, seq"):
        if english != current and current is not None:
            yield _reverse_row(current, lemmas)
            lemmas = []
        current = english
        if lemma not in lemmas:
            lemmas.append(lemma)
    if current is not None:
        yield _reverse_row(current, lemmas)


def _reverse_row(english: str, lemmas: list[str]) -> dict[str, Any]:
    return {
        "language": "en-GB",
        "mode": "translation",
        "query": english,
        "lemma": english,
        "part_of_speech": "",
        "meaning": "",
        "values": lemmas,
        "source": "wiktionary",
    }


def build(lock: Mapping[str, Any], sources: Path, output: Path, version: str) -> dict[str, Any]:
    """Write the dictionary for ``lock`` to ``output`` and return its row counts."""
    paths = verify_sources(lock, sources)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent, prefix="writing-build.") as scratch:
        stage_path, final_path = Path(scratch) / "stage.sqlite3", Path(scratch) / "final.sqlite3"
        with closing(sqlite3.connect(stage_path)) as stage:
            stage.executescript(_STAGE)
            _stage_rows(stage, parse_openthesaurus(_openthesaurus_lines(paths["openthesaurus"])))
            with gzip.open(paths["dewiktionary"], "rt", encoding="utf-8") as lines:
                for lemma, entries, forms in parse_wiktionary_records(lines):
                    _stage_rows(stage, entries)
                    stage.executemany(
                        "INSERT INTO forms(language,form,lemma) VALUES('de-DE',?,?)",
                        ((form.casefold(), lemma) for form in forms),
                    )
            _stage_rows(stage, list(_reverse_rows(stage)))
            stage.commit()
            counts = _write_final(stage, final_path, version)
        output.unlink(missing_ok=True)
        with closing(sqlite3.connect(final_path)) as conn:
            conn.execute("VACUUM INTO ?", (str(output),))
    return counts


def _write_final(stage: sqlite3.Connection, path: Path, version: str) -> dict[str, Any]:
    conn = initialize(
        path,
        version,
        "full",
        {"license": LICENSE, "license_url": LICENSE_URL, "attribution": ATTRIBUTION},
    )
    with closing(conn):
        conn.execute("PRAGMA journal_mode=OFF")
        rows = stage.execute(
            "SELECT language,mode,query,lemma,part_of_speech,meaning,values_json,source FROM entries"
            " ORDER BY language, mode, query, lemma, seq"
        )
        for language, mode, query, lemma, pos, meaning, values_json, source in rows:
            insert(
                conn, language, mode, query, lemma, pos, meaning, json.loads(values_json), source
            )
        forms = stage.execute(
            "SELECT DISTINCT language, form, lemma FROM forms ORDER BY language, form, lemma"
        )
        for language, form, lemma in forms:
            insert_form(conn, language, form, lemma)
        conn.commit()
        modes = dict(
            conn.execute(
                "SELECT language || '/' || mode, COUNT(*) FROM entries GROUP BY 1 ORDER BY 1"
            ).fetchall()
        )
        (form_count,) = conn.execute("SELECT COUNT(*) FROM forms").fetchone()
    return {"entries": modes, "forms": form_count}


# --- canonical content hash ----------------------------------------------------


def canonical_lines(path: Path) -> Iterator[bytes]:
    """The database's content in a fixed text form, independent of SQLite's
    version, page layout and header bytes: the DDL constant, then each table's
    rows ordered by every column."""
    yield SCHEMA.encode("utf-8")
    with closing(sqlite3.connect(f"file:{path}?mode=ro", uri=True)) as conn:
        for table, columns in CANONICAL_TABLES:
            yield f"-- {table}\n".encode()
            listed = ",".join(columns)
            for row in conn.execute(f"SELECT {listed} FROM {table} ORDER BY {listed}"):  # noqa: S608 - fixed table names
                yield (
                    json.dumps(list(row), ensure_ascii=False, separators=(",", ":")) + "\n"
                ).encode()


def content_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    for line in canonical_lines(path):
        digest.update(line)
    return digest.hexdigest()


# --- pack --------------------------------------------------------------------


def pack(
    database: Path,
    directory: Path,
    version: str,
    lock: Mapping[str, Any],
    counts: Mapping[str, Any],
    tool_commit: str,
) -> dict[str, Any]:
    """Write ``writing-<v>.sqlite3.gz``, its manifest and LICENSE-DATA.txt."""
    directory.mkdir(parents=True, exist_ok=True)
    asset = directory / f"writing-{version}.sqlite3.gz"
    # No file name and mtime 0 in the gzip header, so equal input packs to equal bytes.
    with (
        database.open("rb") as source,
        asset.open("wb") as raw,
        gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=9, mtime=0) as packed,
    ):
        shutil.copyfileobj(source, packed)
    (directory / "LICENSE-DATA.txt").write_bytes(LICENSE_TEXT.encode("utf-8"))
    manifest: dict[str, Any] = {
        "manifestVersion": MANIFEST_VERSION,
        "dataVersion": version,
        "dictionarySchema": DICTIONARY_SCHEMA,
        "license": LICENSE,
        "licenseUrl": LICENSE_URL,
        "attribution": ATTRIBUTION,
        "asset": {
            "name": asset.name,
            "bytes": asset.stat().st_size,
            "sha256": sha256_file(asset),
        },
        "sqlite": {
            "bytes": database.stat().st_size,
            "sha256": sha256_file(database),
            "contentSha256": content_sha256(database),
            "sqliteVersion": sqlite3.sqlite_version,
            "zlibVersion": zlib.ZLIB_VERSION,
        },
        "rows": dict(counts),
        "sources": lock["sources"],
        "toolCommit": tool_commit,
    }
    (directory / f"writing-data-{version}.manifest.json").write_bytes(
        (json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    )
    return manifest


# --- command line --------------------------------------------------------------


def _read_json(path: Path) -> dict[str, Any]:
    return cast(dict[str, Any], json.loads(path.read_text(encoding="utf-8")))


def _write_json(path: Path, value: Mapping[str, Any]) -> None:
    path.write_bytes(
        (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0] if __doc__ else None)
    steps = parser.add_subparsers(dest="step", required=True)
    fetch_step = steps.add_parser("fetch", help="download the sources and write the lock")
    fetch_step.add_argument("--sources", type=Path, required=True)
    fetch_step.add_argument("--lock", type=Path, required=True)
    fetch_step.add_argument(
        "--archive-base", help="release download URL the archived sources go to"
    )
    build_step = steps.add_parser("build", help="build the database from locked sources")
    build_step.add_argument("--sources", type=Path, required=True)
    build_step.add_argument("--lock", type=Path, required=True)
    build_step.add_argument("--output", type=Path, required=True)
    build_step.add_argument("--version", required=True)
    pack_step = steps.add_parser("pack", help="compress the database and write the manifest")
    pack_step.add_argument("--database", type=Path, required=True)
    pack_step.add_argument("--lock", type=Path, required=True)
    pack_step.add_argument("--out", type=Path, required=True)
    pack_step.add_argument("--version", required=True)
    pack_step.add_argument("--tool-commit", required=True)
    args = parser.parse_args(argv)
    if args.step == "fetch":
        previous = _read_json(args.lock) if args.lock.exists() else None
        _write_json(args.lock, fetch(args.sources, previous, archive_base=args.archive_base))
    elif args.step == "build":
        counts = build(_read_json(args.lock), args.sources, args.output, args.version)
        _write_json(args.output.with_suffix(".counts.json"), counts)
        print(json.dumps(counts, sort_keys=True))
    else:
        counts = _read_json(args.database.with_suffix(".counts.json"))
        manifest = pack(
            args.database, args.out, args.version, _read_json(args.lock), counts, args.tool_commit
        )
        print(manifest["asset"]["name"], manifest["sqlite"]["contentSha256"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
