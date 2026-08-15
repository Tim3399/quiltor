"""Which PDF renderer each build gets.

None of the three can be exercised here -- one needs Node and a downloaded
Chromium, one an installed Chrome, one AppKit and a window server. So these pin
the selection instead, which is the part that decides whether a build reaches
for something its sandbox would refuse.
"""
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import pdf
from backend.pdf import node_chromium, system_browser, wkwebview


class DesktopRendererSelectionTests(unittest.TestCase):
    def _renderer(self, *, external_process: bool):
        with patch("backend.edition.allows_external_process", return_value=external_process):
            return pdf.desktop_renderer()

    def test_a_build_allowed_to_launch_apps_drives_the_installed_browser(self):
        """The .dmg, the .exe, and the Microsoft Store's MSIX package: none of
        them are sandboxed against launching Chrome."""
        self.assertIs(self._renderer(external_process=True), system_browser.render)

    def test_a_sandboxed_build_gets_the_wkwebview_renderer(self):
        """Launching an installed Chrome is what the App Sandbox refuses, so a
        Mac App Store build must not reach system_browser even though it would
        work perfectly on the developer's own machine."""
        self.assertIs(self._renderer(external_process=False), wkwebview.render)

    def test_the_wkwebview_renderer_fails_loudly_while_unimplemented(self):
        """It is selected but not written yet. Better a clear German error than
        a sandbox denial deep inside Playwright."""
        with self.assertRaises(NotImplementedError):
            wkwebview.render("http://127.0.0.1:8843/")

    def test_a_server_process_always_gets_the_node_renderer(self):
        """Docker and a source checkout are always `direct`, and a store build is
        never a server -- so this one does not consult the edition at all."""
        rendered = pdf.server_renderer(Path("/tmp/render.mjs"), Path("/tmp"))
        self.assertTrue(callable(rendered))

    def test_the_node_renderer_binds_its_script_and_base(self):
        """The factory exists so the contract stays (url, timeout) -> bytes even
        though this renderer needs two paths the host owns."""
        captured = {}

        def fake_run(argv, **kwargs):
            captured["argv"], captured["cwd"] = argv, kwargs.get("cwd")
            raise RuntimeError("stop here -- the invocation is what matters")

        rendered = node_chromium.renderer(Path("/tmp/render.mjs"), Path("/tmp/base"))
        with patch("backend.pdf.node_chromium.subprocess.run", fake_run):
            with self.assertRaises(RuntimeError):
                rendered("http://127.0.0.1:8843/")
        self.assertEqual(captured["argv"][:2], ["node", "/tmp/render.mjs"])
        self.assertEqual(captured["cwd"], Path("/tmp/base"))


class RenderTokenTests(unittest.TestCase):
    """Moved from backend/render.py into backend/pdf/tokens.py; behaviour unchanged."""

    def test_a_token_is_single_use(self):
        token = pdf.issue_render_token("user-1")
        self.assertEqual(pdf.redeem_render_token(token), "user-1")
        self.assertIsNone(pdf.redeem_render_token(token))

    def test_an_unknown_token_is_refused(self):
        self.assertIsNone(pdf.redeem_render_token("never-issued"))


if __name__ == "__main__":
    unittest.main()
