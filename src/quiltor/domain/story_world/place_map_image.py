"""Format identification for map images, decided by their bytes.

A map image is the first user-supplied binary the product accepts, and it is
served back from the application's own origin. What the uploader calls the file
therefore decides nothing: an SVG announced as `image/png` would otherwise be
stored and later handed to a browser that reads the markup and runs the script
inside it. The format is read out of the leading bytes here instead, and only
the three raster formats below can be named at all.

Dimensions come from the same headers rather than from a decoder, because the
product's only image library is an optional desktop extra (see pyproject) and a
map frame needs its aspect ratio on every host.
"""

from __future__ import annotations

from dataclasses import dataclass

PNG_MIME = "image/png"
JPEG_MIME = "image/jpeg"
WEBP_MIME = "image/webp"

#: The formats a map image may be stored in, in the order they are probed.
SUPPORTED_MIME_TYPES: tuple[str, ...] = (PNG_MIME, JPEG_MIME, WEBP_MIME)

#: Well under the 16 MB request ceiling, leaving room for base64's third.
MAX_IMAGE_BYTES = 10 * 1024 * 1024

#: A frame with no area cannot be placed, and a dimension this large is a
#: decompression bomb rather than a map somebody drew.
MAX_IMAGE_EDGE = 20_000

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_JPEG_SIGNATURE = b"\xff\xd8"

# Start-of-frame markers carry the dimensions. 0xC4, 0xC8 and 0xCC share the
# range but define Huffman tables, arithmetic coding conditioning and lossless
# extensions instead, so they are skipped like any other segment.
_JPEG_FRAME_MARKERS = frozenset(
    marker for marker in range(0xC0, 0xD0) if marker not in {0xC4, 0xC8, 0xCC}
)
_JPEG_APP1 = 0xE1
_EXIF_ORIENTATION_TAG = 0x0112
_JPEG_STANDALONE_MARKERS = frozenset({0x01, *range(0xD0, 0xD8)})


class UnsupportedImage(ValueError):
    """The bytes are not one of the raster formats a map image may use."""


@dataclass(frozen=True)
class ImageFormat:
    """What the bytes turned out to be."""

    mime: str
    width: int
    height: int


def identify(payload: bytes) -> ImageFormat:
    """Read `payload`'s real format and pixel size, or refuse it.

    Every rejection raises `UnsupportedImage`; callers never have to tell an
    unknown format apart from a truncated one, because neither may be stored.
    """

    if not payload:
        raise UnsupportedImage("Empty image payload.")
    if len(payload) > MAX_IMAGE_BYTES:
        raise UnsupportedImage("Image payload is larger than the accepted maximum.")

    if payload.startswith(_PNG_SIGNATURE):
        return _checked(PNG_MIME, *_png_dimensions(payload))
    if payload.startswith(_JPEG_SIGNATURE):
        return _checked(JPEG_MIME, *_jpeg_dimensions(payload))
    if payload[:4] == b"RIFF" and payload[8:12] == b"WEBP":
        return _checked(WEBP_MIME, *_webp_dimensions(payload))
    raise UnsupportedImage("Only PNG, JPEG and WebP map images are supported.")


def _checked(mime: str, width: int, height: int) -> ImageFormat:
    if width <= 0 or height <= 0 or width > MAX_IMAGE_EDGE or height > MAX_IMAGE_EDGE:
        raise UnsupportedImage("Image dimensions are outside the accepted range.")
    return ImageFormat(mime=mime, width=width, height=height)


def _png_dimensions(payload: bytes) -> tuple[int, int]:
    # IHDR is mandated to be the first chunk, so the dimensions sit at a fixed
    # offset: 8 signature bytes, 4 length, 4 type, then two big-endian widths.
    if len(payload) < 24 or payload[12:16] != b"IHDR":
        raise UnsupportedImage("PNG header is incomplete.")
    return (
        int.from_bytes(payload[16:20], "big"),
        int.from_bytes(payload[20:24], "big"),
    )


