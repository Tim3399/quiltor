"""The Content-Security-Policy on HTML answers (T-61 part 5)."""

import http.client
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from quiltor import resources
from quiltor.bootstrap import build_identity, build_web_application
from quiltor.bootstrap.web import (
    CSP_POLICY_FILE,
    content_security_policy,
    csp_connect_extra,
    csp_mode,
)
from quiltor.hosts.web import server
from quiltor.infrastructure.platform.ports import AppDirectories
from tests.python.request_timeout import REQUEST_TIMEOUT

REPORT_ONLY = "Content-Security-Policy-Report-Only"
ENFORCE = "Content-Security-Policy"


def connect_src(value: str) -> list[str]:
    directive = next(item for item in value.split("; ") if item.startswith("connect-src "))
    return directive.split(" ")[1:]


def policy_file() -> dict:
    return json.loads(CSP_POLICY_FILE.read_text(encoding="utf-8"))


class LiveServer:
    """A local Quiltor serving the built client, started under the given environment."""

    def __init__(self, test: unittest.TestCase, environment: dict[str, str]):
        temp = tempfile.TemporaryDirectory()
        test.addCleanup(temp.cleanup)
        root = Path(temp.name)
        directories = AppDirectories(
            data=root,
            config=root / "config",
            cache=root / "cache",
            models=root / "models",
            logs=root / "logs",
            temp=root / "temp",
        )
        cleared = {
            "QUILTOR_CSP": "",
            "QUILTOR_CSP_CONNECT_EXTRA": "",
            "QUILTOR_TEST_HOOKS": "",
            **environment,
        }
        with patch.dict(os.environ, cleared):
            inference = MagicMock(identity="test-inference")
            inference.status.return_value = {"available": False, "mode": "local", "reason": "t"}
            self.app = build_web_application(
                identity=build_identity(False),
                ensure_assistant_installed=False,
                inference=inference,
                app_directories=directories,
            )
        test.addCleanup(self.app.close)
        self.httpd = server.Server(("127.0.0.1", 0), server.Handler, self.app)
        thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        thread.start()

        def stop():
            self.httpd.shutdown()
            self.httpd.server_close()
            thread.join(timeout=5)

        test.addCleanup(stop)

    def get(self, path: str) -> http.client.HTTPResponse:
        connection = http.client.HTTPConnection(
            "127.0.0.1", self.httpd.server_address[1], timeout=REQUEST_TIMEOUT
        )
        connection.request("GET", path)
        response = connection.getresponse()
        response.read()
        connection.close()
        return response


class ModeTests(unittest.TestCase):
    def test_each_mode_picks_its_header(self):
        # Unset is enforce here: this is a web instance without identity (D-198, S269-1).
        for mode, header in (("report-only", REPORT_ONLY), ("enforce", ENFORCE), ("", ENFORCE)):
            with self.subTest(mode=mode):
                response = LiveServer(self, {"QUILTOR_CSP": mode}).get("/")
                self.assertEqual(response.status, 200)
                self.assertIsNotNone(response.getheader(header))
                other = ENFORCE if header == REPORT_ONLY else REPORT_ONLY
                self.assertIsNone(response.getheader(other))

    def test_every_mode_forbids_framing(self):
        """S269-2: a report-only or absent frame-ancestors blocks nothing on its own."""
        for mode in ("enforce", "report-only", "off"):
            with self.subTest(mode=mode):
                response = LiveServer(self, {"QUILTOR_CSP": mode}).get("/")
                self.assertEqual(response.getheader("X-Frame-Options"), "DENY")

    def test_off_sends_no_policy(self):
        response = LiveServer(self, {"QUILTOR_CSP": "off"}).get("/")
        self.assertEqual(response.status, 200)
        self.assertIsNone(response.getheader(ENFORCE))
        self.assertIsNone(response.getheader(REPORT_ONLY))

    def test_there_is_no_report_uri(self):
        _, value = content_security_policy("enforce") or ("", "")
        self.assertNotIn("report-uri", value)
        self.assertNotIn("report-to", value)


