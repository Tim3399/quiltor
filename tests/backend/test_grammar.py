import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.language.grammar import LanguageToolManager


class _Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


class GrammarTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.manager = LanguageToolManager(Path(self.temp.name))

    def tearDown(self):
        self.manager.close()
        self.temp.cleanup()

    def test_external_provider_requires_explicit_opt_in_and_sends_nothing(self):
        with (
            patch.dict(
                os.environ, {"QUILTOR_LANGUAGETOOL_URL": "https://example.invalid"}, clear=False
            ),
            patch("urllib.request.urlopen") as request,
        ):
            os.environ.pop("QUILTOR_LANGUAGETOOL_EXTERNAL_OPT_IN", None)
            with self.assertRaises(PermissionError):
                self.manager.check("de-DE", "Das ist falsch.", [])
            request.assert_not_called()

    def test_matches_are_normalized_and_project_words_are_filtered(self):
        payload = {
            "matches": [
                {
                    "offset": 0,
                    "length": 5,
                    "message": "Eigenname",
                    "replacements": [{"value": "Lyrra"}],
                    "rule": {"id": "SPELL", "category": {"name": "Rechtschreibung"}},
                },
                {
                    "offset": 10,
                    "length": 5,
                    "message": "Fehler",
                    "replacements": [{"value": "ging"}],
                    "rule": {"id": "GRAMMAR", "category": {"name": "Grammatik"}},
                },
            ]
        }
        environment = {
            "QUILTOR_LANGUAGETOOL_URL": "http://127.0.0.1:9999",
            "QUILTOR_LANGUAGETOOL_EXTERNAL_OPT_IN": "1",
        }
        with (
            patch.dict(os.environ, environment, clear=False),
            patch(
                "urllib.request.urlopen", return_value=_Response(json.dumps(payload).encode())
            ) as request,
        ):
            result = self.manager.check("de-DE", "Lyrra ist gegt.", ["Lyrra"])
        self.assertEqual(len(result["issues"]), 1)
        self.assertEqual(result["issues"][0]["ruleId"], "GRAMMAR")
        self.assertEqual(result["issues"][0]["replacements"], ["ging"])
        sent = request.call_args.args[0]
        self.assertNotIn("Lyrra", repr(sent.headers))

    def test_invalid_or_oversized_text_is_rejected_before_a_request(self):
        with patch("urllib.request.urlopen") as request:
            for language, text in (("en-US", "text"), ("de-DE", ""), ("de-DE", "x" * 200_001)):
                with self.assertRaises(ValueError):
                    self.manager.check(language, text, [])
            request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
