import io
import json
import sqlite3
import tempfile
import unittest
import xml.etree.ElementTree as ET
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from quiltor.infrastructure.persistence.writing_assistance import (
    DICTIONARY_SCHEMA,
    SQLiteWritingAssistanceRepository,
    initialize,
    insert,
    insert_form,
)
from quiltor.infrastructure.writing_assistance.installer import (
    CoreWritingAssistanceInstaller,
    install_from_sources,
    validate_checksum,
)
from quiltor.modules.writing_assistance.grammar import UnavailableGrammar
from quiltor.modules.writing_assistance.providers import (
    parse_freedict,
    parse_openthesaurus,
    parse_wiktionary,
)
from quiltor.modules.writing_assistance.registry import MANIFEST_VERSION
from quiltor.modules.writing_assistance.service import (
    DICTIONARY_SCHEMA as SERVICE_DICTIONARY_SCHEMA,
)
from quiltor.modules.writing_assistance.service import WritingAssistanceService
from tests.python.narrowing import present


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
        tei = io.BytesIO(
            b'<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><entry><form><orth>Haus</orth></form><gramGrp><pos>n</pos></gramGrp><sense><cit><quote>house</quote></cit></sense></entry></text></TEI>'
        )
        self.assertEqual(next(iter(parse_freedict(tei, "de-DE", "en-GB")))["values"], ["house"])

    def test_status_reports_coverage_of_the_installed_vocabulary(self):
        self.assertIsNone(self.service.status()["coverage"])
        self.service.install()
        self.assertEqual(self.service.status()["coverage"], "core")

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

    def test_import_from_upstream_sources_reports_full_coverage(self):
        import gzip
        import hashlib
        import tarfile
        import zipfile

        base = Path(self.temp.name)
        thesaurus = base / "thesaurus.zip"
        with zipfile.ZipFile(thesaurus, "w") as archive:
            archive.writestr("openthesaurus.txt", "schnell;rasch\n")
        wiktionary = base / "wiktionary.jsonl.gz"
        with gzip.open(wiktionary, "wt", encoding="utf-8") as handle:
            handle.write(
                json.dumps(
                    {
                        "lang_code": "de",
                        "word": "Baum",
                        "pos": "noun",
                        "senses": [{"glosses": ["Pflanze"]}],
                    }
                )
                + "\n"
            )
        tei = (
            b'<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><entry><form><orth>Baum</orth></form>'
            b"<sense><cit><quote>tree</quote></cit></sense></entry></text></TEI>"
        )
        sources = {"openthesaurus": thesaurus, "wiktionary": wiktionary}
        for name in ("freedict-deu-eng", "freedict-eng-deu"):
            path = base / f"{name}.tar.bz2"
            with tarfile.open(path, "w:bz2") as archive:
                info = tarfile.TarInfo("dict/dict.tei")
                info.size = len(tei)
                archive.addfile(info, io.BytesIO(tei))
            sources[name] = path
        manifest = {
            name: {"checksum": "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()}
            for name, path in sources.items()
        }
        install_from_sources(self.repository.path, sources, manifest)
        self.assertEqual(self.service.status()["coverage"], "full")

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


class FreeDictParserTests(unittest.TestCase):
    def test_blank_quotes_fall_back_to_ordered_unique_translations(self):
        source = io.BytesIO(b"""
            <TEI xmlns="http://www.tei-c.org/ns/1.0"><text><entry>
              <form><orth/><orth> \n </orth><orth>  Haus <hi>am</hi> Meer </orth>
                <orth>Heim</orth><orth>Haus am Meer</orth></form>
              <gramGrp><pos/><pos> \t </pos><pos> n <hi>common</hi> noun </pos>
                <pos>ignored</pos></gramGrp>
              <sense><quote/><quote> \n </quote><tr> house <hi>by</hi> the sea </tr>
                <tr/><tr>home</tr><tr>house by the sea</tr><tr> \t </tr></sense>
            </entry><entry><orth>no translation</orth><quote/><tr/></entry>
            <entry><orth/><quote>no head</quote></entry></text></TEI>
        """)
        records = list(parse_freedict(source, "de-DE", "en-GB"))
        self.assertEqual(
            records,
            [
                {
                    "language": "de-DE",
                    "mode": "translation",
                    "query": head,
                    "lemma": head,
                    "part_of_speech": "n common noun",
                    "meaning": "",
                    "values": ["house by the sea", "home"],
                    "source": "freedict-de-DE-en-GB",
                }
                for head in ("Haus am Meer", "Heim", "Haus am Meer")
            ],
        )

    def test_nonblank_quotes_suppress_fallback_translations(self):
        source = io.BytesIO(b"""
            <TEI><entry><orth>Haus</orth><quote/><quote> house <hi>by</hi> the sea </quote>
              <quote>home</quote><quote>house by the sea</quote><quote> \t </quote>
              <tr>ignored fallback</tr></entry></TEI>
        """)
        (record,) = parse_freedict(source, "de-DE", "en-GB")
        self.assertEqual(record["values"], ["house by the sea", "home"])
        self.assertEqual(record["part_of_speech"], "")

    def test_each_head_has_independent_values_including_later_results(self):
        source = io.BytesIO(b"""
            <TEI><entry><orth>Haus</orth><orth>Heim</orth><orth>Haus</orth>
              <quote>house</quote><quote>home</quote><quote>house</quote></entry></TEI>
        """)
        records = parse_freedict(source, "de-DE", "en-GB")
        first = next(records)
        second = next(records)
        self.assertIsNot(first["values"], second["values"])
        first["values"].append("changed")
        self.assertEqual(second["values"], ["house", "home"])
        third = next(records)
        self.assertIsNot(third["values"], first["values"])
        self.assertIsNot(third["values"], second["values"])
        self.assertEqual(third["values"], ["house", "home"])
        self.assertEqual(
            [first["query"], second["query"], third["query"]], ["Haus", "Heim", "Haus"]
        )
        self.assertEqual(list(records), [])

    def test_pos_stops_reading_after_first_nonblank_value(self):
        class UnreadablePos(ET.Element):
            def itertext(self):
                raise AssertionError("Later POS text must remain unread")

        root = ET.fromstring("""
            <TEI><entry><orth>Haus</orth><pos/><pos> \t </pos>
              <pos> n <hi>common</hi> noun </pos><quote>house</quote></entry></TEI>
        """)
        present(root.find("entry")).append(UnreadablePos("pos"))
        with patch(
            "quiltor.modules.writing_assistance.providers.freedict.ET.parse",
            return_value=ET.ElementTree(root),
        ):
            (record,) = parse_freedict(io.BytesIO(), "de-DE", "en-GB")
        self.assertEqual(record["part_of_speech"], "n common noun")


if __name__ == "__main__":
    unittest.main()
