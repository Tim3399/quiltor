"""Which PDF renderer each build gets.

None of the three can be exercised here -- one needs Node and a downloaded
Chromium, one an installed Chrome, one AppKit and a window server. So these pin
the selection instead, which is the part that decides whether a build reaches
for something its sandbox would refuse.
"""
import importlib.util
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

    def test_the_wkwebview_renderer_reports_missing_system_frameworks_clearly(self):
        """Importable everywhere; pyobjc is only touched inside render(). Off a
        Mac -- or in the dependency-free CI job -- that has to be a readable
        German message rather than an ImportError traceback."""
        if importlib.util.find_spec("AppKit") is not None:
            self.skipTest("pyobjc is installed here, so the fallback cannot be reached")
        with self.assertRaises(RuntimeError) as caught:
            wkwebview.render("http://127.0.0.1:8843/")
        self.assertIn("Markdown", str(caught.exception))

    def test_the_wkwebview_module_imports_without_pyobjc(self):
        """It is imported by backend/pdf/__init__.py on every platform, so a
        module-level pyobjc import would break Docker and Windows outright."""
        source = (Path(wkwebview.__file__)).read_text(encoding="utf-8")
        header = source.split("def render", 1)[0]
        for framework in ("import AppKit", "import WebKit", "import Foundation", "import objc"):
            with self.subTest(framework=framework):
                self.assertNotIn(f"\n{framework}", header)

    def test_the_paper_size_matches_the_books_css(self):
        """@page { size: 6in 9in } in src/styles.css. A mismatch here silently
        rescales every page."""
        self.assertEqual((wkwebview.PAPER_WIDTH_POINTS, wkwebview.PAPER_HEIGHT_POINTS), (432, 648))

    def test_the_readiness_check_is_an_expression_and_locale_independent(self):
        """evaluateJavaScript evaluates an expression, so the check has to be an
        IIFE. And it must not wait on the German aria-label the Chromium path
        uses -- that only works while the UI defaults to German."""
        self.assertTrue(wkwebview.READY_JS.strip().startswith("(function"))
        self.assertIn(".print-document", wkwebview.READY_JS)
        self.assertNotIn("Kapiteltext", wkwebview.READY_JS)

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
