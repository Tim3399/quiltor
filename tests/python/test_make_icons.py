"""T-131, T-248: every icon is the brand's logo, and a check says when one drifts."""

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

    def test_the_home_screen_icon_has_no_transparency(self):
        image = Image.open(io.BytesIO(make_icons.web_icons()["apple-touch-icon.png"]))
        self.assertEqual(image.mode, "RGB")
        self.assertEqual(image.getpixel((0, 0)), (255, 255, 255))

    def test_the_mail_logo_is_the_brand_picture_byte_for_byte(self):
        brand = make_icons.brand_png(192).read_bytes()
        self.assertEqual(make_icons.web_icons()["email-logo.png"], brand)
        self.assertEqual((make_icons.WEB_DIR / "email-logo.png").read_bytes(), brand)

    def test_the_desktop_icons_show_the_brand_pictures(self):
        for name, px in make_icons.ICONSET_SIZES.items():
            picture = (make_icons.ICONSET_DIR / name).read_bytes()
            self.assertEqual(picture, make_icons.brand_png(px).read_bytes(), name)
        tray = (make_icons.OUT_DIR / "tray.png").read_bytes()
        self.assertEqual(tray, make_icons.brand_png(64).read_bytes())


if __name__ == "__main__":
    unittest.main()
