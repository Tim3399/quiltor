"""T-248: the brand files are drawn reproducibly, and the checked-in ones are current."""

import importlib.util
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "distribution" / "tooling"))

if any(importlib.util.find_spec(m) is None for m in ("fontTools", "PIL", "numpy")):
    raise unittest.SkipTest("needs fontTools, Pillow and numpy (the brand generator's tools)")

import make_brand  # noqa: E402


class BrandFileTests(unittest.TestCase):
    def test_two_runs_write_the_same_bytes_as_the_checked_in_files(self):
        first = make_brand.brand_files()
        second = make_brand.brand_files()
        self.assertEqual(first, second)
        stale = [
            name for name, data in first.items() if (make_brand.OUT_DIR / name).read_bytes() != data
        ]
        self.assertEqual(stale, [])

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
