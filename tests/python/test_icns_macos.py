"""T-263: Apple's own reader accepts the hand-written ic04/ic05 frames of icon.icns.

macOS only, and standard library only: the backend job on macOS has neither Pillow nor
fontTools, so this module must not import them. iconutil is the reader that matters, and
the pictures it writes back are compared with the brand's 16 and 32 px PNGs.
"""

import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ICNS = REPO_ROOT / "distribution" / "assets" / "icons" / "icon.icns"
BRAND_PNG_DIR = REPO_ROOT / "distribution" / "assets" / "brand" / "png"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
CHANNELS = {0: 1, 2: 3, 4: 2, 6: 4}  # PNG colour type -> samples per pixel


def decode_png(data: bytes) -> tuple[int, int, list[tuple[int, int, int, int]]]:
    """(width, height, RGBA pixels) of a non-interlaced 8-bit grey, grey+alpha, RGB or RGBA PNG."""

    if data[:8] != PNG_SIGNATURE:
        raise ValueError("not a PNG file")
    offset, idat, header = 8, b"", None
    while offset < len(data):
        length, kind = struct.unpack(">I4s", data[offset : offset + 8])
        body = data[offset + 8 : offset + 8 + length]
        if kind == b"IHDR":
            header = struct.unpack(">IIBBBBB", body)
        elif kind == b"IDAT":
            idat += body
        offset += 12 + length
    if header is None:
        raise ValueError("no IHDR chunk")
    width, height, depth, color, _, _, interlace = header
    if depth != 8 or color not in CHANNELS or interlace:
        raise ValueError(
            f"unsupported PNG: depth {depth}, colour type {color}, interlace {interlace}"
        )
    step = CHANNELS[color]
    stride = width * step
    raw = zlib.decompress(idat)
    rows: list[bytearray] = []
    for y in range(height):
        start = y * (stride + 1)
        kind, line = raw[start], bytearray(raw[start + 1 : start + 1 + stride])
        previous = rows[-1] if rows else bytearray(stride)
        for i in range(stride):
            left = line[i - step] if i >= step else 0
            up = previous[i]
            corner = previous[i - step] if i >= step else 0
            if kind == 1:
                line[i] = (line[i] + left) & 255
            elif kind == 2:
                line[i] = (line[i] + up) & 255
            elif kind == 3:
                line[i] = (line[i] + (left + up) // 2) & 255
            elif kind == 4:
                estimate = left + up - corner
                near = min(
                    (abs(estimate - left), 0, left),
                    (abs(estimate - up), 1, up),
                    (abs(estimate - corner), 2, corner),
                )[2]
                line[i] = (line[i] + near) & 255
            elif kind != 0:
                raise ValueError(f"unknown PNG filter {kind}")
        rows.append(line)
    pixels = []
    for line in rows:
        for x in range(width):
            p = line[x * step : (x + 1) * step]
            if color == 6:
                pixels.append((p[0], p[1], p[2], p[3]))
            elif color == 2:
                pixels.append((p[0], p[1], p[2], 255))
            elif color == 4:
                pixels.append((p[0], p[0], p[0], p[1]))
            else:
                pixels.append((p[0], p[0], p[0], 255))
    return width, height, pixels


class IcnsDecoderTests(unittest.TestCase):
    """The comparison below is only as good as this decoder, so it is checked on any host."""

    def test_the_decoder_reads_a_brand_picture_it_can_be_given(self):
        data = (BRAND_PNG_DIR / "quiltor-logo-light-16.png").read_bytes()
        width, height, pixels = decode_png(data)
        self.assertEqual((width, height, len(pixels)), (16, 16, 256))
        self.assertTrue(any(p[3] > 0 for p in pixels), "the brand picture is fully transparent")
        self.assertTrue(
            any(p[3] == 0 for p in pixels), "the brand picture has no transparent corner"
        )

    def test_the_decoder_undoes_every_png_filter(self):
        width, height, step = 5, 5, 4
        image = [
            bytes((x * 37 + y * 11 + c * 53) % 256 for x in range(width) for c in range(step))
            for y in range(height)
        ]

        def predict_best(a, b, c):
            p = a + b - c
            return min((abs(p - a), 0, a), (abs(p - b), 1, b), (abs(p - c), 2, c))[2]

        raw = b""
        for y, line in enumerate(image):
            kind = y % 5  # none, sub, up, average, predict_best
            above = image[y - 1] if y else bytes(len(line))
            out = bytearray()
            for i, value in enumerate(line):
                left = line[i - step] if i >= step else 0
                up = above[i]
                corner = above[i - step] if i >= step else 0
                predicted = (0, left, up, (left + up) // 2, predict_best(left, up, corner))[kind]
                out.append((value - predicted) & 255)
            raw += bytes([kind]) + bytes(out)

        def chunk(kind, body):
            return (
                struct.pack(">I", len(body))
                + kind
                + body
                + struct.pack(">I", zlib.crc32(kind + body))
            )

        png = (
            PNG_SIGNATURE
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw))
            + chunk(b"IEND", b"")
        )
        got = decode_png(png)
        want = [tuple(line[i : i + 4]) for line in image for i in range(0, len(line), 4)]
        self.assertEqual(got, (width, height, want))


@unittest.skipUnless(
    sys.platform == "darwin" and shutil.which("iconutil"), "needs macOS and iconutil"
)
class IconutilReadsIcnsTests(unittest.TestCase):
    def test_iconutil_reads_the_small_frames_as_the_brand_pictures(self):
        with tempfile.TemporaryDirectory() as directory:
            copy = Path(directory) / "icon.icns"
            shutil.copy(ICNS, copy)
            iconset = Path(directory) / "x.iconset"
            result = subprocess.run(
                ["iconutil", "-c", "iconset", str(copy), "-o", str(iconset)],
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            for name, px in (("icon_16x16.png", 16), ("icon_32x32.png", 32)):
                self.assertTrue((iconset / name).exists(), f"{name} is missing")
                got = decode_png((iconset / name).read_bytes())
                want = decode_png((BRAND_PNG_DIR / f"quiltor-logo-light-{px}.png").read_bytes())
                self.assertEqual(got[:2], want[:2], name)
                for a, b in zip(got[2], want[2], strict=True):
                    # iconutil may premultiply: colour is meaningless where nothing shows
                    if b[3] == 0:
                        self.assertLessEqual(a[3], 1, name)
                    else:
                        self.assertLessEqual(
                            max(abs(x - y) for x, y in zip(a, b, strict=True)), 2, name
                        )


if __name__ == "__main__":
    unittest.main()
