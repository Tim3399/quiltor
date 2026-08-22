"""Versioned, fail-closed contract for untrusted backup manifests and blobs."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterable

CURRENT_FORMAT_VERSION = 2
SUPPORTED_FORMAT_VERSIONS = frozenset({1, CURRENT_FORMAT_VERSION})
ENCRYPTION_NONE = "none"

DATABASE_NAME = "world.sqlite3"
TEXT_DIRECTORIES = frozenset({"manuscripts", "profiles"})
DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")
WORLD_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
CREATED_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})?$")
ENCODED_PATH_TOKEN_RE = re.compile(r"%(?:2e|2f|5c)", re.IGNORECASE)

MANIFEST_FIELDS = frozenset(
    {"format", "encryption", "created", "world", "title", "message", "parent", "files", "id"}
)
FILE_RECORD_FIELDS = frozenset({"sha256", "size"})

MAX_MANIFEST_BYTES = 2 * 1024 * 1024
MAX_FILES = 20_001
MAX_DATABASE_BYTES = 512 * 1024 * 1024
MAX_BLOB_BYTES = MAX_DATABASE_BYTES
MAX_TEXT_FILE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 1024 * 1024 * 1024
MAX_FILENAME_BYTES = 240
MAX_TITLE_LENGTH = 500
MAX_MESSAGE_LENGTH = 4_000

_WINDOWS_RESERVED = frozenset(
    {
        "con",
        "prn",
        "aux",
        "nul",
        *(f"com{number}" for number in range(1, 10)),
        *(f"lpt{number}" for number in range(1, 10)),
    }
)
_CONFUSABLE_SEPARATORS = frozenset({"\u2044", "\u2215", "\u29f8", "\ufe68", "\uff0f", "\uff3c"})


class BackupContractError(ValueError):
    """Safe public error for a malformed manifest or corrupt content blob."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class ManifestFile:
    logical_path: str
    digest: str
    size: int | None

    @property
    def maximum_size(self) -> int:
        return MAX_DATABASE_BYTES if self.logical_path == DATABASE_NAME else MAX_TEXT_FILE_BYTES


@dataclass(frozen=True, slots=True)
class ValidatedBackupManifest:
    document: dict[str, Any]
    files: tuple[ManifestFile, ...]

    @property
    def identifier(self) -> str:
        return self.document["id"]

    @property
    def world(self) -> str:
        return self.document["world"]


def _invalid() -> BackupContractError:
    return BackupContractError("invalid_backup_manifest", "Backup snapshot failed validation.")


def _unsupported() -> BackupContractError:
    return BackupContractError(
        "unsupported_backup_format", "Backup snapshot format is not supported."
    )


def _integrity() -> BackupContractError:
    return BackupContractError(
        "backup_content_integrity", "Backup content failed integrity verification."
    )


def _strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise _invalid()
        result[key] = value
    return result


def strict_json_loads(payload: bytes | str, *, maximum_bytes: int) -> Any:
    """Parse JSON without accepting duplicate object keys or oversized input."""

    if isinstance(payload, bytes):
        if len(payload) > maximum_bytes:
            raise _invalid()
        try:
            text = payload.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise _invalid() from exc
    elif isinstance(payload, str):
        if len(payload.encode("utf-8")) > maximum_bytes:
            raise _invalid()
        text = payload
    else:
        raise _invalid()
    try:
        return json.loads(text, object_pairs_hook=_strict_object)
    except BackupContractError:
        raise
    except (TypeError, ValueError, RecursionError) as exc:
        raise _invalid() from exc


