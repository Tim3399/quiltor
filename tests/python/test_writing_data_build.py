# pyright: strict
"""The writing-data build tool (tools/writing-data/build.py) against fixture sources.

Nothing here touches the network: sources are served from file:// URLs or, for the
conditional request, from a server on the loopback interface.
"""

from __future__ import annotations

import gzip
import http.server
import json
import shutil
import sqlite3
import tempfile
import threading
import unittest
import zipfile
from contextlib import closing
from pathlib import Path
from typing import Any, cast

from quiltor.infrastructure.persistence.writing_assistance import (
    SCHEMA,
    SQLiteWritingAssistanceRepository,
    initialize,
    insert,
    insert_form,
    sources,
)
from quiltor.infrastructure.persistence.writing_assistance import (
    lookup as lookup_rows,  # pyright: ignore[reportUnknownVariableType] - returns list[dict]
)
from quiltor.infrastructure.writing_assistance.installer import CoreWritingAssistanceInstaller
from quiltor.modules.writing_assistance.grammar import UnavailableGrammar
from quiltor.modules.writing_assistance.providers import (
    parse_openthesaurus,
    parse_wiktionary,
    wiktionary_forms,
)
from quiltor.modules.writing_assistance.registry import MANIFEST_VERSION
from quiltor.modules.writing_assistance.service import WritingAssistanceService
from tests.python.module_loader import load_module_from_path

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests" / "python" / "fixtures" / "writing-data"

tool = load_module_from_path("writing_data_build", ROOT / "tools" / "writing-data" / "build.py")


def lookup(path: Path, language: str, mode: str, query: str) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], lookup_rows(path, language, mode, query))


def fixture_sources(directory: Path) -> dict[str, dict[str, str]]:
    """Pack the fixture text the way upstream ships it and point file:// URLs at it."""
    upstream = directory / "upstream"
    upstream.mkdir()
    wiktionary = upstream / "raw-wiktextract-data.jsonl.gz"
    with gzip.GzipFile(wiktionary, "wb", mtime=0) as packed:
        packed.write((FIXTURES / "dewiktionary.jsonl").read_bytes())
    thesaurus = upstream / "OpenThesaurus-Textversion.zip"
    with zipfile.ZipFile(thesaurus, "w") as archive:
        info = zipfile.ZipInfo("openthesaurus.txt", date_time=(2026, 10, 30, 0, 0, 0))
        archive.writestr(info, (FIXTURES / "openthesaurus.txt").read_bytes())
    return {
        "dewiktionary": {
            "url": wiktionary.as_uri(),
            "archive_name": "source-dewiktionary-{tag}.jsonl.gz",
        },
        "openthesaurus": {
            "url": thesaurus.as_uri(),
            "archive_name": "source-openthesaurus-{tag}.zip",
        },
    }


class BuildCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.sources = self.root / "sources"
        self.lock = tool.fetch(self.sources, sources=fixture_sources(self.root))

    def tearDown(self) -> None:
        self.temp.cleanup()

    def build(self, name: str = "writing.sqlite3", version: str = MANIFEST_VERSION) -> Path:
        output = self.root / name
        tool.build(self.lock, self.sources, output, version)
        return output


