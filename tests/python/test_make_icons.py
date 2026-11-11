"""T-131, T-248: every icon is the brand's logo, and a check says when one drifts."""

import importlib.util
import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, cast

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

    def test_the_windows_icon_holds_the_brand_picture_at_every_size(self):
        data = (make_icons.OUT_DIR / "icon.ico").read_bytes()
        frames = make_icons._frames(data)
        self.assertEqual([size for _, size, _ in frames], [(s, s) for s in make_icons.ICO_SIZES])
        self.assertEqual(frames, make_icons._frames(make_icons._ico(make_icons.ICO_SIZES)))

    def test_the_macos_icon_holds_the_brand_picture_at_every_size_it_stores(self):
        with Image.open(make_icons.OUT_DIR / "icon.icns") as opened:
            # IcnsImageFile picks a size by assignment and load(scale); its stubs say neither.
            image = cast(Any, opened)
            stored = sorted(image.info["sizes"])
            self.assertTrue(stored, "icon.icns holds no pictures")
            for width, height, scale in stored:
                px = width * scale
                self.assertEqual(width, height)
                image.size = (width, height)
                image.load(scale)
                expected = make_icons._brand(px)
                label = f"{width}@{scale}x"
                self.assertEqual(image.size, expected.size, label)
                self.assertEqual(image.convert("RGBA").tobytes(), expected.tobytes(), label)

    def test_the_macos_icon_stores_every_frame_macos_looks_for(self):
        data = (make_icons.OUT_DIR / "icon.icns").read_bytes()
        kinds = [kind.decode("ascii") for kind, _ in make_icons.icns_elements(data)]
        # ic04/ic05 are the 16 and 32 px 1x frames; without them macOS scales a larger one down.
        self.assertEqual(
            kinds,
            [
                "TOC ",
                "ic04",
                "ic05",
                "ic07",
                "ic08",
                "ic09",
                "ic10",
                "ic11",
                "ic12",
                "ic13",
                "ic14",
            ],
        )
        # and the writer still makes the same list, so a redraw cannot drop them again
        written = [
            kind.decode("ascii") for kind, _ in make_icons.icns_elements(make_icons.icns_file())
        ]
        self.assertEqual(written, kinds)

    def test_the_small_macos_frames_decode_to_the_brand_pictures(self):
        elements = dict(make_icons.icns_elements((make_icons.OUT_DIR / "icon.icns").read_bytes()))
        for kind, px in make_icons.ICNS_ARGB_FRAMES.items():
            payload = elements[kind]
            self.assertEqual(payload[:4], b"ARGB", kind)
            planes, rest = [], payload[4:]
            for _ in range(4):  # alpha, red, green, blue
                plane = bytearray()
                while len(plane) < px * px:
                    control, rest = rest[0], rest[1:]
                    if control < 0x80:
                        plane += rest[: control + 1]
                        rest = rest[control + 1 :]
                    else:
                        plane += rest[:1] * (control - 0x80 + 3)
                        rest = rest[1:]
                self.assertEqual(len(plane), px * px, kind)
                planes.append(bytes(plane))
            self.assertEqual(rest, b"", kind)
            rgba = bytearray(px * px * 4)
            rgba[0::4], rgba[1::4], rgba[2::4], rgba[3::4] = (
                planes[1],
                planes[2],
                planes[3],
                planes[0],
            )
            self.assertEqual(bytes(rgba), make_icons._brand(px).tobytes(), kind)
            self.assertEqual(payload, make_icons.icns_argb(px), kind)


if __name__ == "__main__":
    unittest.main()
