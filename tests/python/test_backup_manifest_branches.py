"""Reaches every rejection of the backup manifest contract, with its public code (T-19 P8).

Written against the module before it was typed strictly. A manifest decides which backup
may be restored, so each case breaks exactly one rule of a valid manifest and names the
`code` and message the caller receives.
"""

from __future__ import annotations

import hashlib
import unittest
from collections.abc import Callable
from typing import Any
from unittest.mock import patch

from quiltor.application import backup_manifest
from quiltor.application.backup_manifest import (
    BackupContractError,
    ManifestFile,
    build_manifest_files,
    canonical_manifest_bytes,
    manifest_identifier,
    strict_json_loads,
    validate_manifest,
    verify_blob,
)

DATABASE = b"SQLite format 3\x00"
CHAPTER = "Der Morgen lag still über dem Hafen.".encode()
INVALID = ("invalid_backup_manifest", "Backup snapshot failed validation.")
UNSUPPORTED = ("unsupported_backup_format", "Backup snapshot format is not supported.")
INTEGRITY = ("backup_content_integrity", "Backup content failed integrity verification.")
WORLD_MISMATCH = ("backup_world_mismatch", "Backup snapshot belongs to a different world.")
ID_REQUEST_MISMATCH = (
    "backup_id_mismatch",
    "Backup snapshot identifier does not match its request.",
)
ID_VERIFICATION = ("backup_id_mismatch", "Backup snapshot identifier failed verification.")
COLLISION = ("backup_path_collision", "Backup snapshot contains colliding file names.")

type Document = dict[str, Any]


def digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def manifest(
    format_version: int = 2, change: Callable[[Document], object] | None = None
) -> Document:
    """A valid manifest, changed by `change`, with its identifier derived afterwards."""

    if format_version == 1:
        files: dict[str, Any] = {
            "world.sqlite3": digest(DATABASE),
            "manuscripts/Kapitel 1.md": digest(CHAPTER),
        }
    else:
        files = build_manifest_files(
            [
                ("world.sqlite3", DATABASE),
                ("manuscripts/Kapitel 1.md", CHAPTER),
                ("profiles/Ada.md", b""),
            ]
        )
    document: Document = {
        "format": format_version,
        "encryption": "none",
        "created": "2026-01-02T03:04:05Z",
        "world": "harbour-1",
        "title": "Vor dem Sturm",
        "message": "Kapitel 1 fertig",
        "parent": "",
        "files": files,
    }
    if change is not None:
        change(document)
    if "id" not in document:
        body = {key: value for key, value in document.items() if key != "id"}
        try:
            format_version_value: Any = document.get("format")
            document["id"] = manifest_identifier(body, format_version_value)
        except (BackupContractError, TypeError):
            document["id"] = "0" * 64
    return document


def _set(key: str, value: object) -> Callable[[Document], None]:
    return lambda document: document.__setitem__(key, value)


def _file(path: Any, value: object) -> Callable[[Document], None]:
    return lambda document: document["files"].__setitem__(path, value)


def _record(path: str, **changes: object) -> Callable[[Document], None]:
    return lambda document: document["files"][path].update(changes)


def _files(files: dict[str, Any]) -> Callable[[Document], None]:
    return lambda document: document.__setitem__("files", files)


DB = "world.sqlite3"
TEXT = "manuscripts/Kapitel 1.md"
VALID_RECORD = {"sha256": digest(CHAPTER), "size": len(CHAPTER)}
MIB = 1024 * 1024