class FetchTests(BuildCase):
    def test_lock_records_each_downloaded_file(self) -> None:
        for name in ("dewiktionary", "openthesaurus"):
            entry = self.lock["sources"][name]
            path = self.sources / entry["file"]
            self.assertEqual(entry["sha256"], tool.sha256_file(path))
            self.assertEqual(entry["bytes"], path.stat().st_size)
            self.assertTrue(entry["upstream_url"].startswith("file:"))
            self.assertRegex(entry["fetched_at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")

    def test_archive_url_follows_the_release_base(self) -> None:
        lock = tool.fetch(
            self.root / "again",
            sources=fixture_sources(Path(tempfile.mkdtemp(dir=self.root))),
            archive_base="https://example.invalid/releases/download/writing-data-2026.11.03/",
        )
        entry = lock["sources"]["openthesaurus"]
        self.assertEqual(
            entry["archive_url"],
            "https://example.invalid/releases/download/writing-data-2026.11.03/"
            + entry["archive_name"],
        )
        self.assertIsNone(self.lock["sources"]["openthesaurus"]["archive_url"])

    def test_build_refuses_a_file_that_differs_from_the_lock(self) -> None:
        path = self.sources / self.lock["sources"]["openthesaurus"]["file"]
        path.write_bytes(path.read_bytes() + b"\0")
        with self.assertRaisesRegex(ValueError, "checksum mismatch: openthesaurus"):
            self.build()

    def test_unchanged_upstream_keeps_the_previous_lock_entry(self) -> None:
        payload = b"unchanged"
        hits: list[str | None] = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                hits.append(self.headers.get("If-None-Match"))
                if self.headers.get("If-None-Match") == '"v1"':
                    self.send_response(304)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("ETag", '"v1"')
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, format: str, *args: Any) -> None:
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            url = f"http://127.0.0.1:{server.server_address[1]}/export.zip"
            sources = {
                "openthesaurus": {"url": url, "archive_name": "source-openthesaurus-{tag}.zip"}
            }
            first = tool.fetch(self.root / "http", sources=sources)
            second = tool.fetch(self.root / "http", first, sources=sources)
        finally:
            server.shutdown()
            server.server_close()
        self.assertEqual(hits, [None, '"v1"'])
        self.assertEqual(first["sources"]["openthesaurus"]["etag"], '"v1"')
        self.assertEqual(
            first["sources"]["openthesaurus"]["archive_name"], "source-openthesaurus-v1.zip"
        )
        self.assertEqual(second, first)


class DictionaryBuildTests(BuildCase):
    def setUp(self) -> None:
        super().setUp()
        self.database = self.build()

    def rows(self, sql: str, *params: object) -> list[tuple[Any, ...]]:
        with closing(sqlite3.connect(self.database)) as conn:
            return conn.execute(sql, params).fetchall()

    def test_database_is_schema_2_with_license_metadata(self) -> None:
        metadata = dict(self.rows("SELECT key, value FROM metadata"))
        self.assertEqual(metadata["schema"], "2")
        self.assertEqual(metadata["coverage"], "full")
        self.assertEqual(metadata["version"], MANIFEST_VERSION)
        self.assertEqual(metadata["license"], "CC-BY-SA-4.0")
        self.assertEqual(metadata["license_url"], "https://creativecommons.org/licenses/by-sa/4.0/")
        self.assertIn("de.wiktionary.org", metadata["attribution"])
        self.assertIn("openthesaurus.de", metadata["attribution"])

    def test_database_records_each_source_with_url_version_date_and_license(self) -> None:
        recorded = sources(self.database)
        self.assertEqual([item["name"] for item in recorded], ["dewiktionary", "openthesaurus"])
        for item in recorded:
            locked = self.lock["sources"][item["name"]]
            self.assertEqual(item["url"], locked["upstream_url"])
            self.assertEqual(item["retrieved"], locked["fetched_at"])
            self.assertEqual(item["license"], "CC-BY-SA-4.0")
            self.assertEqual(item["license_url"], "https://creativecommons.org/licenses/by-sa/4.0/")

    def test_source_version_is_the_upstream_etag(self) -> None:
        lock = json.loads(json.dumps(self.lock))
        lock["sources"]["dewiktionary"]["etag"] = '"6ae3112a-127c5a18"'
        recorded = {item["name"]: item for item in tool.source_metadata(lock)}
        self.assertEqual(recorded["dewiktionary"]["version"], "6ae3112a-127c5a18")
        self.assertEqual(recorded["openthesaurus"]["version"], "")

    def test_source_without_a_recorded_license_cannot_be_built(self) -> None:
        lock = json.loads(json.dumps(self.lock))
        lock["sources"]["freedict"] = lock["sources"]["openthesaurus"]
        with self.assertRaisesRegex(ValueError, "no license recorded for source"):
            tool.source_metadata(lock)

    def test_common_words_find_a_dictionary_entry(self) -> None:
        words = [
            line.strip()
            for line in (FIXTURES / "common-words.txt").read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.startswith("#")
        ]
        self.assertEqual(len(words), 50)
        missing = [word for word in words if not lookup(self.database, "de-DE", "dictionary", word)]
        self.assertEqual(missing, [])
        for word in ("schnell", "Haus", "gehen", "ging", "Häuser"):
            self.assertTrue(lookup(self.database, "de-DE", "synonyms", word), word)
        for word in ("Haus", "Bäume", "kam", "dunkel"):
            self.assertTrue(lookup(self.database, "de-DE", "translation", word), word)
        for word in ("HAUS", "häuser", "GING"):
            self.assertTrue(lookup(self.database, "de-DE", "dictionary", word), word)

    def test_service_reads_the_built_database_as_full_and_current(self) -> None:
        data = self.root / "data"
        repository = SQLiteWritingAssistanceRepository(data)
        shutil.copyfile(self.database, repository.path)
        service = WritingAssistanceService(
            repository, CoreWritingAssistanceInstaller(repository.path), UnavailableGrammar(data)
        )
        status = cast(dict[str, Any], service.status())  # pyright: ignore[reportUnknownMemberType]
        self.assertEqual(
            (status["installed"], status["stale"], status["coverage"]), (True, False, "full")
        )
        results = cast(
            list[dict[str, Any]],
            service.lookup("de-DE", "dictionary", "ging")["results"],  # pyright: ignore[reportUnknownMemberType]
        )
        self.assertEqual(
            [row["meaning"] for row in results], ["sich zu Fuß fortbewegen", "funktionieren"]
        )

    def test_english_translations_and_their_reverse_index(self) -> None:
        house = lookup(self.database, "de-DE", "translation", "Haus")
        self.assertEqual(house[0]["values"], ["house", "home"])
        self.assertEqual(
            lookup(self.database, "en-GB", "translation", "light")[0]["values"], ["Licht", "hell"]
        )
        self.assertEqual(lookup(self.database, "en-GB", "translation", "xhaus"), [])

    def test_forms_skip_lemma_multiword_and_table_cells(self) -> None:
        forms = {form for (form,) in self.rows("SELECT form FROM forms WHERE lemma='sagen'")}
        self.assertEqual(forms, {"sage", "sagst", "sagt", "sagte"})
        self.assertEqual(self.rows("SELECT * FROM forms WHERE form='deklination'"), [])
        self.assertEqual(self.rows("SELECT * FROM forms WHERE lemma IN ('und','house')"), [])

    def test_only_german_records_with_glosses_become_entries(self) -> None:
        self.assertEqual(
            self.rows(
                "SELECT * FROM entries WHERE language='de-DE' AND lemma IN ('house','Ohnebedeutung')"
            ),
            [],
        )

    def test_entries_are_stored_sorted(self) -> None:
        keys = self.rows("SELECT language, mode, query, lemma FROM entries ORDER BY id")
        self.assertEqual(keys, sorted(keys))


