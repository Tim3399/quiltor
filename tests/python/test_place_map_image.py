"""Map images are identified by their bytes, never by what the uploader says.

The serving route hands these bytes back on the application's own origin and the
product ships no Content-Security-Policy, so the refusals below are the control
that keeps an SVG -- markup a browser will execute -- out of the store.
"""

import unittest
from pathlib import Path

from quiltor.domain.story_world.place_map_image import (
    MAX_IMAGE_BYTES,
    UnsupportedImage,
    identify,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
REAL_WEBP = REPO_ROOT / "packages/client/src/modules/manuscript/assets/paper-fiber-texture.webp"
REAL_PNG = REPO_ROOT / "distribution/assets/icons/icon.iconset/icon_128x128.png"


def jpeg(width: int, height: int, *, padded: bool = False) -> bytes:
    """A JPEG carrying one skippable segment before its frame header."""

    application_segment = b"\xff\xe0" + (16).to_bytes(2, "big") + b"JFIF\x00" + b"\x00" * 9
    frame = (
        b"\xff\xc0"
        + (11).to_bytes(2, "big")
        + b"\x08"
        + height.to_bytes(2, "big")
        + width.to_bytes(2, "big")
        + b"\x01\x01\x11\x00"
    )
    fill = b"\xff" if padded else b""
    return b"\xff\xd8" + application_segment + fill + frame + b"\xff\xd9"


class MapImageIdentificationTests(unittest.TestCase):
    def test_reads_real_png_and_webp_from_the_repository(self):
        """Hand-built headers can agree with a bug; shipped files cannot."""

        png = identify(REAL_PNG.read_bytes())
        self.assertEqual((png.mime, png.width, png.height), ("image/png", 128, 128))
        webp = identify(REAL_WEBP.read_bytes())
        self.assertEqual((webp.mime, webp.width, webp.height), ("image/webp", 640, 640))

    def test_jpeg_dimensions_come_from_the_frame_header(self):
        found = identify(jpeg(1280, 720))
        self.assertEqual((found.mime, found.width, found.height), ("image/jpeg", 1280, 720))

    def test_jpeg_fill_bytes_between_segments_are_not_a_new_marker(self):
        """0xFF repeats as legal padding; treating it as a marker loses the frame."""

        found = identify(jpeg(64, 32, padded=True))
        self.assertEqual((found.width, found.height), (64, 32))

    def test_an_svg_announced_as_an_image_is_refused(self):
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        with self.assertRaises(UnsupportedImage):
            identify(svg)

    def test_other_raster_formats_are_refused_rather_than_guessed(self):
        for payload in (b"GIF89a" + b"\x00" * 20, b"BM" + b"\x00" * 20, b"II*\x00" + b"\x00" * 20):
            with self.subTest(payload=payload[:4]):
                with self.assertRaises(UnsupportedImage):
                    identify(payload)

    def test_empty_and_oversized_payloads_are_refused(self):
        with self.assertRaises(UnsupportedImage):
            identify(b"")
        with self.assertRaises(UnsupportedImage):
            identify(b"\x89PNG\r\n\x1a\n" + b"\x00" * (MAX_IMAGE_BYTES + 1))

    def test_a_truncated_header_is_refused_rather_than_read_past(self):
        with self.assertRaises(UnsupportedImage):
            identify(b"\x89PNG\r\n\x1a\n" + b"\x00" * 8)
        with self.assertRaises(UnsupportedImage):
            identify(b"\xff\xd8\xff\xc0")
        with self.assertRaises(UnsupportedImage):
            identify(b"RIFF" + b"\x00" * 4 + b"WEBPVP8 " + b"\x00" * 4)

    def test_a_zero_dimension_is_refused(self):
        with self.assertRaises(UnsupportedImage):
            identify(jpeg(0, 100))

    def test_an_implausibly_large_dimension_is_refused(self):
        """A 65535 x 65535 header is a decompression bomb, not somebody's map."""

        with self.assertRaises(UnsupportedImage):
            identify(jpeg(65535, 65535))


if __name__ == "__main__":
    unittest.main()