# name -> (format, change, expected (code, message))
REJECTIONS: dict[str, tuple[int, Callable[[Document], object], tuple[str, str]]] = {
    # schema
    "unknown field": (2, _set("signature", "x"), INVALID),
    "missing field": (2, lambda document: document.pop("message"), INVALID),
    "format a string": (2, _set("format", "2"), UNSUPPORTED),
    "format a bool": (2, _set("format", True), UNSUPPORTED),
    "format three": (2, _set("format", 3), UNSUPPORTED),
    "format zero": (2, _set("format", 0), UNSUPPORTED),
    "encrypted": (2, _set("encryption", "aes-256-gcm"), UNSUPPORTED),
    "encryption missing value": (2, _set("encryption", None), UNSUPPORTED),
    # identity fields
    "world empty": (2, _set("world", ""), INVALID),
    "world a dot": (2, _set("world", "."), INVALID),
    "world starts with a dash": (2, _set("world", "-harbour"), INVALID),
    "world with a slash": (2, _set("world", "a/b"), INVALID),
    "world too long": (2, _set("world", "w" * 129), INVALID),
    "world a number": (2, _set("world", 7), INVALID),
    "created a number": (2, _set("created", 0), INVALID),
    "created a date only": (2, _set("created", "2026-01-02"), INVALID),
    "created no calendar date": (2, _set("created", "2026-02-30T03:04:05Z"), INVALID),
    "created hour 24": (2, _set("created", "2026-01-02T24:00:00+01:00"), INVALID),
    "title too long": (2, _set("title", "t" * 501), INVALID),
    "title with a NUL": (2, _set("title", "a\x00b"), INVALID),
    "title a number": (2, _set("title", 1), INVALID),
    "message too long": (2, _set("message", "m" * 4001), INVALID),
    "message null": (2, _set("message", None), INVALID),
    "parent not a digest": (2, _set("parent", "abc"), INVALID),
    "parent upper case": (2, _set("parent", "A" * 64), INVALID),
    "parent null": (2, _set("parent", None), INVALID),
    "id not a digest": (2, _set("id", "snapshot-1"), INVALID),
    "id a number": (2, _set("id", 1), INVALID),
    "id of other content": (2, _set("id", "f" * 64), ID_VERIFICATION),
    # file table
    "files a list": (2, _set("files", []), INVALID),
    "files empty": (2, _set("files", {}), INVALID),
    "path not a string": (2, _file(5, VALID_RECORD), INVALID),
    "path empty": (2, _file("", VALID_RECORD), INVALID),
    "path not NFC": (2, _file("manuscripts/Café.md", VALID_RECORD), INVALID),
    "path too deep": (2, _file("manuscripts/a/b.md", VALID_RECORD), INVALID),
    "path at the top level": (2, _file("notes.md", VALID_RECORD), INVALID),
    "path with a backslash": (2, _file("manuscripts/a\\b.md", VALID_RECORD), INVALID),
    "path with an encoded dot": (2, _file("manuscripts/%2E%2e.md", VALID_RECORD), INVALID),
    "path with an encoded slash": (2, _file("manuscripts/a%2Fb.md", VALID_RECORD), INVALID),
    "path in an unknown directory": (2, _file("images/a.md", VALID_RECORD), INVALID),
    "path without a file name": (2, _file("manuscripts/", VALID_RECORD), INVALID),
    "path naming the parent": (2, _file("profiles/..", VALID_RECORD), INVALID),
    "file name with a leading blank": (2, _file("manuscripts/ a.md", VALID_RECORD), INVALID),
    "file name ending in a dot": (2, _file("manuscripts/a.md.", VALID_RECORD), INVALID),
    "file name not markdown": (2, _file("manuscripts/a.txt", VALID_RECORD), INVALID),
    "file name too long": (2, _file("manuscripts/" + "ä" * 119 + ".md", VALID_RECORD), INVALID),
    "file name with a control character": (2, _file("manuscripts/a\tb.md", VALID_RECORD), INVALID),
    "file name with a colon": (2, _file("manuscripts/a:b.md", VALID_RECORD), INVALID),
    "file name with a fraction slash": (2, _file("manuscripts/a\u2044b.md", VALID_RECORD), INVALID),
    "file name with a fullwidth backslash": (
        2,
        _file("profiles/a\uff3cb.md", VALID_RECORD),
        INVALID,
    ),
    "windows device name": (2, _file("manuscripts/CON.md", VALID_RECORD), INVALID),
    "windows device name with a suffix": (
        2,
        _file("profiles/lpt9.notes.md", VALID_RECORD),
        INVALID,
    ),
    "names differing only in case": (2, _file("manuscripts/kapitel 1.md", VALID_RECORD), COLLISION),
    "v1 digest not a string": (1, _file(TEXT, {"sha256": digest(CHAPTER)}), INVALID),
    "v1 digest upper case": (1, _file(TEXT, digest(CHAPTER).upper()), INVALID),
    "v2 record a digest string": (2, _file(TEXT, digest(CHAPTER)), INVALID),
    "v2 record with an extra field": (2, _record(TEXT, mode="0644"), INVALID),
    "v2 record without size": (2, lambda document: document["files"][TEXT].pop("size"), INVALID),
    "v2 digest short": (2, _record(TEXT, sha256="ab"), INVALID),
    "v2 size a string": (2, _record(TEXT, size="36"), INVALID),
    "v2 size a bool": (2, _record("profiles/Ada.md", size=False), INVALID),
    "v2 size a float": (2, _record(TEXT, size=36.0), INVALID),
    "empty database": (2, _record(DB, size=0, sha256=digest(b"")), INVALID),
    "negative text size": (2, _record(TEXT, size=-1), INVALID),
    "text above its limit": (2, _record(TEXT, size=8 * MIB + 1), INVALID),
    "database above its limit": (2, _record(DB, size=512 * MIB + 1), INVALID),
    "one digest with two sizes": (2, _record("profiles/Ada.md", sha256=digest(CHAPTER)), INVALID),
    "no database": (2, lambda document: document["files"].pop(DB), INVALID),
    "declared total above a gigabyte": (
        2,
        _files(
            {
                DB: {"sha256": "0" * 64, "size": 512 * MIB},
                **{
                    f"manuscripts/{index}.md": {"sha256": f"{index:064x}", "size": 8 * MIB}
                    for index in range(1, 66)
                },
            }
        ),
        INVALID,
    ),
}

