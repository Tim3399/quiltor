import gzip
import hashlib
import json
import shutil
import sqlite3
import tempfile
import threading
import unittest
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, cast
from unittest import mock

from quiltor.delivery.http.errors import from_exception
from quiltor.infrastructure.persistence.writing_assistance import (
    DICTIONARY_SCHEMA,
    SQLiteWritingAssistanceRepository,
    content_sha256,
    initialize,
    insert,
    insert_form,
)
from quiltor.infrastructure.persistence.writing_assistance import (
    sources as stored_sources,
)
from quiltor.infrastructure.writing_assistance.installer import (
    UNPACK_FACTOR_ESTIMATE,
    CoreWritingAssistanceInstaller,
    ReleaseWritingAssistanceInstaller,
    install_release_asset,
    required_space,
    validate_checksum,
)
from quiltor.modules.writing_assistance import registry
from quiltor.modules.writing_assistance.errors import (
    ChecksumMismatch,
    DataNotPublished,
    DownloadFailed,
    InstallInProgress,
    InsufficientSpace,
)
from quiltor.modules.writing_assistance.grammar import UnavailableGrammar
from quiltor.modules.writing_assistance.providers import (
    parse_openthesaurus,
    parse_wiktionary,
)
from quiltor.modules.writing_assistance.registry import MANIFEST_VERSION, DataRelease
from quiltor.modules.writing_assistance.service import (
    DICTIONARY_SCHEMA as SERVICE_DICTIONARY_SCHEMA,
)
from quiltor.modules.writing_assistance.service import WritingAssistanceService


class WritingAssistanceServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        data = Path(self.temp.name)
        self.repository = SQLiteWritingAssistanceRepository(data)
        self.service = WritingAssistanceService(
            self.repository,
            CoreWritingAssistanceInstaller(self.repository.path),
            UnavailableGrammar(data),
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_status_install_and_normalized_lookups(self):
        self.assertFalse(self.service.status()["installed"])
        self.service.install()
        self.assertTrue(self.service.status()["installed"])
        dictionary = self.service.lookup("de-DE", "dictionary", "  Haus ")
        self.assertEqual(dictionary["results"][0]["partOfSpeech"], "Substantiv")
        self.assertIn(
            "rasch", self.service.lookup("de-DE", "synonyms", "SCHNELL")["results"][0]["values"]
        )
        self.assertIn(
            "house", self.service.lookup("de-DE", "translation", "Haus")["results"][0]["values"]
        )
        self.assertIn(
            "Haus", self.service.lookup("en-GB", "translation", "house")["results"][0]["values"]
        )
        self.assertEqual(self.service.lookup("de-DE", "dictionary", "unbekannt")["results"], [])

    def test_missing_data_and_invalid_requests_are_explicit(self):
        with self.assertRaises(FileNotFoundError):
            self.service.lookup("de-DE", "dictionary", "Haus")
        self.service.install()
        for language, mode, query in (
            ("fr", "dictionary", "mot"),
            ("de-DE", "bad", "Haus"),
            ("de-DE", "dictionary", ""),
        ):
            with self.assertRaises(ValueError):
                self.service.lookup(language, mode, query)

    def test_outdated_database_requires_reinstallation(self):
        self.service.install()

        with closing(sqlite3.connect(self.repository.path)) as conn:
            with conn:
                conn.execute("UPDATE metadata SET value='old' WHERE key='version'")
        self.assertFalse(self.service.status()["installed"])
        self.assertTrue(self.service.status()["stale"])
        with self.assertRaises(FileNotFoundError):
            self.service.lookup("de-DE", "dictionary", "Haus")

    def test_provider_parsers_normalize_upstream_formats(self):
        thesaurus = list(parse_openthesaurus(["schnell;rasch;flink\n"]))
        self.assertEqual(thesaurus[0]["values"], ["rasch", "flink"])
        wiki = list(
            parse_wiktionary(
                [
                    json.dumps(
                        {
                            "lang_code": "de",
                            "word": "gehen",
                            "pos": "verb",
                            "senses": [{"glosses": ["sich fortbewegen"]}],
                        }
                    )
                ]
            )
        )
        self.assertEqual(wiki[0]["meaning"], "sich fortbewegen")

    def test_status_reports_coverage_of_the_installed_vocabulary(self):
        self.assertIsNone(self.service.status()["coverage"])
        self.service.install()
        self.assertEqual(self.service.status()["coverage"], "core")

    def test_status_reports_the_sources_the_installed_database_records(self):
        self.assertEqual(self.service.status()["installed_sources"], [])
        self.service.install()
        source = {
            "name": "wiktionary",
            "url": "https://example.org/dump",
            "version": "",
            "retrieved": "2026-11-03",
            "license": "CC BY-SA 4.0",
            "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
        }
        with closing(sqlite3.connect(self.repository.path)) as conn:
            with conn:
                conn.execute(
                    "INSERT OR REPLACE INTO metadata(key,value) VALUES('sources',?)",
                    (json.dumps([source]),),
                )
        self.assertEqual(self.service.status()["installed_sources"], [source])
        with closing(sqlite3.connect(self.repository.path)) as conn:
            with conn:
                conn.execute("UPDATE metadata SET value='old' WHERE key='version'")
        self.assertEqual(self.service.status()["installed_sources"], [])

    def test_status_carries_no_static_source_registry(self):
        status = self.service.status()
        self.assertNotIn("sources", status)
        self.assertNotIn("manifest", status)
        self.assertNotIn("GFDL", json.dumps(status))
        self.assertNotIn("dumps.wikimedia", json.dumps(status))

    def test_database_from_before_coverage_counts_as_core(self):
        self.service.install()
        with closing(sqlite3.connect(self.repository.path)) as conn:
            with conn:
                conn.execute("DELETE FROM metadata WHERE key='coverage'")
        self.assertEqual(self.service.status()["coverage"], "core")

    def test_stale_database_reports_no_coverage(self):
        self.service.install()
        with closing(sqlite3.connect(self.repository.path)) as conn:
            with conn:
                conn.execute("UPDATE metadata SET value='old' WHERE key='version'")
        self.assertIsNone(self.service.status()["coverage"])

    def test_checksum_validation_rejects_stale_data(self):
        path = Path(self.temp.name) / "source"
        path.write_bytes(b"valid")
        self.assertTrue(
            validate_checksum(
                path, "sha256:ec654fac9599f62e79e2706abef23dfb7c07c08185aa86db4d8695f0b718d1b3"
            )
        )
        self.assertFalse(validate_checksum(path, "sha256:" + "0" * 64))


class DictionarySchemaTests(unittest.TestCase):
    """Schema 2: inflected forms, license metadata, and schema-1 files that predate it."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        data = Path(self.temp.name)
        self.repository = SQLiteWritingAssistanceRepository(data)
        self.service = WritingAssistanceService(
            self.repository,
            CoreWritingAssistanceInstaller(self.repository.path),
            UnavailableGrammar(data),
        )

    def tearDown(self):
        self.temp.cleanup()

    def build(self, licenses=None):
        conn = initialize(self.repository.path, MANIFEST_VERSION, "full", licenses)
        with closing(conn), conn:
            insert(
                conn,
                "de-DE",
                "dictionary",
                "gehen",
                "gehen",
                "Verb",
                "sich fortbewegen",
                [],
                "wiktionary",
            )
            insert(conn, "de-DE", "synonyms", "gehen", "gehen", "", "", ["laufen"], "openthesaurus")
            insert(
                conn,
                "de-DE",
                "dictionary",
                "Gang",
                "Gang",
                "Substantiv",
                "das Gehen",
                [],
                "wiktionary",
            )
            insert_form(conn, "de-DE", "ging", "gehen")
            insert_form(conn, "de-DE", "Gänge", "Gang")

    def build_schema_1(self):
        """The layout every database had before schema 2: metadata and entries only."""
        with closing(sqlite3.connect(self.repository.path)) as conn, conn:
            conn.executescript(
                """
                CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE entries(
                 id INTEGER PRIMARY KEY, language TEXT NOT NULL, mode TEXT NOT NULL,
                 query TEXT NOT NULL COLLATE NOCASE, lemma TEXT NOT NULL, part_of_speech TEXT NOT NULL DEFAULT '',
                 meaning TEXT NOT NULL DEFAULT '', values_json TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL
                );
                """
            )
            conn.execute("INSERT INTO metadata VALUES('version',?)", (MANIFEST_VERSION,))
            conn.execute(
                "INSERT INTO entries(language,mode,query,lemma,source) VALUES('de-DE','dictionary','haus','Haus','core')"
            )

    def test_service_reads_the_same_schema_as_the_adapter(self):
        self.assertEqual(SERVICE_DICTIONARY_SCHEMA, DICTIONARY_SCHEMA)

    def test_schema_2_is_written_and_read_back(self):
        self.build()
        self.assertEqual(self.repository.schema(), 2)
        status = self.service.status()
        self.assertTrue(status["installed"])
        self.assertFalse(status["stale"])
        self.assertEqual(status["coverage"], "full")

    def test_core_install_writes_schema_2(self):
        self.service.install()
        self.assertEqual(self.repository.schema(), 2)
        self.assertFalse(self.service.status()["stale"])

    def test_inflected_form_finds_its_lemma(self):
        self.build()
        results = self.service.lookup("de-DE", "dictionary", "ging")["results"]
        self.assertEqual([row["lemma"] for row in results], ["gehen"])
        self.assertEqual(
            self.service.lookup("de-DE", "synonyms", "GING")["results"][0]["values"], ["laufen"]
        )
        self.assertEqual(
            self.service.lookup("de-DE", "dictionary", "gänge")["results"][0]["lemma"], "Gang"
        )

    def test_form_without_lemma_entry_and_unknown_word_find_nothing(self):
        self.build()
        self.assertEqual(self.service.lookup("de-DE", "dictionary", "unbekannt")["results"], [])
        self.assertEqual(self.service.lookup("de-DE", "translation", "ging")["results"], [])
        self.assertEqual(self.service.lookup("en-GB", "dictionary", "ging")["results"], [])

    def test_word_with_its_own_entry_does_not_fall_back(self):
        self.build()
        with closing(sqlite3.connect(self.repository.path)) as conn, conn:
            insert_form(conn, "de-DE", "gehen", "Gang")
        results = self.service.lookup("de-DE", "dictionary", "gehen")["results"]
        self.assertEqual([row["lemma"] for row in results], ["gehen"])

    def test_license_fields_are_stored_in_metadata(self):
        self.build(
            {
                "license": "CC BY-SA 4.0",
                "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
                "attribution": "Wiktionary contributors; OpenThesaurus",
            }
        )
        stored = self.repository.metadata()
        self.assertEqual(stored["license"], "CC BY-SA 4.0")
        self.assertEqual(stored["license_url"], "https://creativecommons.org/licenses/by-sa/4.0/")
        self.assertEqual(stored["attribution"], "Wiktionary contributors; OpenThesaurus")
        self.assertEqual(stored["schema"], "2")

    def source(self, **changes):
        return {
            "name": "openthesaurus",
            "url": "https://www.openthesaurus.de/export/OpenThesaurus-Textversion.zip",
            "version": "",
            "retrieved": "2026-11-03T09:00:00Z",
            "license": "CC-BY-SA-4.0",
            "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
            **changes,
        }

    def test_sources_are_stored_and_read_back(self):
        wiktionary = self.source(name="dewiktionary", version="6ae3112a")
        conn = initialize(
            self.repository.path, MANIFEST_VERSION, "full", None, [self.source(), wiktionary]
        )
        with closing(conn), conn:
            pass
        self.assertEqual(stored_sources(self.repository.path), [wiktionary, self.source()])

    def test_database_without_sources_reads_as_none(self):
        self.build()
        self.assertEqual(stored_sources(self.repository.path), [])

    def test_incomplete_sources_are_refused(self):
        without_license = self.source()
        del without_license["license"]
        for sources in (
            [],
            [without_license],
            [self.source(license_url=" ")],
            [self.source(url="")],
            [self.source(retrieved="")],
            [self.source(), self.source()],
            [self.source(extra="x")],
        ):
            with self.subTest(sources=sources), self.assertRaises(ValueError):
                initialize(self.repository.path, MANIFEST_VERSION, "full", None, sources)

    def test_sources_cannot_bypass_the_check_as_a_license_key(self):
        with self.assertRaises(ValueError):
            self.build({"sources": "[]"})

    def test_unknown_metadata_key_is_refused(self):
        with self.assertRaises(ValueError):
            self.build({"built_at": "2026-11-03"})

    def test_schema_1_database_stays_readable_and_reports_stale(self):
        self.build_schema_1()
        self.assertEqual(self.repository.schema(), 1)
        status = self.service.status()
        self.assertTrue(status["installed"])
        self.assertTrue(status["stale"])
        self.assertEqual(
            self.service.lookup("de-DE", "dictionary", "Haus")["results"][0]["lemma"], "Haus"
        )
        self.assertEqual(self.service.lookup("de-DE", "dictionary", "ging")["results"], [])

    def test_no_database_has_no_schema(self):
        self.assertIsNone(self.repository.schema())
        self.assertEqual(self.repository.metadata(), {})


RELEASE_VERSION = "2026.11.03"


def build_release_asset(directory: Path, version: str = RELEASE_VERSION) -> DataRelease:
    """A packed dictionary the way the data release ships it, with its pins."""
    database = directory / f"built-{version}.sqlite3"
    conn = initialize(database, version, "full")
    with closing(conn), conn:
        insert(
            conn, "de-DE", "dictionary", "baum", "Baum", "Substantiv", "Pflanze", [], "wiktionary"
        )
        insert(conn, "de-DE", "translation", "baum", "Baum", "", "", ["tree"], "wiktionary")
    asset = directory / f"writing-{version}.sqlite3.gz"
    with gzip.GzipFile(asset, "wb", mtime=0) as packed:
        packed.write(database.read_bytes())
    payload = asset.read_bytes()
    return {
        "version": version,
        "url": asset.as_uri(),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "bytes": len(payload),
        "content_sha256": content_sha256(database),
        "license": "CC BY-SA 4.0",
    }


def pinned(data: DataRelease, **changes: Any) -> DataRelease:
    """The same release entry with some pins changed, typed as the registry's."""
    return cast(DataRelease, {**data, **changes})


def must_not_download(*args, **kwargs):
    raise AssertionError("no network access expected")


class ReleaseInstallerTests(unittest.TestCase):
    """The dictionary comes from the data release, pinned by two digests (T-88 D2)."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        base = Path(self.temp.name)
        self.assets = base / "release"
        self.assets.mkdir()
        self.data_dir = base / "data"
        self.repository = SQLiteWritingAssistanceRepository(self.data_dir)
        self.asset = self.assets / f"writing-{RELEASE_VERSION}.sqlite3.gz"
        self.data = build_release_asset(self.assets)

    def tearDown(self):
        self.temp.cleanup()

    def service(self, data, opener=None):
        installer = ReleaseWritingAssistanceInstaller(
            self.repository.path, data, **({"opener": opener} if opener else {})
        )
        return WritingAssistanceService(
            self.repository, installer, UnavailableGrammar(self.data_dir), data
        )

    def leftovers(self):
        directory = self.repository.path.parent
        if not directory.exists():
            return []
        return sorted(
            item.name for item in directory.iterdir() if item.name != self.repository.path.name
        )

    def install_core(self):
        CoreWritingAssistanceInstaller(self.repository.path).install()
        return self.repository.path.read_bytes()

    def test_asset_installs_with_full_coverage(self):
        service = self.service(self.data)
        self.assertTrue(service.status()["data"]["available"])
        result = service.install()
        self.assertEqual(result, {"ok": True, "version": RELEASE_VERSION, "entries": 2})
        status = service.status()
        self.assertTrue(status["installed"])
        self.assertEqual(status["coverage"], "full")
        self.assertEqual(status["data"]["bytes"], self.data["bytes"])
        self.assertEqual(
            service.lookup("de-DE", "translation", "Baum")["results"][0]["values"], ["tree"]
        )
        self.assertEqual(self.leftovers(), [])

    def test_wrong_asset_digest_replaces_nothing(self):
        before = self.install_core()
        data = pinned(self.data, sha256="0" * 64)
        with self.assertRaises(ChecksumMismatch) as raised:
            install_release_asset(self.repository.path, data)
        self.assertEqual(from_exception(raised.exception).status, 502)
        self.assertEqual(self.repository.path.read_bytes(), before)
        self.assertEqual(self.leftovers(), [])

    def test_wrong_content_digest_replaces_nothing(self):
        before = self.install_core()
        data = pinned(self.data, content_sha256="0" * 64)
        with self.assertRaises(ChecksumMismatch):
            install_release_asset(self.repository.path, data)
        self.assertEqual(self.repository.path.read_bytes(), before)
        self.assertEqual(self.leftovers(), [])

    def test_asset_of_another_version_is_refused(self):
        other = build_release_asset(self.assets, "2026.12.01")
        data = pinned(other, version=RELEASE_VERSION)
        with self.assertRaises(ChecksumMismatch):
            install_release_asset(self.repository.path, data)
        self.assertFalse(self.repository.path.exists())

    def test_truncated_download_fails(self):
        data = pinned(self.data, bytes=self.data["bytes"] + 10)
        with self.assertRaises(DownloadFailed):
            install_release_asset(self.repository.path, data)
        self.assertFalse(self.repository.path.exists())
        self.assertEqual(self.leftovers(), [])

    def test_oversized_download_is_cut_off(self):
        data = pinned(self.data, bytes=self.data["bytes"] // 2)
        with self.assertRaises(DownloadFailed):
            install_release_asset(self.repository.path, data)
        self.assertFalse(self.repository.path.exists())

    def test_unreachable_url_fails_as_download(self):
        data = pinned(self.data, url=(self.assets / "missing.gz").as_uri())
        with self.assertRaises(DownloadFailed):
            install_release_asset(self.repository.path, data)

    def test_unpublished_data_fails_without_network(self):
        service = self.service(None, opener=must_not_download)
        status = service.status()
        self.assertEqual(
            status["data"],
            {"available": False, "reason": "not_published", "version": None, "bytes": None},
        )
        self.assertFalse(status["installed"])
        with self.assertRaises(DataNotPublished) as raised:
            service.install()
        error = from_exception(raised.exception)
        self.assertEqual((error.status, error.code), (409, "writing_assistance.data_not_published"))
        self.assertFalse(raised.exception.retryable)
        self.assertFalse(self.repository.path.exists())
        self.assertEqual(self.leftovers(), [])

    def free_space(self, free):
        usage = shutil.disk_usage(self.data_dir.parent)._replace(free=free)
        return mock.patch("shutil.disk_usage", return_value=usage)

    def test_too_little_space_fails_before_any_download(self):
        data = pinned(self.data, unpacked_bytes=1000)
        needed = data["bytes"] + 1000
        with self.free_space(needed - 1):
            with self.assertRaises(InsufficientSpace) as raised:
                install_release_asset(self.repository.path, data, opener=must_not_download)
        error = from_exception(raised.exception)
        self.assertEqual((error.status, error.code), (409, "writing_assistance.insufficient_space"))
        self.assertFalse(raised.exception.retryable)
        self.assertEqual(raised.exception.params, {"needed": needed, "free": needed - 1})
        self.assertFalse(self.repository.path.exists())
        self.assertEqual(self.leftovers(), [])

    def test_exactly_enough_space_installs(self):
        data = pinned(self.data, unpacked_bytes=1000)
        with self.free_space(data["bytes"] + 1000):
            result = install_release_asset(self.repository.path, data)
        self.assertEqual(result["version"], RELEASE_VERSION)
        self.assertTrue(self.repository.path.exists())

    def test_the_old_database_counts_towards_the_peak(self):
        self.install_core()
        old = self.repository.path.stat().st_size
        data = pinned(self.data, unpacked_bytes=1000)
        with self.free_space(data["bytes"] + 1000 + old - 1):
            with self.assertRaises(InsufficientSpace):
                install_release_asset(self.repository.path, data, opener=must_not_download)

    def test_an_unpinned_unpacked_size_is_estimated_from_the_asset(self):
        self.assertNotIn("unpacked_bytes", self.data)
        need = self.data["bytes"] * (1 + UNPACK_FACTOR_ESTIMATE)
        self.assertEqual(required_space(self.data, self.repository.path), need)

    def test_unpublished_data_skips_the_space_check(self):
        with mock.patch("shutil.disk_usage", side_effect=AssertionError("no check expected")):
            with self.assertRaises(DataNotPublished):
                install_release_asset(self.repository.path, None, opener=must_not_download)

    def test_registry_ships_without_a_published_release(self):
        # 3.25.0 (D-76): no data release exists yet, so none may be pinned.
        self.assertIsNone(registry.DATA)
        self.assertEqual(registry.MANIFEST_VERSION, registry.CORE_VERSION)
        service = WritingAssistanceService(
            self.repository,
            ReleaseWritingAssistanceInstaller(self.repository.path, opener=must_not_download),
            UnavailableGrammar(self.data_dir),
        )
        self.assertEqual(service.status()["data"]["reason"], "not_published")
        with self.assertRaises(DataNotPublished):
            service.install()

    def test_second_install_while_one_runs_gets_409(self):
        started = threading.Event()
        release = threading.Event()
        body = self.asset.read_bytes()

        class Slow(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body[:10])
                self.wfile.flush()
                started.set()
                release.wait(10)
                self.wfile.write(body[10:])

            def log_message(self, format: str, *args: Any) -> None:
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Slow)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        data = pinned(self.data, url=f"http://127.0.0.1:{server.server_address[1]}/asset.gz")
        outcome = {}

        def first():
            try:
                outcome["result"] = install_release_asset(self.repository.path, data)
            except Exception as exc:  # reported through the assertion below
                outcome["error"] = exc

        worker = threading.Thread(target=first)
        worker.start()
        self.assertTrue(started.wait(10))
        try:
            with self.assertRaises(InstallInProgress) as raised:
                install_release_asset(self.repository.path, data, opener=must_not_download)
        finally:
            release.set()
            worker.join(10)
        error = from_exception(raised.exception)
        self.assertEqual(
            (error.status, error.code), (409, "writing_assistance.install_in_progress")
        )
        self.assertTrue(raised.exception.retryable)
        self.assertEqual(outcome, {"result": {"version": RELEASE_VERSION, "entries": 2}})
        self.assertEqual(self.leftovers(), [])
        # The lock is free again once the first install is done.
        install_release_asset(self.repository.path, self.data)


if __name__ == "__main__":
    unittest.main()