class ReproducibilityTests(BuildCase):
    def test_two_builds_are_byte_identical(self) -> None:
        first, second = self.build("a.sqlite3"), self.build("b.sqlite3")
        self.assertEqual(first.read_bytes(), second.read_bytes())
        self.assertEqual(tool.content_sha256(first), tool.content_sha256(second))
        counts = tool.build(self.lock, self.sources, self.root / "c.sqlite3", MANIFEST_VERSION)
        packs = [
            tool.pack(
                path, self.root / f"pack-{path.stem}", MANIFEST_VERSION, self.lock, counts, "abc123"
            )
            for path in (first, second)
        ]
        self.assertEqual(packs[0], packs[1])
        assets = [
            self.root / f"pack-{path.stem}" / f"writing-{MANIFEST_VERSION}.sqlite3.gz"
            for path in (first, second)
        ]
        self.assertEqual(assets[0].read_bytes(), assets[1].read_bytes())

    def test_content_hash_ignores_sqlite_file_layout(self) -> None:
        built = self.build()
        relaid = self.root / "relaid.sqlite3"
        with closing(sqlite3.connect(built)) as conn:
            conn.execute("PRAGMA page_size=8192")
            conn.execute("VACUUM INTO ?", (str(relaid),))
        raw = bytearray(relaid.read_bytes())
        raw[96:100] = b"\x00\x00\x00\x01"  # SQLITE_VERSION_NUMBER of the last writer
        relaid.write_bytes(bytes(raw))
        self.assertNotEqual(tool.sha256_file(built), tool.sha256_file(relaid))
        self.assertEqual(tool.content_sha256(built), tool.content_sha256(relaid))

    def test_content_hash_ignores_physical_row_order(self) -> None:
        built = self.build()
        shuffled = self.root / "shuffled.sqlite3"
        with closing(sqlite3.connect(built)) as source:
            forms = source.execute("SELECT language, form, lemma FROM forms").fetchall()
            entries = source.execute(
                "SELECT language, mode, query, lemma, part_of_speech, meaning, values_json, source FROM entries"
            ).fetchall()
        conn = initialize(
            shuffled,
            MANIFEST_VERSION,
            "full",
            {
                "license": tool.LICENSE,
                "license_url": tool.LICENSE_URL,
                "attribution": tool.ATTRIBUTION,
            },
            tool.source_metadata(self.lock),
        )
        with closing(conn), conn:
            for language, mode, query, lemma, pos, meaning, values, source in reversed(entries):
                insert(conn, language, mode, query, lemma, pos, meaning, json.loads(values), source)
            for language, form, lemma in reversed(forms):
                insert_form(conn, language, form, lemma)
        self.assertEqual(tool.content_sha256(built), tool.content_sha256(shuffled))

    def test_canonical_dump_starts_with_the_fixed_ddl(self) -> None:
        self.assertEqual(next(iter(tool.canonical_lines(self.build()))), SCHEMA.encode("utf-8"))

    def test_gzip_header_has_no_timestamp_and_no_file_name(self) -> None:
        database = self.build()
        counts = tool.build(self.lock, self.sources, self.root / "c.sqlite3", MANIFEST_VERSION)
        tool.pack(database, self.root / "out", "v", self.lock, counts, "abc123")
        header = (self.root / "out" / "writing-v.sqlite3.gz").read_bytes()[:10]
        self.assertEqual(header[3], 0, "FLG: no FNAME, no FCOMMENT")
        self.assertEqual(header[4:8], bytes(4), "MTIME")

    def test_content_hash_covers_sources(self) -> None:
        built = self.build()
        before = tool.content_sha256(built)
        with closing(sqlite3.connect(built)) as conn, conn:
            conn.execute(
                "UPDATE metadata SET value=replace(value, 'CC-BY-SA-4.0', 'GPL-2.0') WHERE key='sources'"
            )
        self.assertNotEqual(tool.content_sha256(built), before)

    def test_content_hash_covers_forms(self) -> None:
        built = self.build()
        before = tool.content_sha256(built)
        with closing(sqlite3.connect(built)) as conn, conn:
            conn.execute("DELETE FROM forms WHERE form='ging'")
        self.assertNotEqual(tool.content_sha256(built), before)


