"""The desktop window's configuration.

Only the parts that do not need a window server. The one that matters is
downloads: pywebview refuses them by default, which silently disabled every
export in the shipped desktop app.
"""
import ast
import re
import unittest
from pathlib import Path
from types import SimpleNamespace

from hosts.desktop import app

REPO_ROOT = Path(__file__).resolve().parents[2]
APP_SOURCE = REPO_ROOT / "hosts" / "desktop" / "app.py"


class DownloadTests(unittest.TestCase):
    """pywebview's ALLOW_DOWNLOADS defaults to False, and all three backends
    gate on it -- cocoa.py's decidePolicyForNavigationAction, edgechromium.py
    and gtk.py alike. Unset, an `<a download>` click does nothing at all: no
    file, no error, no console message. All five of Quiltor's exports are blob
    URLs behind exactly that, so all five were dead in the desktop build on
    every platform.
    """

    def test_downloads_are_switched_on(self):
        webview = SimpleNamespace(settings={"ALLOW_DOWNLOADS": False})
        app.enable_downloads(webview)
        self.assertIs(webview.settings["ALLOW_DOWNLOADS"], True)

    def test_other_settings_are_left_alone(self):
        """pywebview's settings dict carries unrelated defaults; replacing it
        wholesale would quietly reset them."""
        webview = SimpleNamespace(settings={"ALLOW_DOWNLOADS": False, "ALLOW_FILE_URLS": True,
                                            "OPEN_EXTERNAL_LINKS_IN_BROWSER": True})
        app.enable_downloads(webview)
        self.assertTrue(webview.settings["ALLOW_FILE_URLS"])
        self.assertTrue(webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"])
        self.assertEqual(len(webview.settings), 3)

    def test_downloads_are_enabled_before_the_window_exists(self):
        """A setting applied after create_window() would be read too late for
        the navigation policy that consults it. Checked in the source because
        main() cannot run here -- it needs a window server."""
        tree = ast.parse(APP_SOURCE.read_text(encoding="utf-8"), filename=str(APP_SOURCE))
        main = next(node for node in tree.body
                    if isinstance(node, ast.FunctionDef) and node.name == "main")

        def line_of(predicate) -> int:
            return next(node.lineno for node in ast.walk(main)
                        if isinstance(node, ast.Call) and predicate(node))

        enabled = line_of(lambda call: isinstance(call.func, ast.Name)
                          and call.func.id == "enable_downloads")
        window = line_of(lambda call: isinstance(call.func, ast.Attribute)
                         and call.func.attr == "create_window")
        self.assertLess(enabled, window)


class PywebviewFloorTests(unittest.TestCase):
    def test_the_declared_floor_is_a_release_that_acts_on_the_setting(self):
        """pywebview 5.0 through 5.3 accept ALLOW_DOWNLOADS but no backend reads
        it -- the setting exists, the behaviour does not, so enable_downloads()
        would be silently useless there and every export would stay dead. 5.4 is
        where cocoa.py gained shouldPerformDownload and DownloadDelegate.

        Verified by installing 5.0, 5.2, 5.3 and 5.4 and grepping their
        backends; this pins the conclusion so the floor is not relaxed back.
        """
        pyproject = (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
        floor = re.search(r'"pywebview>=(\d+)\.(\d+)"', pyproject)
        self.assertIsNotNone(floor, "the desktop extra no longer pins pywebview")
        major, minor = int(floor.group(1)), int(floor.group(2))
        self.assertGreaterEqual((major, minor), (5, 4),
                                "pywebview below 5.4 ignores ALLOW_DOWNLOADS on every backend")


if __name__ == "__main__":
    unittest.main()
