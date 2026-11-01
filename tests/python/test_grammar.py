import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from quiltor.delivery.http import errors as http_errors
from quiltor.infrastructure.writing_assistance import LanguageToolManager
from quiltor.modules.writing_assistance.errors import (
    ChecksumMismatch,
    DownloadFailed,
    GrammarStartFailed,
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


if __name__ == "__main__":
    unittest.main()
