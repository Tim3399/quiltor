"""The desktop window's configuration and its native file bridge.

Only the parts that do not need a window server. The one that matters is
exports: the page cannot write a file by itself, and pywebview's own download
handling cannot do it for us -- on macOS it puts up a modal save panel it can
never answer and then terminates the app. hosts/desktop/bridge/files.py carries
the full trace; these tests pin the arrangement that replaced it.
"""

import ast
import base64
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

from hosts.desktop import app
from hosts.desktop.bridge import FileBridge
from hosts.desktop.bridge.files import BASE64, SAVE_FILE

REPO_ROOT = Path(__file__).resolve().parents[2]
APP_SOURCE = REPO_ROOT / "hosts" / "desktop" / "app.py"


def _main_function() -> ast.FunctionDef:
    tree = ast.parse(APP_SOURCE.read_text(encoding="utf-8"), filename=str(APP_SOURCE))
    return next(
        node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "main"
    )


class PywebviewDownloadTests(unittest.TestCase):
    """ALLOW_DOWNLOADS is pywebview's own `<a download>` route. It looks like the
    fix for dead exports and is in fact the worse bug: switched on, macOS shows
    an application-modal NSSavePanel from inside WebKit's download callback,
    pyobjc cannot call the completion handler block that panel is supposed to
    answer, and the uncaught NSInternalInconsistencyException that follows takes
    the app with it. Verified against pywebview 6.2.1 on macOS 26.5.
    """

    def test_pywebview_downloads_stay_off(self):
        webview = SimpleNamespace(settings={"ALLOW_DOWNLOADS": True})
        app.keep_pywebview_downloads_off(webview)
        self.assertIs(webview.settings["ALLOW_DOWNLOADS"], False)

    def test_other_settings_are_left_alone(self):
        """pywebview's settings dict carries unrelated defaults; replacing it
        wholesale would quietly reset them."""
        webview = SimpleNamespace(
            settings={
                "ALLOW_DOWNLOADS": True,
                "ALLOW_FILE_URLS": True,
                "OPEN_EXTERNAL_LINKS_IN_BROWSER": True,
            }
        )
        app.keep_pywebview_downloads_off(webview)
        self.assertTrue(webview.settings["ALLOW_FILE_URLS"])
        self.assertTrue(webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"])
        self.assertEqual(len(webview.settings), 3)

    def test_the_bridge_is_handed_to_the_window(self):
        """Without js_api there is no window.pywebview.api, and every export in
        the desktop app falls back to an `<a download>` the WebView refuses.
        Checked in the source because main() cannot run here -- it needs a
        window server."""
        create_window = next(
            node
            for node in ast.walk(_main_function())
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "create_window"
        )
        self.assertIn("js_api", [keyword.arg for keyword in create_window.keywords])

    def test_the_bridge_learns_its_window(self):
        """js_api has to be passed *to* create_window, so the bridge exists
        before the window does and has to be told about it afterwards -- without
        that, choose_path() has nothing to open a save panel on."""
        attached = next(
            (
                node
                for node in ast.walk(_main_function())
                if isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "attach"
            ),
            None,
        )
        self.assertIsNotNone(attached, "main() never calls FileBridge.attach()")


class FileBridgeTests(unittest.TestCase):
    """The bridge is the whole export path in the desktop app: the page hands it
    a name and the bytes, it asks where they go and writes them."""

    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.home = Path(self.directory.name)
        self.bridge = FileBridge(directory=self.home)
        self.bridge.attach(SimpleNamespace())  # a window that is never asked anything
        self.asked = []

    def _answer(self, target: "Path | None"):
        def choose(name: str):
            self.asked.append(name)
            return None if target is None else str(target)

        self.bridge.choose_path = choose

    def test_text_is_written_where_the_user_pointed(self):
        target = self.home / "Kapitel.md"
        self._answer(target)
        verdict = self.bridge.save_file("Kapitel.md", "# Kapitel\n\nText\n")
        self.assertTrue(verdict["ok"])
        self.assertEqual(verdict["path"], str(target))
        self.assertEqual(target.read_text(encoding="utf-8"), "# Kapitel\n\nText\n")
        self.assertEqual(self.asked, ["Kapitel.md"], "the suggested name has to reach the panel")

    def test_binary_arrives_intact(self):
        """The book PDF is bytes, and the js_api bridge carries JSON -- base64 is
        how they cross it. A PDF that loses a byte is a PDF that will not open."""
        target = self.home / "Buch.pdf"
        self._answer(target)
        payload = b"%PDF-1.7\n\x00\x01\xfe\xff binary \n%%EOF"
        verdict = self.bridge.save_file(
            "Buch.pdf", base64.b64encode(payload).decode("ascii"), BASE64
        )
        self.assertTrue(verdict["ok"])
        self.assertEqual(target.read_bytes(), payload)

    def test_umlauts_survive_as_utf8(self):
        target = self.home / "Steckbriefe.md"
        self._answer(target)
        self.bridge.save_file("Steckbriefe.md", "Grüße aus Köln – „Testwelt“")
        self.assertEqual(target.read_text(encoding="utf-8"), "Grüße aus Köln – „Testwelt“")

    def test_cancelling_is_not_an_error(self):
        """Dismissing the save panel is a decision. The page shows nothing for
        it, so it must not come back looking like a failure."""
        self._answer(None)
        verdict = self.bridge.save_file("Kapitel.md", "Text")
        self.assertFalse(verdict.get("ok"))
        self.assertTrue(verdict["cancelled"])
        self.assertNotIn("error", verdict)
        self.assertEqual(list(self.home.iterdir()), [])

    def test_a_failing_dialog_reports_instead_of_raising(self):
        """A raised exception crosses the bridge as a rejected promise carrying a
        Python traceback -- not something to show a novelist, and on some
        backends not something the window survives."""

        def explode(name: str):
            raise RuntimeError("no window server")

        self.bridge.choose_path = explode
        verdict = self.bridge.save_file("Kapitel.md", "Text")
        self.assertFalse(verdict.get("ok"))
        self.assertIn("no window server", verdict["error"])

    def test_an_unwritable_location_reports_the_reason(self):
        self._answer(self.home / "missing-folder" / "Kapitel.md")
        verdict = self.bridge.save_file("Kapitel.md", "Text")
        self.assertFalse(verdict.get("ok"))
        self.assertIn("Kapitel.md", verdict["error"])

    def test_broken_base64_reports_instead_of_writing_rubbish(self):
        target = self.home / "Buch.pdf"
        self._answer(target)
        verdict = self.bridge.save_file("Buch.pdf", "not base64 at all!!", BASE64)
        self.assertFalse(verdict.get("ok"))
        self.assertFalse(target.exists())

    def test_without_a_window_it_says_so(self):
        bridge = FileBridge(directory=self.home)
        verdict = bridge.save_file("Kapitel.md", "Text")
        self.assertFalse(verdict.get("ok"))
        self.assertTrue(verdict["error"])

    def test_the_next_export_starts_where_the_last_one_landed(self):
        folder = self.home / "Manuskripte"
        folder.mkdir()
        self._answer(folder / "Kapitel.md")
        self.bridge.save_file("Kapitel.md", "Text")
        self.assertEqual(self.bridge._directory, folder)

    def test_only_save_file_reaches_the_page(self):
        """pywebview publishes every public attribute of the js_api object and
        recurses into the ones that are not callable (webview/util.py::
        get_functions). A public `window` attribute would therefore re-export
        the entire pywebview Window to the page, and a public `directory` would
        export pathlib. Both are private here; the host-side methods are marked
        unserializable.
        """
        exposed = [
            name
            for name in dir(self.bridge)
            if not name.startswith("_")
            and getattr(getattr(self.bridge, name), "_serializable", True)
        ]
        self.assertEqual(exposed, [SAVE_FILE])


if __name__ == "__main__":
    unittest.main()
