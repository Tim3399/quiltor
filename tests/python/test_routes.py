"""The route table.

The risk in splitting a 400-line if-chain into modules is that a route quietly
does not come along, and nothing notices until someone clicks the button. So the
table is checked against the frontend adapters that call it: every literal path
under ``packages/client/src/platform/http`` must be registered, and every
registered path must be reachable.
"""

import re
import unittest
from pathlib import Path

from quiltor.hosts.web import (
    server,
)  # imported for its side effect: routes are loaded at import time
from quiltor.delivery.http import routes

REPO_ROOT = Path(__file__).resolve().parents[2]
API_CLIENT_ROOT = REPO_ROOT / "packages" / "client" / "src" / "platform" / "http"

#: Served to the browser rather than called by api.ts, or reached by other means.
NOT_CALLED_FROM_THE_CLIENT = {
    "/login",  # a browser navigation
    "/auth/callback",  # the identity provider redirects here
    "/api/book.pdf",  # fetched directly, not through the json() helper
}


def _client_paths() -> set[str]:
    """Every literal /api/... path the frontend fetches.

    The scan is deliberately independent of JavaScript quote style so a
    formatter changing single quotes to double quotes cannot disable it.
    """
    pattern = re.compile(r"""(?P<quote>["'`])(?P<path>/api/[A-Za-z0-9/_.-]+)(?P=quote)""")
    paths: set[str] = set()
    for path in sorted(API_CLIENT_ROOT.glob("*.ts")):
        if path.name.endswith(".test.ts"):
            continue
        source = path.read_text(encoding="utf-8")
        paths.update(match.group("path") for match in pattern.finditer(source))
    return paths


class RouteTableTests(unittest.TestCase):
    def test_the_table_is_populated(self):
        """quiltor.hosts.web.server.py calls routes.load() at import. A table that stayed empty
        would make every assertion below vacuously true."""
        self.assertGreater(len(routes.GET), 8)
        self.assertGreater(len(routes.SAVE), 8)

    def test_every_endpoint_the_frontend_calls_is_registered(self):
        registered = set(routes.GET) | set(routes.SAVE)
        missing = sorted(_client_paths() - registered)
        self.assertEqual(
            missing, [], f"the client calls these but no route handles them: {missing}"
        )

    def test_the_client_path_scan_finds_something(self):
        """Guards the check above against a regex that stopped matching."""
        found = _client_paths()
        self.assertGreater(len(found), 10)
        self.assertIn("/api/worlds", found)

    def test_no_route_is_registered_twice(self):
        """The decorator raises on a duplicate, so reaching here at all means
        the modules loaded cleanly -- this pins that the guard exists."""
        with self.assertRaises(RuntimeError):
            routes.get("/api/version")(lambda handler, request, app: None)

    def test_document_routes_exist_for_both_reading_and_writing(self):
        for path in ("/api/state", "/api/manuscript"):
            with self.subTest(path=path):
                self.assertIn(path, routes.GET)
                self.assertIn(path, routes.SAVE)
                self.assertTrue(routes.GET[path].world)
                self.assertTrue(routes.SAVE[path].world)

    def test_assistant_job_routes_are_registered_with_the_expected_methods(self):
        self.assertIn("/api/assistant/job", routes.GET)
        self.assertIn("/api/assistant/jobs", routes.SAVE)
        self.assertIn("/api/assistant/job/cancel", routes.SAVE)
        self.assertNotIn("/api/assistant/chat", routes.SAVE)

    def test_world_scoped_routes_are_the_ones_that_need_a_world(self):
        """Under OIDC these resolve the caller's world before running, which is
        what keeps one account out of another's data. A route dropping off this
        list would read whatever database happens to be active."""
        expected = {
            "/api/state",
            "/api/manuscript",
            "/api/backup",
            "/api/history",
            "/api/backups",
            "/api/history/diff",
            "/api/history/chapter-text",
            "/api/history/chapter-comparison",
            "/api/assistant/status",
            "/api/assistant/logs",
            "/api/assistant/job",
            "/api/assistant/progress",
        }
        actual = {path for path, entry in routes.GET.items() if entry.world}
        self.assertEqual(actual, expected)

    def test_only_the_login_flow_is_reachable_without_a_session(self):
        anonymous = {
            path
            for table in (routes.GET, routes.SAVE)
            for path, entry in table.items()
            if entry.anonymous
        }
        self.assertEqual(anonymous, {"/api/version", "/login", "/auth/callback", "/logout"})

    def test_whoami_is_neither_anonymous_nor_account_only(self):
        """Every request has a session now, so "who is asking" always has an
        answer -- and always needs one to give, which is why it is not
        anonymous either."""
        entry = routes.GET["/api/whoami"]
        self.assertFalse(entry.anonymous)
        self.assertFalse(entry.auth_only)

    def test_the_account_routes_vanish_when_there_is_only_one_user(self):
        """Choosing an account and putting it down again are the only things a
        single-user instance has no version of; it answers 404 for these,
        pinned end to end in test_server_auth.LocalIdentityServerTest."""
        auth_only = {
            path
            for table in (routes.GET, routes.SAVE)
            for path, entry in table.items()
            if entry.auth_only
        }
        self.assertEqual(auth_only, {"/login", "/auth/callback", "/logout"})
        self.assertNotIn("/api/version", auth_only)

    def test_routes_only_reach_host_and_infrastructure_through_the_injected_app(self):
        """Routes receive host/application capabilities as ``app``.

        Direct imports would bind concrete adapters once and bypass both host
        composition and deterministic route tests.
        """
        package = REPO_ROOT / "src" / "quiltor" / "delivery" / "http" / "routes"
        for path in sorted(package.rglob("*.py")):
            with self.subTest(module=str(path.relative_to(REPO_ROOT))):
                source = path.read_text(encoding="utf-8")
                self.assertNotIn("\nimport server", source)
                self.assertNotIn("\nfrom server import", source)
                self.assertNotIn("from quiltor.infrastructure", source)
                self.assertNotIn("import quiltor.infrastructure", source)


if __name__ == "__main__":
    unittest.main()
