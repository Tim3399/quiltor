import io
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from backend.language.installer import validate_checksum
from backend.language.providers import parse_freedict, parse_openthesaurus, parse_wiktionary
from backend.language.service import LanguageService


class LanguageServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = LanguageService(Path(self.temp.name))

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

        with closing(sqlite3.connect(self.service.path)) as conn:
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
        self.assertEqual(list(parse_freedict(tei, "de-DE", "en-GB"))[0]["values"], ["house"])

    def test_checksum_validation_rejects_stale_data(self):
        path = Path(self.temp.name) / "source"
        path.write_bytes(b"valid")
        self.assertTrue(
            validate_checksum(
                path, "sha256:ec654fac9599f62e79e2706abef23dfb7c07c08185aa86db4d8695f0b718d1b3"
            )
        )
        self.assertFalse(validate_checksum(path, "sha256:" + "0" * 64))


if __name__ == "__main__":
    unittest.main()
