"""Which PDF renderer each build gets.

None of the three can be exercised here -- one needs Node and a downloaded
Chromium, one an installed Chrome, one AppKit and a window server. So these pin
the selection instead, which is the part that decides whether a build reaches
for something its sandbox would refuse.
"""

import importlib.util
import os
import unittest
from pathlib import Path
from unittest.mock import patch

from quiltor.infrastructure import pdf
from quiltor.infrastructure.pdf import (
    node_chromium,
    page_numbers,
    system_browser,
    webkitgtk,
    webview2,
    wkwebview,
)
from quiltor.application.errors import PdfExportUnavailable


class DesktopRendererSelectionTests(unittest.TestCase):
    def _renderer(self, *, os_name: str, environment: dict | None = None):
        with patch.dict(os.environ, environment or {}, clear=True):
            with patch("quiltor.infrastructure.platform.system.os_name", return_value=os_name):
                return pdf.desktop_renderer()

    def test_every_platform_prints_with_its_own_engine(self):
        """No second browser anywhere. The window is already a web view, so the
        PDF matches what the author saw and nothing has to be installed for it
        -- which on Linux is not a nicety: no browser is guaranteed there."""
        for os_name, renderer in (
            ("macos", wkwebview.render),
            ("windows", webview2.render),
            ("linux", webkitgtk.render),
        ):
            with self.subTest(os_name=os_name):
                self.assertIs(self._renderer(os_name=os_name), renderer)

    def test_no_platform_reaches_for_an_installed_browser_by_default(self):
        for os_name in ("macos", "windows", "linux"):
            with self.subTest(os_name=os_name):
                self.assertIsNot(self._renderer(os_name=os_name), system_browser.render)

    def test_the_escape_hatch_restores_the_browser_path(self):
        """Only the macOS native path has been executed. If Windows or Linux
        misbehaves, this gets a working export back without a new build."""
        for os_name in ("macos", "windows", "linux"):
            with self.subTest(os_name=os_name):
                chosen = self._renderer(
                    os_name=os_name, environment={"QUILTOR_PDF_RENDERER": "system_browser"}
                )
                self.assertIs(chosen, system_browser.render)

    def test_an_unknown_override_fails_loudly(self):
        with patch.dict(os.environ, {"QUILTOR_PDF_RENDERER": "chrome"}, clear=True):
            with self.assertRaises(SystemExit):
                pdf.desktop_renderer_name()

    def test_every_native_renderer_is_a_real_module(self):
        """NATIVE_RENDERERS is a name -> name map; a typo would only surface on
        the platform that has it."""
        for os_name, name in pdf.NATIVE_RENDERERS.items():
            with self.subTest(os_name=os_name):
                self.assertIn(name, pdf._BY_NAME)
                self.assertTrue(callable(pdf._BY_NAME[name]))

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
        """It is imported by src/quiltor/infrastructure/pdf/__init__.py on every platform, so a
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

    def test_the_objective_c_classes_are_built_once_per_process(self):
        """An Objective-C class name can be registered only once. Rebuilding the
        delegates per render raised

            error('RenderDelegate is overriding existing Objective-C class')

        which made the first book PDF of a session work and every later one fail
        until the app was restarted -- observed in the running desktop app, not
        deduced. Runs anywhere: the factories are only *called* where pyobjc is
        installed, but the caching is what this checks.
        """
        if importlib.util.find_spec("AppKit") is None:
            self.skipTest("the factories need pyobjc to build anything at all")
        for factory in (wkwebview._navigation_delegate, wkwebview._print_sink):
            with self.subTest(factory=factory.__name__):
                self.assertIs(factory(), factory())

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
        rendered = pdf.server_renderer(Path("render.mjs"), Path("project"))
        self.assertTrue(callable(rendered))

    def test_the_node_renderer_binds_its_script_and_base(self):
        """The factory exists so the contract stays (url, timeout) -> bytes even
        though this renderer needs two paths the host owns."""
        captured = {}

        def fake_run(argv, **kwargs):
            captured["argv"], captured["cwd"] = argv, kwargs.get("cwd")
            raise RuntimeError("stop here -- the invocation is what matters")

        script = Path("renderer") / "render.mjs"
        base = Path("project")
        rendered = node_chromium.renderer(script, base)
        with patch("quiltor.infrastructure.pdf.node_chromium.subprocess.run", fake_run):
            with self.assertRaises(RuntimeError):
                rendered("http://127.0.0.1:8843/")
        self.assertEqual(captured["argv"][:2], ["node", str(script)])
        self.assertEqual(captured["cwd"], base)

    def test_python_package_without_the_pdf_extra_has_a_typed_unavailable_capability(self):
        with patch("quiltor.infrastructure.pdf.importlib.util.find_spec", return_value=None):
            rendered = pdf.python_package_renderer()
        self.assertIs(rendered, pdf.unavailable.render)
        with self.assertRaises(PdfExportUnavailable) as caught:
            rendered("http://127.0.0.1:8843/")
        self.assertEqual(caught.exception.code, "pdf.unavailable")

    def test_python_package_pdf_extra_selects_the_python_playwright_renderer(self):
        with patch("quiltor.infrastructure.pdf.importlib.util.find_spec", return_value=object()):
            self.assertIs(pdf.python_package_renderer(), system_browser.render)


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
    """The render-token contract remains stable in src/quiltor/infrastructure/pdf/tokens.py."""

    def test_a_token_is_single_use(self):
        from quiltor.infrastructure.identity import InMemoryRenderTokenStore

        store = InMemoryRenderTokenStore()
        token = store.issue("user-1")
        self.assertEqual(store.redeem(token), "user-1")
        self.assertIsNone(store.redeem(token))

    def test_an_unknown_token_is_refused(self):
        from quiltor.infrastructure.identity import InMemoryRenderTokenStore

        self.assertIsNone(InMemoryRenderTokenStore().redeem("never-issued"))


if __name__ == "__main__":
    unittest.main()