class PackTests(BuildCase):
    def test_manifest_and_license_sit_next_to_the_asset(self) -> None:
        database = self.build()
        counts = tool.build(self.lock, self.sources, self.root / "other.sqlite3", MANIFEST_VERSION)
        out = self.root / "release"
        manifest = tool.pack(database, out, "2026.11.03", self.lock, counts, "abc123")
        asset = out / "writing-2026.11.03.sqlite3.gz"
        self.assertEqual(manifest["asset"]["sha256"], tool.sha256_file(asset))
        self.assertEqual(manifest["asset"]["bytes"], asset.stat().st_size)
        self.assertEqual(gzip.decompress(asset.read_bytes()), database.read_bytes())
        self.assertEqual(manifest["sqlite"]["contentSha256"], tool.content_sha256(database))
        self.assertEqual(manifest["dictionarySchema"], 2)
        self.assertEqual(manifest["sources"], self.lock["sources"])
        self.assertEqual(manifest["rows"]["forms"], counts["forms"])
        written = json.loads(
            (out / "writing-data-2026.11.03.manifest.json").read_text(encoding="utf-8")
        )
        self.assertEqual(written, manifest)
        self.assertIn("CC BY-SA 4.0", (out / "LICENSE-DATA.txt").read_text(encoding="utf-8"))

    def test_manifest_fields_match_the_contract(self) -> None:
        schema = json.loads(
            (ROOT / "contracts" / "writing-data" / "manifest" / "v1.schema.json").read_text(
                encoding="utf-8"
            )
        )
        database = self.build()
        counts = tool.build(self.lock, self.sources, self.root / "other.sqlite3", MANIFEST_VERSION)
        manifest = tool.pack(
            database, self.root / "release", "2026.11.03", self.lock, counts, "abc123"
        )
        self.assertEqual(set(manifest), set(schema["required"]))
        for key in ("asset", "sqlite", "rows"):
            self.assertEqual(set(manifest[key]), set(schema["properties"][key]["required"]), key)
        source_keys = set(schema["$defs"]["source"]["required"])
        for name, entry in manifest["sources"].items():
            self.assertEqual(set(entry), source_keys, name)

    def test_command_line_runs_all_three_steps(self) -> None:
        lock_path = self.root / "sources.lock.json"
        lock_path.write_text(json.dumps(self.lock), encoding="utf-8")
        database = self.root / "cli" / "writing.sqlite3"
        self.assertEqual(
            tool.main(
                [
                    "build",
                    "--sources",
                    str(self.sources),
                    "--lock",
                    str(lock_path),
                    "--output",
                    str(database),
                    "--version",
                    "2026.11.03",
                ]
            ),
            0,
        )
        self.assertEqual(
            tool.main(
                [
                    "pack",
                    "--database",
                    str(database),
                    "--lock",
                    str(lock_path),
                    "--out",
                    str(self.root / "cli-out"),
                    "--version",
                    "2026.11.03",
                    "--tool-commit",
                    "abc123",
                ]
            ),
            0,
        )
        self.assertTrue((self.root / "cli-out" / "writing-2026.11.03.sqlite3.gz").is_file())