ACCEPTANCES: dict[str, tuple[int, Callable[[Document], object]]] = {
    "v2 as built": (2, lambda document: None),
    "v1 digests only": (1, lambda document: None),
    "created with an offset": (2, _set("created", "2026-01-02T03:04:05+02:00")),
    "created without a zone": (2, _set("created", "2026-01-02T03:04:05")),
    "a parent snapshot": (2, _set("parent", "a" * 64)),
    "longest title and message": (
        2,
        lambda document: document.update(title="t" * 500, message="m" * 4000),
    ),
    "longest world id": (2, _set("world", "W" + "w._-" * 31 + "ww")),
    "database at its limit": (2, _record(DB, size=512 * MIB)),
    "file name at its byte limit": (2, _file("manuscripts/" + "ä" * 118 + "a.md", VALID_RECORD)),
    "one digest shared at one size": (2, _file("profiles/Kapitel.md", VALID_RECORD)),
    "markdown suffix in upper case": (2, _file("profiles/ADA2.MD", VALID_RECORD)),
}


def contract_error(call: Callable[..., object], *args: Any, **kwargs: Any) -> tuple[str, str]:
    try:
        call(*args, **kwargs)
    except BackupContractError as error:
        return error.code, str(error)
    raise AssertionError("the call was accepted")


class ValidateManifestTests(unittest.TestCase):
    def test_every_rejection_names_its_code(self) -> None:
        for name, (format_version, change, expected) in REJECTIONS.items():
            with self.subTest(name):
                document = manifest(format_version, change)
                self.assertEqual(contract_error(validate_manifest, document), expected)

    def test_every_acceptance_validates(self) -> None:
        for name, (format_version, change) in ACCEPTANCES.items():
            with self.subTest(name):
                validated = validate_manifest(manifest(format_version, change))
                self.assertEqual(validated.world, validated.document["world"])

    def test_a_document_that_is_not_an_object(self) -> None:
        for document in (None, [], "manifest", 5):
            with self.subTest(document=document):
                self.assertEqual(contract_error(validate_manifest, document), INVALID)

    def test_too_many_files(self) -> None:
        def many(document: Document) -> None:
            document["files"] = {f"manuscripts/{index}.md": VALID_RECORD for index in range(20_002)}

        document = manifest(2, many)
        self.assertEqual(contract_error(validate_manifest, document), INVALID)

    def test_expected_world_and_identifier(self) -> None:
        document = manifest()
        validated = validate_manifest(
            document, expected_world="harbour-1", expected_id=document["id"]
        )
        self.assertEqual((validated.identifier, validated.world), (document["id"], "harbour-1"))
        self.assertEqual(
            contract_error(validate_manifest, document, expected_world="other"),
            WORLD_MISMATCH,
        )
        self.assertEqual(contract_error(validate_manifest, document, expected_world=".."), INVALID)
        self.assertEqual(
            contract_error(validate_manifest, document, expected_id="0" * 64),
            ID_REQUEST_MISMATCH,
        )

    def test_records_carry_paths_digests_and_sizes(self) -> None:
        v2 = validate_manifest(manifest())
        self.assertEqual(
            sorted((record.logical_path, record.size) for record in v2.files),
            [
                ("manuscripts/Kapitel 1.md", len(CHAPTER)),
                ("profiles/Ada.md", 0),
                (DB, len(DATABASE)),
            ],
        )
        v1 = validate_manifest(manifest(1))
        self.assertEqual({record.size for record in v1.files}, {None})
        self.assertIsNot(v2.document, manifest())

    def test_the_identifier_formats_differ_by_version(self) -> None:
        body = {"title": "Über", "files": {"b": 1, "a": 2}}
        self.assertEqual(
            canonical_manifest_bytes(body, 1), b'{"files": {"a": 2, "b": 1}, "title": "\\u00dcber"}'
        )
        self.assertEqual(
            canonical_manifest_bytes(body, 2), '{"files":{"a":2,"b":1},"title":"Über"}'.encode()
        )
        for format_version in (0, 3):
            with self.subTest(format_version=format_version):
                self.assertEqual(
                    contract_error(canonical_manifest_bytes, body, format_version),
                    UNSUPPORTED,
                )


