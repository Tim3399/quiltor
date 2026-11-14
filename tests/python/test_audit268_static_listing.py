"""T-268 audit D1 follow-up (r2): the static file edge lists directories.

`Handler` derives from `SimpleHTTPRequestHandler` and does not override
`list_directory`, so `GET /assets/` answers 200 with an HTML index of every built
file. The names are public anyway (index.html references them), so the severity is low.
The gap test is `@unittest.expectedFailure` and names S268-107.
"""

from __future__ import annotations

import unittest

from tests.python.test_audit268_identity_support import HostedHarness


class StaticListingTests(HostedHarness):
    def _a_known_asset(self) -> str:
        directory = self.application.public_assets / "assets"
        names = sorted(p.name for p in directory.iterdir() if p.is_file())
        self.assertTrue(names, "the built client must carry at least one file under assets/")
        return names[0]

    def test_assets_without_slash_redirects_and_a_known_file_is_served(self) -> None:
        status, headers, _, _ = self.request("GET", "/assets")
        self.assertEqual(status, 301)
        self.assertEqual(headers["location"], "/assets/")
        status, _, body, _ = self.request("GET", f"/assets/{self._a_known_asset()}")
        self.assertEqual(status, 200)
        self.assertGreater(len(body), 0)

    @unittest.expectedFailure
    def test_s268_107_assets_directory_must_not_be_listed(self) -> None:
        """S268-107 (low, 3.10): GET /assets/ must not answer with a directory index."""
        status, _, body, _ = self.request("GET", "/assets/")
        self.assertNotIn(b"Directory listing for", body)
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()