class ReverseIndexTests(unittest.TestCase):
    def test_an_english_word_lists_each_german_lemma_once_in_source_order(self) -> None:
        with closing(sqlite3.connect(":memory:")) as stage:
            stage.execute("CREATE TABLE reverse(seq INTEGER PRIMARY KEY, en TEXT, de TEXT)")
            stage.executemany(
                "INSERT INTO reverse(en, de) VALUES(?, ?)",
                [("light", "Licht"), ("dark", "dunkel"), ("light", "hell"), ("light", "Licht")],
            )
            rows = list(tool._reverse_rows(stage))  # pyright: ignore[reportPrivateUsage]
        self.assertEqual(
            [(row["query"], row["values"]) for row in rows],
            [("dark", ["dunkel"]), ("light", ["Licht", "hell"])],
        )


class FormFallbackLimitTests(unittest.TestCase):
    """The form fallback from D0 returns at most 50 rows across all lemmas."""

    def test_fallback_is_capped_at_fifty_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "writing.sqlite3"
            with closing(initialize(path, MANIFEST_VERSION, "full")) as conn, conn:
                for lemma in ("eins", "zwei"):
                    for index in range(30):
                        insert(
                            conn,
                            "de-DE",
                            "dictionary",
                            lemma,
                            lemma,
                            "",
                            f"Sinn {index}",
                            [],
                            "wiktionary",
                        )
                    insert_form(conn, "de-DE", "form", lemma)
            self.assertEqual(len(lookup(path, "de-DE", "dictionary", "form")), 50)


class ParserTests(unittest.TestCase):
    def test_openthesaurus_drops_labels_wherever_they_stand(self) -> None:
        rows = list(parse_openthesaurus(["gehen;(sich) fortbewegen;Kumpel (ugs.);(ugs.)\n"]))
        self.assertEqual([row["query"] for row in rows], ["gehen", "fortbewegen", "Kumpel"])
        self.assertEqual(rows[0]["values"], ["fortbewegen", "Kumpel"])

    def test_wiktionary_reads_english_translations_only(self) -> None:
        record = {
            "lang_code": "de",
            "word": "Haus",
            "pos": "noun",
            "senses": [
                {"glosses": ["Gebäude"], "translations": [{"lang_code": "en", "word": "building"}]}
            ],
            "translations": [
                {"lang_code": "en", "word": "house"},
                {"lang_code": "fr", "word": "maison"},
                {"lang_code": "en", "word": "house"},
            ],
        }
        rows = list(parse_wiktionary([json.dumps(record)]))
        self.assertEqual([row["mode"] for row in rows], ["dictionary", "translation"])
        self.assertEqual(rows[1]["values"], ["house", "building"])

    def test_wiktionary_limits_glosses_and_meaning_length(self) -> None:
        record = {
            "lang_code": "de",
            "word": "Wort",
            "pos": "noun",
            "senses": [{"glosses": ["x" * 900]} for _ in range(12)],
        }
        rows = list(parse_wiktionary([json.dumps(record)]))
        self.assertEqual(len(rows), 8)
        self.assertEqual(len(rows[0]["meaning"]), 500)

    def test_forms_only_for_nouns_verbs_and_adjectives(self) -> None:
        def record(pos: str) -> dict[str, Any]:
            return {"lang_code": "de", "word": "w", "pos": pos, "forms": [{"form": "wf"}]}

        self.assertEqual(wiktionary_forms(record("verb")), ["wf"])
        self.assertEqual(wiktionary_forms(record("adv")), [])
        self.assertEqual(wiktionary_forms({**record("noun"), "lang_code": "en"}), [])


if __name__ == "__main__":
    unittest.main()
