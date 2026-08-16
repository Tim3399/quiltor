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
from backend.pdf import node_chromium, page_numbers, system_browser, wkwebview


class DesktopRendererSelectionTests(unittest.TestCase):
    def _renderer(self, *, os_name: str, sandboxed: bool):
        with patch("backend.system.os_name", return_value=os_name):
            with patch("backend.edition.is_sandboxed", return_value=sandboxed):
                return pdf.desktop_renderer()

    def test_macos_always_prints_through_wkwebview(self):
        """Not a concession to the sandbox -- the window is a WKWebView, so the
        PDF matches what the author saw, and no reader has to install Chrome to
        export their book."""
        for sandboxed in (False, True):
            with self.subTest(sandboxed=sandboxed):
                self.assertIs(self._renderer(os_name="macos", sandboxed=sandboxed),
                              wkwebview.render)

    def test_windows_and_linux_still_drive_the_installed_browser(self):
        """Until WebView2 and WebKitGTK equivalents exist. Both ship a browser
        by default, so the dependency is far less intrusive there."""
        for os_name in ("windows", "linux"):
            with self.subTest(os_name=os_name):
                self.assertIs(self._renderer(os_name=os_name, sandboxed=False),
                              system_browser.render)

    def test_a_sandboxed_build_never_reaches_for_a_browser(self):
        """Launching an installed Chrome is what the App Sandbox refuses,
        whatever the platform."""
        for os_name in ("macos", "windows", "linux"):
            with self.subTest(os_name=os_name):
                self.assertIs(self._renderer(os_name=os_name, sandboxed=True), wkwebview.render)

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


class PageNumberTests(unittest.TestCase):
    """The geometry, which is pure arithmetic and checkable anywhere. The
    drawing itself needs Quartz and is verified against Chromium's output on a
    Mac -- the numbers below are what that measurement produced."""

    def test_the_title_page_carries_no_number(self):
        """@page:first suppresses it, but the counter still counts the page --
        which is why the second page reads "2" and not "1"."""
        labels = page_numbers.numbers_for(5)
        self.assertIsNone(labels[0])
        self.assertEqual(labels[1:], ["2", "3", "4", "5"])

    def test_a_one_page_book_gets_no_numbers_at_all(self):
        self.assertEqual(page_numbers.numbers_for(1), [None])

    def test_the_number_is_centred_on_the_text_block_not_the_page(self):
        """The left and right margins are mirrored for binding (.68in outer,
        .78in spine), so the centre alternates. Chromium puts its numbers at
        212.2 and 219.6 on a 432 pt page; the page centre is 216, and using it
        would put every number visibly off."""
        self.assertAlmostEqual(page_numbers.centre_for(2), 212.4, places=1)
        self.assertAlmostEqual(page_numbers.centre_for(3), 219.6, places=1)
        self.assertNotAlmostEqual(page_numbers.centre_for(2), 216.0, places=1)

    def test_recto_and_verso_mirror_each_other(self):
        page_centre = page_numbers.PAGE_WIDTH / 2
        recto, verso = page_numbers.centre_for(3), page_numbers.centre_for(2)
        self.assertAlmostEqual(recto - page_centre, page_centre - verso, places=6)

    def test_all_odd_pages_agree_and_all_even_pages_agree(self):
        self.assertEqual(len({page_numbers.centre_for(n) for n in (1, 3, 5, 21)}), 1)
        self.assertEqual(len({page_numbers.centre_for(n) for n in (2, 4, 6, 22)}), 1)

    def test_the_number_sits_inside_the_bottom_margin(self):
        """The CSS reserves .82in at the foot; the number has to land in that
        band, not in the text area above it."""
        self.assertLess(page_numbers.BASELINE_FROM_FOOT, 0.82 * 72)
        self.assertGreater(page_numbers.BASELINE_FROM_FOOT, 0)

    def test_stamping_never_loses_the_document(self):
        """An unnumbered book is worth shipping; a failed export is not. Fed
        something that is not a PDF, stamp() has to hand back what it was
        given rather than raise into the request."""
        self.assertEqual(page_numbers.stamp(b"not a pdf at all"), b"not a pdf at all")


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
