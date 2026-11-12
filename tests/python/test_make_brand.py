"""T-248: the brand files are drawn reproducibly, and the checked-in ones are current."""

import importlib.util
import io
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "distribution" / "tooling"))

if any(importlib.util.find_spec(m) is None for m in ("fontTools", "PIL", "numpy")):
    raise unittest.SkipTest("needs fontTools, Pillow and numpy (the brand generator's tools)")

import make_brand  # noqa: E402
from PIL import Image  # noqa: E402


class BrandFileTests(unittest.TestCase):
    def test_two_runs_write_the_same_bytes_as_the_checked_in_files(self):
        first = make_brand.brand_files()
        second = make_brand.brand_files()
        self.assertEqual(first, second)
        stale = [
            name
            for name, data in first.items()
            if not make_brand.same_file(name, (make_brand.OUT_DIR / name).read_bytes(), data)
        ]
        self.assertEqual(stale, [])

    def test_every_generated_file_including_the_client_module_is_current(self):
        # check() also covers brandMark.generated.ts, which brand_files() leaves out.
        self.assertEqual(make_brand.check(), [])

    def test_a_png_is_compared_by_its_pixels_and_every_other_file_by_its_bytes(self):
        def png(pixel, level):
            image = Image.new("RGBA", (8, 8), (10, 20, 30, 255))
            image.putpixel((3, 5), pixel)
            buffer = io.BytesIO()
            image.save(buffer, format="PNG", compress_level=level)
            return buffer.getvalue()

        drawn = png((10, 20, 30, 255), 9)
        repacked = png((10, 20, 30, 255), 0)
        self.assertNotEqual(drawn, repacked)  # same picture, other bytes
        self.assertTrue(make_brand.same_file("a.png", repacked, drawn))
        # one pixel, one channel, one step: the comparison has no tolerance
        self.assertFalse(make_brand.same_file("a.png", png((10, 20, 31, 255), 9), drawn))
        self.assertFalse(make_brand.same_file("a.png", b"not a png", drawn))
        self.assertFalse(make_brand.same_file("a.svg", b"<svg/> ", b"<svg/>"))
        self.assertTrue(make_brand.same_file("a.svg", b"<svg/>", b"<svg/>"))

    def test_the_pictures_reference_no_web_font(self):
        for name, data in make_brand.brand_files().items():
            if name.endswith(".svg"):
                self.assertNotIn(b"<text", data, name)
                self.assertNotIn(b"font-family", data, name)

    def test_the_licence_ships_beside_the_outlines(self):
        licence = (make_brand.OUT_DIR / "OFL.txt").read_text(encoding="utf-8")
        self.assertIn("SIL Open Font License, Version 1.1", licence)


if __name__ == "__main__":
    unittest.main()