def _jpeg_dimensions(payload: bytes) -> tuple[int, int]:
    """Frame size as a browser will show it, so EXIF quarter turns swap it.

    A frame header holds the sensor's pixels. A browser applies the Exif
    orientation when it draws an `<img>`, so a phone photo taken upright is
    stored 4000 by 3000 and shown 3000 by 4000. The frame built from the stored
    size would then be turned on its side around a picture that is not.
    """

    position = 2
    quarter_turn = False
    limit = len(payload)
    while position + 1 < limit:
        if payload[position] != 0xFF:
            raise UnsupportedImage("JPEG segment structure is invalid.")
        marker = payload[position + 1]
        position += 2
        # Fill bytes are legal padding between segments.
        if marker == 0xFF:
            position -= 1
            continue
        if marker in _JPEG_STANDALONE_MARKERS:
            continue
        if position + 2 > limit:
            break
        length = int.from_bytes(payload[position : position + 2], "big")
        if length < 2:
            raise UnsupportedImage("JPEG segment length is invalid.")
        if marker in _JPEG_FRAME_MARKERS:
            if position + 7 > limit:
                break
            width = int.from_bytes(payload[position + 5 : position + 7], "big")
            height = int.from_bytes(payload[position + 3 : position + 5], "big")
            return (height, width) if quarter_turn else (width, height)
        if marker == _JPEG_APP1:
            quarter_turn = quarter_turn or _exif_is_quarter_turn(
                payload[position + 2 : position + length]
            )
        position += length
    raise UnsupportedImage("JPEG carries no frame header.")


def _exif_is_quarter_turn(segment: bytes) -> bool:
    """Whether an APP1 body is Exif whose orientation (tag 0x0112) is 5 to 8.

    Anything unreadable counts as no rotation: a damaged Exif block must not
    cost a picture whose frame header is fine.
    """

    if not segment.startswith(b"Exif\x00\x00"):
        return False
    tiff = segment[6:]
    if tiff[:2] == b"II":
        order = "little"
    elif tiff[:2] == b"MM":
        order = "big"
    else:
        return False
    if len(tiff) < 8 or int.from_bytes(tiff[2:4], order) != 0x2A:
        return False
    directory = int.from_bytes(tiff[4:8], order)
    if directory + 2 > len(tiff):
        return False
    entries = int.from_bytes(tiff[directory : directory + 2], order)
    for index in range(entries):
        start = directory + 2 + index * 12
        if start + 12 > len(tiff):
            return False
        if int.from_bytes(tiff[start : start + 2], order) == _EXIF_ORIENTATION_TAG:
            # A SHORT stored inline: the value sits in the first two value bytes.
            return int.from_bytes(tiff[start + 8 : start + 10], order) in range(5, 9)
    return False


def _webp_dimensions(payload: bytes) -> tuple[int, int]:
    chunk = payload[12:16]
    if chunk == b"VP8 ":
        # Lossy: a three byte frame tag, the sync code, then 14 bit dimensions.
        if len(payload) < 30 or payload[23:26] != b"\x9d\x01\x2a":
            raise UnsupportedImage("WebP lossy header is incomplete.")
        return (
            int.from_bytes(payload[26:28], "little") & 0x3FFF,
            int.from_bytes(payload[28:30], "little") & 0x3FFF,
        )
    if chunk == b"VP8L":
        # Lossless: a signature byte, then 14 bits each, both stored one less.
        if len(payload) < 25 or payload[20] != 0x2F:
            raise UnsupportedImage("WebP lossless header is incomplete.")
        bits = int.from_bytes(payload[21:25], "little")
        return ((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1)
    if chunk == b"VP8X":
        # Extended: flags, then the canvas size as two 24 bit values, less one.
        if len(payload) < 30:
            raise UnsupportedImage("WebP extended header is incomplete.")
        return (
            int.from_bytes(payload[24:27], "little") + 1,
            int.from_bytes(payload[27:30], "little") + 1,
        )
    raise UnsupportedImage("WebP variant is not supported.")


__all__ = [
    "MAX_IMAGE_BYTES",
    "MAX_IMAGE_EDGE",
    "SUPPORTED_MIME_TYPES",
    "ImageFormat",
    "UnsupportedImage",
    "identify",
]