def canonical_manifest_bytes(document_without_id: dict[str, Any], format_version: int) -> bytes:
    """Canonical bytes used to derive a snapshot identifier.

    V1 preserves the historical Python serialization used by released builds.
    V2 fixes the public contract to compact UTF-8 JSON.
    """

    if format_version == 1:
        encoded = json.dumps(document_without_id, sort_keys=True)
    elif format_version == CURRENT_FORMAT_VERSION:
        encoded = json.dumps(
            document_without_id,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
    else:
        raise _unsupported()
    return encoded.encode("utf-8")


def manifest_identifier(document_without_id: dict[str, Any], format_version: int) -> str:
    return hashlib.sha256(canonical_manifest_bytes(document_without_id, format_version)).hexdigest()


def _validate_world_id(value: Any) -> str:
    if type(value) is not str or not WORLD_ID_RE.fullmatch(value) or value in {".", ".."}:
        raise _invalid()
    return value


def _validate_created(value: Any) -> str:
    if type(value) is not str or not CREATED_RE.fullmatch(value):
        raise _invalid()
    try:
        datetime.fromisoformat(value.removesuffix("Z") + ("+00:00" if value.endswith("Z") else ""))
    except ValueError as exc:
        raise _invalid() from exc
    return value


def _validate_text(value: Any, maximum: int) -> str:
    if type(value) is not str or len(value) > maximum or "\x00" in value:
        raise _invalid()
    return value


def _validate_logical_path(path: Any) -> str:
    if type(path) is not str or not path or path != unicodedata.normalize("NFC", path):
        raise _invalid()
    if path == DATABASE_NAME:
        return path
    if path.count("/") != 1 or "\\" in path or ENCODED_PATH_TOKEN_RE.search(path):
        raise _invalid()
    directory, filename = path.split("/", 1)
    if directory not in TEXT_DIRECTORIES or not filename or filename in {".", ".."}:
        raise _invalid()
    if (
        filename != filename.strip()
        or filename.endswith(".")
        or not filename.casefold().endswith(".md")
        or len(filename.encode("utf-8")) > MAX_FILENAME_BYTES
        or any(ord(character) < 32 for character in filename)
        or any(character in '<>:"|?*' for character in filename)
        or any(character in _CONFUSABLE_SEPARATORS for character in filename)
    ):
        raise _invalid()
    if filename.split(".", 1)[0].casefold() in _WINDOWS_RESERVED:
        raise _invalid()
    return path


def _descriptor(path: str, value: Any, format_version: int) -> ManifestFile:
    if format_version == 1:
        if type(value) is not str or not DIGEST_RE.fullmatch(value):
            raise _invalid()
        return ManifestFile(path, value, None)
    if type(value) is not dict or frozenset(value) != FILE_RECORD_FIELDS:
        raise _invalid()
    digest = value.get("sha256")
    size = value.get("size")
    if type(digest) is not str or not DIGEST_RE.fullmatch(digest) or type(size) is not int:
        raise _invalid()
    record = ManifestFile(path, digest, size)
    if size < (1 if path == DATABASE_NAME else 0) or size > record.maximum_size:
        raise _invalid()
    return record


def validate_manifest(
    document: Any,
    *,
    expected_world: str | None = None,
    expected_id: str | None = None,
) -> ValidatedBackupManifest:
    """Validate exact schema, identity, portable paths and declared sizes."""

    if type(document) is not dict or frozenset(document) != MANIFEST_FIELDS:
        raise _invalid()
    format_version = document.get("format")
    if type(format_version) is not int or format_version not in SUPPORTED_FORMAT_VERSIONS:
        raise _unsupported()
    if document.get("encryption") != ENCRYPTION_NONE:
        raise _unsupported()
    world = _validate_world_id(document.get("world"))
    if expected_world is not None and world != _validate_world_id(expected_world):
        raise BackupContractError(
            "backup_world_mismatch", "Backup snapshot belongs to a different world."
        )
    _validate_created(document.get("created"))
    _validate_text(document.get("title"), MAX_TITLE_LENGTH)
    _validate_text(document.get("message"), MAX_MESSAGE_LENGTH)
    parent = document.get("parent")
    if type(parent) is not str or (parent and not DIGEST_RE.fullmatch(parent)):
        raise _invalid()
    identifier = document.get("id")
    if type(identifier) is not str or not DIGEST_RE.fullmatch(identifier):
        raise _invalid()
    if expected_id is not None and identifier != expected_id:
        raise BackupContractError(
            "backup_id_mismatch", "Backup snapshot identifier does not match its request."
        )

    raw_files = document.get("files")
    if type(raw_files) is not dict or not raw_files or len(raw_files) > MAX_FILES:
        raise _invalid()
    records: list[ManifestFile] = []
    collision_keys: set[str] = set()
    declared_total = 0
    digest_sizes: dict[str, int] = {}
    for raw_path, value in raw_files.items():
        path = _validate_logical_path(raw_path)
        collision_key = unicodedata.normalize("NFC", path).casefold()
        if collision_key in collision_keys:
            raise BackupContractError(
                "backup_path_collision", "Backup snapshot contains colliding file names."
            )
        collision_keys.add(collision_key)
        record = _descriptor(path, value, format_version)
        if record.size is not None:
            declared_total += record.size
            previous_size = digest_sizes.setdefault(record.digest, record.size)
            if previous_size != record.size:
                raise _invalid()
        records.append(record)
    if DATABASE_NAME not in raw_files or declared_total > MAX_TOTAL_BYTES:
        raise _invalid()

    body = {key: value for key, value in document.items() if key != "id"}
    if manifest_identifier(body, format_version) != identifier:
        raise BackupContractError(
            "backup_id_mismatch", "Backup snapshot identifier failed verification."
        )
    return ValidatedBackupManifest(document=dict(document), files=tuple(records))


def verify_blob(record: ManifestFile, payload: Any) -> bytes:
    if type(payload) is not bytes or len(payload) > record.maximum_size:
        raise _integrity()
    if record.size is not None and len(payload) != record.size:
        raise _integrity()
    if hashlib.sha256(payload).hexdigest() != record.digest:
        raise _integrity()
    return payload


def build_manifest_files(files: Iterable[tuple[str, bytes]]) -> dict[str, dict[str, Any]]:
    """Create V2 file descriptors after applying the same path/size rules as readers."""

    descriptors: dict[str, dict[str, Any]] = {}
    total = 0
    for path, payload in files:
        canonical = _validate_logical_path(path)
        if canonical in descriptors or type(payload) is not bytes:
            raise _invalid()
        maximum = MAX_DATABASE_BYTES if canonical == DATABASE_NAME else MAX_TEXT_FILE_BYTES
        if len(payload) > maximum or (canonical == DATABASE_NAME and not payload):
            raise _invalid()
        total += len(payload)
        if total > MAX_TOTAL_BYTES:
            raise _invalid()
        descriptors[canonical] = {
            "sha256": hashlib.sha256(payload).hexdigest(),
            "size": len(payload),
        }
    if DATABASE_NAME not in descriptors or len(descriptors) > MAX_FILES:
        raise _invalid()
    return descriptors


__all__ = [
    "BackupContractError",
    "CURRENT_FORMAT_VERSION",
    "DATABASE_NAME",
    "DIGEST_RE",
    "ENCRYPTION_NONE",
    "MAX_BLOB_BYTES",
    "MAX_MANIFEST_BYTES",
    "MAX_TOTAL_BYTES",
    "ManifestFile",
    "ValidatedBackupManifest",
    "build_manifest_files",
    "manifest_identifier",
    "strict_json_loads",
    "validate_manifest",
    "verify_blob",
]
