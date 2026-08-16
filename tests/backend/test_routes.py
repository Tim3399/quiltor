"""The route table.

The risk in splitting a 400-line if-chain into modules is that a route quietly
does not come along, and nothing notices until someone clicks the button. So the
table is checked against the frontend that calls it: every path in
src/lib/api.ts must be registered, and every registered path must be reachable.
"""
import re
import unittest
from pathlib import Path

import server  # imported for its side effect: routes are loaded at import time
from backend.api import routes

REPO_ROOT = Path(__file__).resolve().parents[2]
API_CLIENT = REPO_ROOT / "src" / "lib" / "api.ts"

#: Served to the browser rather than called by api.ts, or reached by other means.
NOT_CALLED_FROM_THE_CLIENT = {
    "/login",            # a browser navigation
    "/auth/callback",    # the identity provider redirects here
    "/api/book.pdf",     # fetched directly, not through the json() helper
}


def _client_paths() -> set[str]:
    """Every '/api/...' literal the frontend fetches."""
    source = API_CLIENT.read_text(encoding="utf-8")
    return {match for match in re.findall(r"'(/api/[a-zA-Z0-9/_.-]+)'", source)}


class RouteTableTests(unittest.TestCase):
    def test_the_table_is_populated(self):
        """server.py calls routes.load() at import. A table that stayed empty
        would make every assertion below vacuously true."""
        self.assertGreater(len(routes.GET), 8)
        self.assertGreater(len(routes.SAVE), 8)

    def test_every_endpoint_the_frontend_calls_is_registered(self):
        registered = set(routes.GET) | set(routes.SAVE)
        missing = sorted(_client_paths() - registered)
        self.assertEqual(missing, [], f"the client calls these but no route handles them: {missing}")

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

    def test_world_scoped_routes_are_the_ones_that_need_a_world(self):
        """Under OIDC these resolve the caller's world before running, which is
        what keeps one account out of another's data. A route dropping off this
        list would read whatever database happens to be active."""
        expected = {"/api/state", "/api/manuscript", "/api/backup", "/api/log", "/api/backups",
                    "/api/diff", "/api/textfassung", "/api/assistant/status", "/api/assistant/logs"}
        actual = {path for path, entry in routes.GET.items() if entry.world}
        self.assertEqual(actual, expected)

    def test_only_the_login_flow_is_reachable_without_a_session(self):
        anonymous = {path for table in (routes.GET, routes.SAVE)
                     for path, entry in table.items() if entry.anonymous}
        self.assertEqual(anonymous,
                         {"/api/version", "/login", "/auth/callback", "/api/whoami", "/logout"})

    def test_the_account_routes_vanish_without_oidc(self):
        """The local single-user build answers 404 for these; pinned end to end
        in test_server_auth.ServerAuthDisabledControlTest."""
        auth_only = {path for table in (routes.GET, routes.SAVE)
                     for path, entry in table.items() if entry.auth_only}
        self.assertEqual(auth_only, {"/login", "/auth/callback", "/api/whoami", "/logout"})
        self.assertNotIn("/api/version", auth_only)

    def test_routes_never_import_the_server_module(self):
        """They receive it as `app` instead. A `from server import RENDER_PDF`
        would bind once and ignore desktop.py's swap and the tests' patches."""
        package = REPO_ROOT / "backend" / "api"
        for path in sorted(package.rglob("*.py")):
            with self.subTest(module=str(path.relative_to(REPO_ROOT))):
                source = path.read_text(encoding="utf-8")
                self.assertNotIn("\nimport server", source)
                self.assertNotIn("\nfrom server import", source)


if __name__ == "__main__":
    unittest.main()