class StrictJsonTests(unittest.TestCase):
    def test_bytes_and_text_within_the_limit_parse(self) -> None:
        self.assertEqual(strict_json_loads(b'{"a": [1]}', maximum_bytes=10), {"a": [1]})
        self.assertEqual(strict_json_loads('{"ü": 1}', maximum_bytes=9), {"ü": 1})

    def test_rejections(self) -> None:
        for name, payload, maximum in (
            ("bytes over the limit", b"[1, 2]", 5),
            ("text over the limit in UTF-8", '"ü"', 3),
            ("not UTF-8", b'"\xff"', 10),
            ("neither bytes nor text", 5, 10),
            ("a bytearray", bytearray(b"[]"), 10),
            ("duplicate keys", '{"a": 1, "a": 2}', 100),
            ("nested duplicate keys", b'{"x": {"a": 1, "a": 1}}', 100),
            ("malformed", "{", 100),
            ("NaN is fine but trailing data is not", "[NaN] x", 100),
            ("too deep", "[" * 100_000, 1_000_000),
        ):
            with self.subTest(name):
                self.assertEqual(
                    contract_error(strict_json_loads, payload, maximum_bytes=maximum),
                    INVALID,
                )


class VerifyBlobTests(unittest.TestCase):
    def test_a_matching_blob_is_returned(self) -> None:
        record = ManifestFile(TEXT, digest(CHAPTER), len(CHAPTER))
        self.assertEqual(verify_blob(record, CHAPTER), CHAPTER)
        self.assertEqual(verify_blob(ManifestFile(TEXT, digest(CHAPTER), None), CHAPTER), CHAPTER)

    def test_rejections(self) -> None:
        sized = ManifestFile(TEXT, digest(CHAPTER), len(CHAPTER))
        unsized = ManifestFile(TEXT, digest(CHAPTER), None)
        for name, record, payload in (
            ("not bytes", sized, CHAPTER.decode()),
            ("a bytearray", sized, bytearray(CHAPTER)),
            ("above the text limit", unsized, b"x" * (8 * MIB + 1)),
            ("other size than declared", sized, CHAPTER + b" "),
            ("other content", unsized, CHAPTER.upper()),
        ):
            with self.subTest(name):
                self.assertEqual(contract_error(verify_blob, record, payload), INTEGRITY)

    def test_the_database_has_the_larger_limit(self) -> None:
        self.assertEqual(ManifestFile(DB, "", None).maximum_size, 512 * MIB)
        self.assertEqual(ManifestFile(TEXT, "", None).maximum_size, 8 * MIB)


class BuildManifestFilesTests(unittest.TestCase):
    def test_descriptors_hold_digest_and_size(self) -> None:
        self.assertEqual(
            build_manifest_files([(DB, DATABASE), ("profiles/Ada.md", b"")]),
            {
                DB: {"sha256": digest(DATABASE), "size": len(DATABASE)},
                "profiles/Ada.md": {"sha256": digest(b""), "size": 0},
            },
        )

    def test_rejections(self) -> None:
        for name, files in (
            ("an unsafe path", [(DB, DATABASE), ("../x.md", b"")]),
            ("one path twice", [(DB, DATABASE), (DB, DATABASE)]),
            ("text instead of bytes", [(DB, DATABASE), (TEXT, "Kapitel")]),
            ("text above its limit", [(DB, DATABASE), (TEXT, b"x" * (8 * MIB + 1))]),
            ("an empty database", [(DB, b"")]),
            ("no database", [(TEXT, CHAPTER)]),
            ("nothing", []),
        ):
            with self.subTest(name):
                self.assertEqual(contract_error(build_manifest_files, files), INVALID)

    def test_the_total_and_the_file_count_are_bounded(self) -> None:
        with patch.object(backup_manifest, "MAX_TOTAL_BYTES", len(DATABASE) + 1):
            self.assertEqual(
                contract_error(build_manifest_files, [(DB, DATABASE), (TEXT, b"ab")]),
                INVALID,
            )
            build_manifest_files([(DB, DATABASE), (TEXT, b"a")])
        with patch.object(backup_manifest, "MAX_FILES", 1):
            self.assertEqual(
                contract_error(build_manifest_files, [(DB, DATABASE), (TEXT, b"")]), INVALID
            )
            build_manifest_files([(DB, DATABASE)])


if __name__ == "__main__":
    unittest.main()
