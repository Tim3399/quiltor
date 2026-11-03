from __future__ import annotations

import contextlib
import gzip
import hashlib
import http.client
import os
import shutil
import sqlite3
import tempfile
import threading
import urllib.request
from collections.abc import Callable
from contextlib import closing
from pathlib import Path
from typing import Any

from quiltor.infrastructure.persistence.writing_assistance import (
    content_sha256,
    initialize,
    insert,
)
from quiltor.modules.writing_assistance.errors import (
    ChecksumMismatch,
    DataNotPublished,
    DownloadFailed,
    InstallInProgress,
    InsufficientSpace,
)
from quiltor.modules.writing_assistance.registry import CORE_VERSION, DATA, DataRelease

# A small offline starter set: test fixture and the fallback without network. The
# full dictionary is built by tools/writing-data/build.py and installed from the
# data release by install_release_asset.
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
        "wiktionary",
    ),
    ("de-DE", "translation", "gehen", "gehen", "Verb", "", ["go", "walk"], "wiktionary"),
    ("en-GB", "translation", "house", "house", "noun", "", ["Haus", "Gebäude"], "wiktionary"),
    (
        "en-GB",
        "translation",
        "walk",
        "walk",
        "verb",
        "",
        ["gehen", "Spaziergang"],
        "wiktionary",
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
    conn = initialize(temporary, CORE_VERSION, "core")
    try:
        for row in CORE:
            insert(conn, *row)
        conn.commit()
    finally:
        conn.close()
    os.replace(temporary, path)
    return {"version": CORE_VERSION, "entries": len(CORE)}


# One install at a time per process. Taken without blocking: a second request
# gets 409 install_in_progress instead of queueing behind a long download.
_INSTALL_LOCK = threading.Lock()
_CHUNK = 1024 * 1024
DOWNLOAD_TIMEOUT = 60.0

Opener = Callable[..., Any]

# The database unpacks to about 2.6 times its gzip (60-100 MB packed, 150-260 MB
# unpacked in the T-88 plan); 3 leaves room. Used while the registry pins no size.
UNPACK_FACTOR_ESTIMATE = 3


def required_space(data: DataRelease, current: Path) -> int:
    """Peak disk use of an install: the gzip, the unpacked new database, and the
    old one, which stays until the atomic replace."""
    unpacked = data.get("unpacked_bytes") or data["bytes"] * UNPACK_FACTOR_ESTIMATE
    try:
        old = current.stat().st_size
    except OSError:
        old = 0
    return data["bytes"] + unpacked + old


def _require_space(data: DataRelease, path: Path) -> None:
    needed = required_space(data, path)
    free = shutil.disk_usage(path.parent).free
    if free < needed:
        raise InsufficientSpace(params={"needed": needed, "free": free})


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _own_file(directory: Path, suffix: str) -> Path:
    handle, name = tempfile.mkstemp(dir=directory, prefix="writing.", suffix=suffix)
    os.close(handle)
    return Path(name)


def _download(url: str, target: Path, expected: int, opener: Opener, timeout: float) -> None:
    """Stream ``url`` into ``target``. A body longer than the pinned size (plus
    1 %) is cut off, a shorter one counts as an interrupted download."""
    limit = expected + expected // 100 + 1
    size = 0
    try:
        with opener(url, timeout=timeout) as response, target.open("wb") as handle:
            for chunk in iter(lambda: response.read(_CHUNK), b""):
                size += len(chunk)
                if size > limit:
                    raise DownloadFailed("download larger than the pinned size")
                handle.write(chunk)
    except (OSError, http.client.HTTPException) as exc:
        # URLError, HTTPError and timeouts are OSError; a connection closed
        # mid-body is IncompleteRead, an HTTPException.
        raise DownloadFailed() from exc
    if size != expected:
        raise DownloadFailed("download size differs from the pinned size")


def _unpack(asset: Path, target: Path) -> None:
    try:
        with gzip.open(asset, "rb") as packed, target.open("wb") as handle:
            shutil.copyfileobj(packed, handle, _CHUNK)
    except (OSError, EOFError) as exc:
        # The digest matched, so a broken gzip is the pinned asset itself.
        raise ChecksumMismatch("data asset is not a readable gzip") from exc


def _verify_database(path: Path, data: DataRelease) -> int:
    try:
        with closing(sqlite3.connect(f"file:{path}?mode=ro", uri=True)) as conn:
            (check,) = conn.execute("PRAGMA quick_check").fetchone()
            row = conn.execute("SELECT value FROM metadata WHERE key='version'").fetchone()
            (entries,) = conn.execute("SELECT COUNT(*) FROM entries").fetchone()
        content = content_sha256(path)
    except sqlite3.Error as exc:
        raise ChecksumMismatch("data asset is not a dictionary database") from exc
    if check != "ok" or row is None or row[0] != data["version"]:
        raise ChecksumMismatch("data asset holds a different dictionary")
    if content != data["content_sha256"]:
        raise ChecksumMismatch("dictionary content differs from the pinned content")
    return int(entries)


def install_release_asset(
    path: Path,
    data: DataRelease | None = DATA,
    *,
    opener: Opener = urllib.request.urlopen,
    timeout: float = DOWNLOAD_TIMEOUT,
) -> dict:
    """Download the pinned dictionary asset, verify it and replace ``path``.

    Nothing is replaced unless both the asset digest and the content digest of
    the database inside match the registry. Without a published release this
    fails before any network access.
    """
    if data is None:
        raise DataNotPublished()
    if not _INSTALL_LOCK.acquire(blocking=False):
        raise InstallInProgress()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        _require_space(data, path)
        own: list[Path] = []
        try:
            download = _own_file(path.parent, ".download")
            own.append(download)
            _download(data["url"], download, data["bytes"], opener, timeout)
            if _sha256(download) != data["sha256"]:
                raise ChecksumMismatch()
            installing = _own_file(path.parent, ".installing")
            own.append(installing)
            _unpack(download, installing)
            entries = _verify_database(installing, data)
            os.replace(installing, path)
        finally:
            for item in own:
                with contextlib.suppress(OSError):
                    item.unlink(missing_ok=True)
    finally:
        _INSTALL_LOCK.release()
    return {"version": data["version"], "entries": entries}


class CoreWritingAssistanceInstaller:
    """Installs the built-in starter set; tests and offline fallback only."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def install(self) -> dict:
        return install(self.path)


class ReleaseWritingAssistanceInstaller:
    def __init__(
        self,
        path: Path,
        data: DataRelease | None = DATA,
        *,
        opener: Opener = urllib.request.urlopen,
        timeout: float = DOWNLOAD_TIMEOUT,
    ) -> None:
        self.path = path
        self.data = data
        self.opener = opener
        self.timeout = timeout

    def install(self) -> dict:
        return install_release_asset(self.path, self.data, opener=self.opener, timeout=self.timeout)
