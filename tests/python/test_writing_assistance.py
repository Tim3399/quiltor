import io
import json
import sqlite3
import tempfile
import unittest
import xml.etree.ElementTree as ET
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from quiltor.infrastructure.writing_assistance.installer import (
    CoreWritingAssistanceInstaller,
    validate_checksum,
)
from quiltor.infrastructure.persistence.writing_assistance import (
    SQLiteWritingAssistanceRepository,
)
from quiltor.modules.writing_assistance.providers import (
    parse_freedict,
    parse_openthesaurus,
    parse_wiktionary,
)
from quiltor.modules.writing_assistance.service import WritingAssistanceService
from quiltor.modules.writing_assistance.grammar import UnavailableGrammar


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
        root.find("entry").append(UnreadablePos("pos"))
        with patch(
            "quiltor.modules.writing_assistance.providers.freedict.ET.parse",
            return_value=ET.ElementTree(root),
        ):
            (record,) = parse_freedict(io.BytesIO(), "de-DE", "en-GB")
        self.assertEqual(record["part_of_speech"], "n common noun")


if __name__ == "__main__":
    unittest.main()
