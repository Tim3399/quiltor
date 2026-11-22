"""T-354: the server states how long a browser may keep each file of the built client.

quiltor.app answered index.html without Cache-Control, so a browser cached it
heuristically and kept running the previous client after a deploy. The server now
says it itself, in every way it is run (server, Docker, wheel and desktop all serve
`dist/` through `hosts.web.server.Handler`), so no proxy has to.

Driven over loopback on an ephemeral port by the T-268 harness; no fixed port.
"""

from __future__ import annotations

import unittest

from quiltor.hosts.web import server
from tests.python.test_audit268_identity_support import HostedHarness

IMMUTABLE = "public, max-age=31536000, immutable"


class StaticCacheControlTests(HostedHarness):
    def _hashed_asset(self) -> str:
        directory = self.application.public_assets / "assets"
        names = sorted(p.name for p in directory.iterdir() if p.suffix == ".js")
        names = [n for n in names if server.HASHED_ASSET.match(f"/assets/{n}")]
        self.assertTrue(names, "the built client must carry a hashed script under assets/")
        return names[0]

    def test_index_html_is_revalidated_on_every_use(self) -> None:
        for path in ("/", "/index.html", "/?world=x"):
            status, headers, _, _ = self.request("GET", path)
            self.assertEqual(status, 200, path)
            self.assertEqual(headers.get("cache-control"), "no-cache", path)

    def test_a_hashed_bundle_is_immutable(self) -> None:
        status, headers, body, _ = self.request("GET", f"/assets/{self._hashed_asset()}")
        self.assertEqual(status, 200)
        self.assertGreater(len(body), 0)
        self.assertEqual(headers.get("cache-control"), IMMUTABLE)

    def test_files_without_a_hash_in_the_name_are_revalidated(self) -> None:
        """Decision: a favicon or theme-boot.js keeps its name across releases, so it must
        not be immutable. no-cache plus Last-Modified costs a 304, not a download."""
        for path in ("/favicon.ico", "/theme-boot.js", "/apple-touch-icon.png"):
            status, headers, _, _ = self.request("GET", path)
            self.assertEqual(status, 200, path)
            self.assertEqual(headers.get("cache-control"), "no-cache", path)

    def test_an_unknown_path_is_not_cached_as_a_file(self) -> None:
        """There is no SPA fallback: an unknown path is a 404 and carries no file policy."""
        status, headers, _, _ = self.request("GET", "/no/such/route")
        self.assertEqual(status, 404)
        self.assertNotIn("cache-control", headers)
        status, headers, _, _ = self.request("GET", "/assets/missing-AbCd1234.js")
        self.assertEqual(status, 404)
        self.assertNotIn("immutable", headers.get("cache-control", ""))

    def test_a_conditional_request_still_answers_304_with_the_policy(self) -> None:
        _, first, _, _ = self.request("GET", "/index.html")
        status, headers, body, _ = self.request(
            "GET", "/index.html", headers={"If-Modified-Since": first["last-modified"]}
        )
        self.assertEqual(status, 304)
        self.assertEqual(body, b"")
        self.assertEqual(headers.get("cache-control"), "no-cache")

    def test_the_api_keeps_its_own_no_store(self) -> None:
        _, headers, _, _ = self.request("GET", "/api/does-not-exist")
        self.assertEqual(headers.get("cache-control"), "no-store")

    def test_a_keep_alive_connection_does_not_leak_the_policy_into_the_next_answer(self) -> None:
        import http.client

        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        try:
            connection.request("GET", "/index.html")
            connection.getresponse().read()
            connection.request("GET", "/api/does-not-exist")
            response = connection.getresponse()
            response.read()
            values = [v for k, v in response.getheaders() if k.lower() == "cache-control"]
        finally:
            connection.close()
        self.assertEqual(values, ["no-store"])


class StaticCacheControlPolicyTests(unittest.TestCase):
    def test_which_names_count_as_hashed(self) -> None:
        self.assertEqual(server.static_cache_control("/assets/index-BqygqS-9.css"), IMMUTABLE)
        self.assertEqual(
            server.static_cache_control("/assets/AssistantDrawer-IXUU_VB_.js"), IMMUTABLE
        )
        self.assertEqual(server.static_cache_control("/index.html"), "no-cache")
        self.assertEqual(server.static_cache_control("/assets/logo.svg"), "no-cache")
        self.assertEqual(server.static_cache_control("/favicon.ico"), "no-cache")
        self.assertEqual(server.static_cache_control("/other/x-AbCd1234.js"), "no-cache")


if __name__ == "__main__":
    unittest.main()
