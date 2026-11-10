"""T-131: the web icons are derived from the app icon, and a check says when they drift."""

import importlib.util
import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "distribution" / "tooling"))

if importlib.util.find_spec("PIL") is None:  # Pillow is an optional (desktop) dependency
    raise unittest.SkipTest("needs Pillow")

import make_icons  # noqa: E402
from PIL import Image  # noqa: E402


class WebIconTests(unittest.TestCase):
    def test_the_checked_in_web_icons_match_the_app_icon(self):
        self.assertEqual(make_icons.check_web_icons(), [])

    def test_a_web_icon_that_no_longer_shows_the_app_icon_is_named(self):
        with tempfile.TemporaryDirectory() as directory:
            web = Path(directory)
            for name in make_icons.web_icons():
                shutil.copy(make_icons.WEB_DIR / name, web / name)
            image = Image.open(web / "apple-touch-icon.png")
            image.putpixel((90, 90), (0, 0, 0))
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            (web / "apple-touch-icon.png").write_bytes(buffer.getvalue())
            (web / "email-logo.png").unlink()

            problems = make_icons.check_web_icons(web_dir=web)

        self.assertEqual(len(problems), 2, problems)
        self.assertIn("apple-touch-icon.png does not match the app icon", problems[0])
        self.assertIn("email-logo.png is missing", problems[1])

    def test_the_opaque_icons_have_no_transparency(self):
        for name in ("apple-touch-icon.png", "email-logo.png"):
            image = Image.open(io.BytesIO(make_icons.web_icons()[name]))
            self.assertEqual(image.mode, "RGB", name)
            self.assertEqual(image.getpixel((0, 0)), (255, 255, 255), name)


if __name__ == "__main__":
    unittest.main()