class HtmlOnlyTests(unittest.TestCase):
    def setUp(self):
        self.server = LiveServer(self, {"QUILTOR_CSP": "enforce"})

    def test_the_client_page_carries_the_policy(self):
        for path in ("/", "/index.html"):
            with self.subTest(path=path):
                self.assertIsNotNone(self.server.get(path).getheader(ENFORCE))

    def test_the_backup_callback_page_carries_the_policy(self):
        response = self.server.get("/backup/callback")
        self.assertEqual(response.status, 400)
        self.assertTrue(str(response.getheader("Content-Type")).startswith("text/html"))
        self.assertIsNotNone(response.getheader(ENFORCE))

    def test_api_answers_carry_none(self):
        response = self.server.get("/api/status")
        self.assertTrue(str(response.getheader("Content-Type")).startswith("application/json"))
        self.assertIsNone(response.getheader(ENFORCE))

    def test_scripts_and_images_carry_none(self):
        assets = resources.web_assets()
        script = next((assets / "assets").glob("*.js"))
        for path in (f"/assets/{script.name}", "/favicon-32.png", "/theme-boot.js"):
            with self.subTest(path=path):
                response = self.server.get(path)
                self.assertEqual(response.status, 200)
                self.assertIsNone(response.getheader(ENFORCE))

    def test_a_stored_image_keeps_its_own_sandbox_policy(self):
        handler = MagicMock(spec=server.Handler)
        handler.application = self.server.app
        handler.wfile = MagicMock()
        sent: list[tuple[str, str]] = []
        handler.send_header.side_effect = lambda key, value: sent.append((key, value))
        server.Handler.send_image(handler, "image/png", b"x", "d")
        self.assertIn((ENFORCE, "default-src 'none'; sandbox"), sent)


PROVIDER_ORIGINS = ("api.openai.com", "openrouter.ai", "api.anthropic.com")


# The hosts WebLLM loads a catalog model from (D-197: the Hugging Face CDN is regional).
WEBLLM_HOSTS = [
    "https://huggingface.co",
    "https://*.cdn.hf.co",
    "https://cdn-lfs-us-1.hf.co",
    "https://cdn-lfs-eu-1.hf.co",
    "https://raw.githubusercontent.com",
]


class ConnectSrcTests(unittest.TestCase):
    def test_webllm_hosts_are_the_measured_ones(self):
        self.assertEqual(policy_file()["webllmHosts"], WEBLLM_HOSTS)

    def test_connect_src_is_exactly_the_file(self):
        policy = policy_file()
        response = LiveServer(self, {}).get("/")
        self.assertEqual(
            connect_src(str(response.getheader(ENFORCE))),
            policy["directives"]["connect-src"] + policy["webllmHosts"],
        )

    def test_test_hooks_and_extra_origins_are_appended(self):
        policy = policy_file()
        response = LiveServer(
            self,
            {
                "QUILTOR_TEST_HOOKS": "1",
                "QUILTOR_CSP_CONNECT_EXTRA": " https://hf.example  https://cdn.example:8443 ",
            },
        ).get("/")
        self.assertEqual(
            connect_src(str(response.getheader(ENFORCE))),
            [
                *policy["directives"]["connect-src"],
                *policy["webllmHosts"],
                policy["testHooksOrigin"],
                "https://hf.example",
                "https://cdn.example:8443",
            ],
        )

    def test_no_provider_origin_even_with_test_hooks(self):
        # 3.26 lets no browser talk to a provider; T-264 brings the origins back (D-185).
        for environment in ({}, {"QUILTOR_TEST_HOOKS": "1"}):
            with self.subTest(environment=environment):
                response = LiveServer(self, environment).get("/")
                allowed = connect_src(str(response.getheader(ENFORCE)))
                for origin in PROVIDER_ORIGINS:
                    self.assertFalse(
                        any(origin in entry for entry in allowed), f"{origin} in {allowed}"
                    )

    def test_test_hooks_other_than_1_add_nothing(self):
        _, value = content_security_policy("enforce", test_hooks=False) or ("", "")
        self.assertNotIn(policy_file()["testHooksOrigin"], value)

    def test_the_only_wildcard_is_the_hugging_face_cdn_in_connect_src(self):
        _, value = content_security_policy("enforce", test_hooks=True) or ("", "")
        starred = [
            (item.split(" ")[0], source)
            for item in value.split("; ")
            for source in item.split(" ")[1:]
            if "*" in source
        ]
        self.assertEqual(starred, [("connect-src", "https://*.cdn.hf.co")])
        self.assertNotIn("'unsafe-inline'", connect_src(value))
        script = next(item for item in value.split("; ") if item.startswith("script-src "))
        self.assertEqual(script, "script-src 'self' 'wasm-unsafe-eval'")


class StartupErrorTests(unittest.TestCase):
    def test_an_unknown_mode_stops_the_start(self):
        for value in ("on", "Enforce", "report_only", "1"):
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                csp_mode(value)

    def test_an_extra_origin_must_be_a_bare_https_origin(self):
        for value in (
            "http://hf.example",
            "https://*.hf.example",
            "https://hf.example/path",
            "https://hf.example/",
            "*",
            "hf.example",
            "https://hf.example?x",
        ):
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                csp_connect_extra(value)
        self.assertEqual(csp_connect_extra(""), ())

    def test_the_application_refuses_to_build_with_a_bad_value(self):
        for environment in ({"QUILTOR_CSP": "strict"}, {"QUILTOR_CSP_CONNECT_EXTRA": "*"}):
            with self.subTest(environment=environment), self.assertRaises(RuntimeError):
                LiveServer(self, environment)


if __name__ == "__main__":
    unittest.main()
