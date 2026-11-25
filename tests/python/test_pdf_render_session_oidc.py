"""T-370: the PDF render's own session passes the public-origin check under OIDC.

quiltor.app runs OIDC with QUILTOR_PUBLIC_URL. The headless render opens the print view on
http://127.0.0.1:<port>/?renderToken=..., gets a session cookie for the requesting account
and posts /api/worlds/open from that loopback origin. Before T-370 that post was refused
with 403 and every hosted PDF export ran into its time limit.

The renderer here is a stand-in that makes exactly the print view's requests over real HTTP,
so the whole route -- book_pdf issuing the token, OidcIdentity redeeming it, the origin
check -- runs as in production. Only Chromium is left out.
"""

from __future__ import annotations

import http.client
import json
import unittest
import urllib.parse

from tests.python.request_timeout import REQUEST_TIMEOUT
from tests.python.test_audit268_identity_support import PUBLIC_URL, SESSION_COOKIE, HostedHarness


class RenderSessionUnderOidcTests(HostedHarness):
    def setUp(self) -> None:
        super().setUp()
        self.seen: list[tuple[str, int, dict]] = []
        self.application.render_pdf = self._render

    def _render(self, url: str, timeout: int = 80) -> bytes:
        """What the print view does: load the page with its token, then open the world."""
        target = urllib.parse.urlsplit(url)
        origin = f"{target.scheme}://{target.netloc}"
        connection = http.client.HTTPConnection(
            target.hostname or "127.0.0.1", target.port, timeout=REQUEST_TIMEOUT
        )
        connection.request("GET", f"{target.path}?{target.query}")
        page = connection.getresponse()
        page.read()
        cookie = next(
            (
                value.split(";", 1)[0]
                for key, value in page.getheaders()
                if key.lower() == "set-cookie" and value.startswith(SESSION_COOKIE + "=")
            ),
            "",
        )
        connection.close()
        world = urllib.parse.parse_qs(target.query)["world"][0]
        connection = http.client.HTTPConnection(
            target.hostname or "127.0.0.1", target.port, timeout=REQUEST_TIMEOUT
        )
        connection.request(
            "POST",
            "/api/worlds/open",
            body=json.dumps({"id": world}).encode(),
            headers={"Content-Type": "application/json", "Origin": origin, "Cookie": cookie},
        )
        opened = connection.getresponse()
        body = json.loads(opened.read() or b"{}")
        connection.close()
        self.seen.append((cookie, opened.status, body))
        return b"%PDF-1.7 stand-in"

    def _export(self, session: str, world: str):
        return self.request(
            "POST",
            "/api/book.pdf",
            {"worldId": world},
            headers={"Origin": PUBLIC_URL},
            cookies={SESSION_COOKIE: session},
        )

    def test_the_render_session_opens_the_requesting_users_world_from_loopback(self) -> None:
        session = self.login("alice")
        world = self.create_world(session, "Alices Buch")

        status, _, body, _ = self._export(session, world)

        self.assertEqual(len(self.seen), 1)
        cookie, open_status, opened = self.seen[0]
        self.assertTrue(cookie, "the render token must redeem into a session cookie under OIDC")
        self.assertEqual(open_status, 200, opened)
        self.assertEqual(opened["world"]["id"], world)
        self.assertEqual(status, 200, body[:200])
        self.assertTrue(body.startswith(b"%PDF"))

    def test_the_render_session_cannot_reach_another_users_world(self) -> None:
        alice = self.login("alice")
        alices_world = self.create_world(alice, "Alices Buch")
        bob = self.login("bob")
        bobs_world = self.create_world(bob, "Bobs Buch")

        self._export(alice, alices_world)
        cookie = self.seen[0][0]
        status, document, _, _ = self.json_request(
            "POST",
            "/api/worlds/open",
            {"id": bobs_world},
            headers={"Origin": f"http://127.0.0.1:{self.port}", "Cookie": cookie},
        )
        self.assertNotEqual(status, 200, document)

    def test_an_ordinary_oidc_session_is_still_refused_from_the_loopback_origin(self) -> None:
        session = self.login("alice")
        world = self.create_world(session)
        status, document, _, _ = self.json_request(
            "POST",
            "/api/worlds/open",
            {"id": world},
            headers={"Origin": f"http://127.0.0.1:{self.port}"},
            cookies={SESSION_COOKIE: session},
        )
        self.assertEqual(status, 403)
        self.assertEqual(document["error"]["code"], "request.untrusted_origin")


if __name__ == "__main__":
    unittest.main()
