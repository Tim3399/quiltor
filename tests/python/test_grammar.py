import io
import json
import os
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from typing import ClassVar
from unittest.mock import patch

from quiltor.delivery.http import errors as http_errors
from quiltor.infrastructure.writing_assistance import LanguageToolManager
from quiltor.modules.writing_assistance.errors import (
    ChecksumMismatch,
    DownloadFailed,
    GrammarStartFailed,
    GrammarUnavailable,
    JavaMissing,
)

_JAVA = "quiltor.infrastructure.writing_assistance.languagetool._java_version"
_SUPERVISOR = "quiltor.infrastructure.writing_assistance.languagetool.process_supervisor"


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


class _ExitedProcess:
    def poll(self):
        return 1

    def terminate(self):
        pass

    def wait(self, timeout=None):
        return 1


class GrammarErrorCodeTests(unittest.TestCase):
    """Each grammar failure reaches the client with its own code, and nothing
    else: no exception text, no path."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.manager = LanguageToolManager(Path(self.temp.name))

    def tearDown(self):
        self.manager.close()
        self.temp.cleanup()

    def assertWire(self, error, status, code, retryable):
        response = http_errors.from_exception(error)
        self.assertEqual(response.status, status)
        self.assertEqual(response.payload()["error"]["code"], code)
        self.assertEqual(response.payload()["error"]["retryable"], retryable)
        self.assertNotIn(self.temp.name, json.dumps(response.payload()))

    def test_install_without_java_is_java_missing(self):
        with patch(_JAVA, return_value=None), patch("urllib.request.urlopen") as request:
            with self.assertRaises(JavaMissing) as raised:
                self.manager.install()
            request.assert_not_called()
        self.assertWire(raised.exception, 409, "writing_assistance.java_missing", False)
        self.assertEqual(raised.exception.params, {"required": 17})

    def test_unreachable_download_is_download_failed(self):
        import urllib.error

        with (
            patch(_JAVA, return_value=21),
            patch("urllib.request.urlopen", side_effect=urllib.error.URLError("offline")),
        ):
            with self.assertRaises(DownloadFailed) as raised:
                self.manager.install()
        self.assertWire(raised.exception, 502, "writing_assistance.download_failed", True)

    def test_a_download_cut_off_mid_body_is_download_failed(self):
        import http.client

        class _CutOff(_Response):
            def read(self, *_):
                raise http.client.IncompleteRead(b"0123456789", 990)

        self.manager.root.mkdir(parents=True)
        self.manager.server_jar.write_bytes(b"previous")
        with (
            patch(_JAVA, return_value=21),
            patch("urllib.request.urlopen", return_value=_CutOff(b"")),
        ):
            with self.assertRaises(DownloadFailed) as raised:
                self.manager.install()
        self.assertWire(raised.exception, 502, "writing_assistance.download_failed", True)
        self.assertEqual(self.manager.server_jar.read_bytes(), b"previous")

    def test_wrong_archive_is_checksum_mismatch(self):
        with (
            patch(_JAVA, return_value=21),
            patch("urllib.request.urlopen", return_value=_Response(b"not the archive")),
        ):
            with self.assertRaises(ChecksumMismatch) as raised:
                self.manager.install()
        self.assertWire(raised.exception, 502, "writing_assistance.checksum_mismatch", False)

    def test_installed_but_java_missing_is_java_missing_on_check(self):
        self.manager.root.mkdir(parents=True)
        self.manager.server_jar.write_bytes(b"")
        with patch(_JAVA, return_value=None), patch.dict(os.environ, {}, clear=False):
            os.environ.pop("QUILTOR_LANGUAGETOOL_URL", None)
            with self.assertRaises(JavaMissing):
                self.manager.check("de-DE", "Ein Satz.", [])

    def test_not_installed_stays_not_installed_on_check(self):
        with patch(_JAVA, return_value=None), patch.dict(os.environ, {}, clear=False):
            os.environ.pop("QUILTOR_LANGUAGETOOL_URL", None)
            with self.assertRaises(FileNotFoundError):
                self.manager.check("de-DE", "Ein Satz.", [])

    def test_server_that_exits_is_grammar_start_failed(self):
        self.manager.root.mkdir(parents=True)
        self.manager.server_jar.write_bytes(b"")
        self.manager.java = "java"
        supervisor = type("S", (), {"spawn": lambda self, *a, **k: _ExitedProcess()})()
        with (
            patch(_JAVA, return_value=21),
            patch(_SUPERVISOR, return_value=supervisor),
            patch.dict(os.environ, {}, clear=False),
        ):
            os.environ.pop("QUILTOR_LANGUAGETOOL_URL", None)
            with self.assertRaises(GrammarStartFailed) as raised:
                self.manager.check("de-DE", "Ein Satz.", [])
        self.assertWire(raised.exception, 503, "writing_assistance.grammar_start_failed", True)


class GrammarRouteTests(unittest.TestCase):
    def test_check_route_keeps_the_specific_code(self):
        from types import SimpleNamespace

        from quiltor.delivery.http.routes import Request
        from quiltor.delivery.http.routes import writing_assistance as routes

        sent = []

        class Handler:
            def _read_json_body(self):
                return {"language": "de-DE", "text": "Ein Satz.", "customWords": []}

            def send_json(self, payload):
                sent.append("ok")

            def send_exception(self, error):
                sent.append(http_errors.from_exception(error).payload()["error"]["code"])

            def send_api_error(self, status, *, error_code, retryable=None):
                sent.append(error_code)

        def check(language, text, words):
            raise JavaMissing(params={"required": 17})

        app = SimpleNamespace(writing_assistance=SimpleNamespace(check=check))
        routes.check(Handler(), Request(path="/api/writing-assistance/check"), app)
        self.assertEqual(sent, ["writing_assistance.java_missing"])


class ExternalGrammarServerTests(unittest.TestCase):
    """QUILTOR_LANGUAGETOOL_URL with the opt-in replaces the local LanguageTool:
    no Java, no JAR, and failures of that server reach the client as a code."""

    ENABLED: ClassVar[dict[str, str]] = {
        "QUILTOR_LANGUAGETOOL_URL": "http://languagetool:8010/",
        "QUILTOR_LANGUAGETOOL_EXTERNAL_OPT_IN": "1",
    }
    TEXT = "Das ist ein geheimer Satz."

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.manager = LanguageToolManager(Path(self.temp.name))

    def tearDown(self):
        self.manager.close()
        self.temp.cleanup()

    def test_enabled_external_server_makes_grammar_available_without_java(self):
        with patch.dict(os.environ, self.ENABLED, clear=False), patch(_JAVA, return_value=None):
            status = self.manager.status()
        self.assertTrue(status["available"])
        self.assertTrue(status["externalEnabled"])
        self.assertFalse(status["installed"])

    def test_configured_but_not_enabled_server_is_not_available(self):
        with (
            patch.dict(os.environ, {"QUILTOR_LANGUAGETOOL_URL": "http://languagetool:8010"}),
            patch(_JAVA, return_value=None),
        ):
            os.environ.pop("QUILTOR_LANGUAGETOOL_EXTERNAL_OPT_IN", None)
            status = self.manager.status()
        self.assertFalse(status["available"])
        self.assertTrue(status["externalConfigured"])
        self.assertFalse(status["externalEnabled"])

    def test_check_goes_to_the_external_server_and_never_starts_java(self):
        payload = {
            "matches": [
                {
                    "offset": 0,
                    "length": 3,
                    "message": "Fehler",
                    "replacements": [{"value": "Dies"}],
                    "rule": {"id": "R", "category": {"name": "Grammatik"}},
                }
            ]
        }
        with (
            patch.dict(os.environ, self.ENABLED, clear=False),
            patch.object(self.manager, "_local_url", side_effect=AssertionError("local")),
            patch(_SUPERVISOR, side_effect=AssertionError("spawn")),
            patch(
                "urllib.request.urlopen", return_value=_Response(json.dumps(payload).encode())
            ) as request,
        ):
            result = self.manager.check("de-DE", self.TEXT, [])
        self.assertEqual(request.call_args.args[0].full_url, "http://languagetool:8010/v2/check")
        self.assertEqual(result["issues"][0]["replacements"], ["Dies"])

    def test_external_server_failures_are_grammar_unavailable_without_the_text(self):
        import urllib.error
        from email.message import Message

        failures = [
            urllib.error.URLError("unreachable"),
            urllib.error.HTTPError(
                "http://languagetool:8010/v2/check", 502, "Bad", Message(), None
            ),
            TimeoutError("timed out"),
        ]
        for failure in failures:
            with (
                self.subTest(type(failure).__name__),
                patch.dict(os.environ, self.ENABLED, clear=False),
                patch("urllib.request.urlopen", side_effect=failure),
            ):
                with self.assertRaises(GrammarUnavailable) as raised:
                    self.manager.check("de-DE", self.TEXT, [])
                wire = http_errors.from_exception(raised.exception)
                self.assertEqual(wire.status, 503)
                self.assertEqual(
                    wire.payload()["error"]["code"], "writing_assistance.grammar_unavailable"
                )
                self.assertNotIn("geheimer", json.dumps(wire.payload()))
                self.assertNotIn("geheimer", str(raised.exception))

    def test_a_reply_that_is_not_languagetool_json_is_grammar_unavailable(self):
        for body in (b"<html>proxy error</html>", b"[]"):
            with (
                self.subTest(body),
                patch.dict(os.environ, self.ENABLED, clear=False),
                patch("urllib.request.urlopen", return_value=_Response(body)),
            ):
                with self.assertRaises(GrammarUnavailable):
                    self.manager.check("de-DE", self.TEXT, [])


class SectionedGrammarCheckTests(unittest.TestCase):
    """Long chapters go to LanguageTool in sections, each with its own timeout,
    and the offsets of the replies are moved back onto the whole text in
    UTF-16 code units, the unit of both LanguageTool and the client."""

    ENABLED: ClassVar[dict[str, str]] = {
        "QUILTOR_LANGUAGETOOL_URL": "http://languagetool:8010/",
        "QUILTOR_LANGUAGETOOL_EXTERNAL_OPT_IN": "1",
    }

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.manager = LanguageToolManager(Path(self.temp.name))
        self.requests: list[str] = []

    def tearDown(self):
        self.manager.close()
        self.temp.cleanup()

    def _slow_server(self, needle: str):
        """A LanguageTool that needs 15 s per 20 000 characters, against a 20 s
        timeout per request, and reports every `needle` in UTF-16 offsets."""

        def respond(request, timeout):
            text = urllib.parse.parse_qs(request.data.decode())["text"][0]
            self.requests.append(text)
            self.assertEqual(timeout, 20)
            if len(text) / 20_000 * 15 > timeout:
                raise TimeoutError("timed out")
            units = text.encode("utf-16-le")
            target = needle.encode("utf-16-le")
            matches = []
            position = units.find(target)
            while position >= 0:
                if position % 2 == 0:
                    matches.append(
                        {
                            "offset": position // 2,
                            "length": len(target) // 2,
                            "message": "Fehler",
                            "rule": {"id": "R", "category": {"name": "Grammatik"}},
                        }
                    )
                position = units.find(target, position + 2)
            return _Response(json.dumps({"matches": matches}).encode())

        return respond

    @staticmethod
    def _utf16_offsets(text: str, needle: str) -> list[int]:
        units = text.encode("utf-16-le")
        target = needle.encode("utf-16-le")
        found = []
        position = units.find(target)
        while position >= 0:
            if position % 2 == 0:
                found.append(position // 2)
            position = units.find(target, position + 2)
        return found

    def _check(self, text: str, needle: str) -> dict:
        with (
            patch.dict(os.environ, self.ENABLED, clear=False),
            patch("urllib.request.urlopen", side_effect=self._slow_server(needle)),
        ):
            return self.manager.check("de-DE", text, [])

    def test_a_200k_chapter_on_a_slow_server_succeeds_with_whole_text_offsets(self):
        paragraph = "Der Morgen lag still \U0001f30a über dem Hafen, ein Brief. " * 12 + "\n\n"
        text = (paragraph * 400)[:200_000]
        result = self._check(text, "ein Brief")
        self.assertGreater(len(self.requests), 1)
        self.assertTrue(all(len(part) <= 20_000 for part in self.requests))
        self.assertEqual("".join(self.requests), text)
        expected = self._utf16_offsets(text, "ein Brief")
        self.assertEqual([issue["from"] for issue in result["issues"]], expected)
        units = text.encode("utf-16-le")
        for issue in result["issues"]:
            found = units[2 * issue["from"] : 2 * issue["to"]].decode("utf-16-le")
            self.assertEqual(found, "ein Brief")

    def test_a_match_right_after_a_section_boundary_keeps_its_offset(self):
        # The first section ends with an emoji (two UTF-16 units, one Python
        # character) and a blank line; the match opens the second section.
        first = "\U0001f30a" + "a" * 19_000 + "\U0001f30a\n\n"
        text = first + "ein Brief kam an." + " Weiter." * 2_000
        result = self._check(text, "ein Brief")
        self.assertEqual(self.requests[0], first)
        self.assertEqual(
            [issue["from"] for issue in result["issues"]], self._utf16_offsets(text, "ein Brief")
        )
        self.assertEqual(result["issues"][0]["from"], len(first) + 2)

    def test_one_failed_section_fails_the_whole_check(self):
        text = ("Satz. " * 3_000 + "\n\n") * 3
        calls = []

        def respond(request, timeout):
            calls.append(1)
            if len(calls) == 2:
                raise TimeoutError("timed out")
            return _Response(b'{"matches": []}')

        with (
            patch.dict(os.environ, self.ENABLED, clear=False),
            patch("urllib.request.urlopen", side_effect=respond),
            self.assertRaises(GrammarUnavailable) as raised,
        ):
            self.manager.check("de-DE", text, [])
        self.assertNotIn("Satz", str(raised.exception))

    def test_sections_prefer_blank_lines_then_lines_then_sentences(self):
        from quiltor.infrastructure.writing_assistance.languagetool import _sections

        self.assertEqual(_sections("aa\n\nbb\ncc", 8), ["aa\n\n", "bb\ncc"])
        self.assertEqual(_sections("aa\nbb\ncc", 7), ["aa\nbb\n", "cc"])
        self.assertEqual(_sections("Ab. Cd. Ef", 9), ["Ab. Cd. ", "Ef"])
        self.assertEqual(_sections("abcdefghij", 4), ["abcd", "efgh", "ij"])


if __name__ == "__main__":
    unittest.main()
