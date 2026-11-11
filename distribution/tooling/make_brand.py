#!/usr/bin/env python3
"""Draws Quiltor's brand files -- logo 3, "Goldener Schwanz", and the wordmark -- as real
outlines from Playfair Display 700 (T-248).

The Q is ink; only its tail is gold. The split is the glyph's own: Playfair draws the tail
as a contour of its own that starts at the baseline, so the tail is painted gold and the
bowl is painted ink on top of it. No clip line cuts through a stroke.

Produces, in distribution/assets/brand/:
  quiltor-logo-light.svg            logo on the light paper plate
  quiltor-logo-dark.svg             logo on the dark plate
  quiltor-logo-transparent.svg      logo without a plate, for light backgrounds
  quiltor-logo-<variant>-small.svg  the small form, which the 16 and 24 px PNGs show
  quiltor-wordmark-light.svg        "Quiltor" for light backgrounds
  quiltor-wordmark-dark.svg         "Quiltor" for dark backgrounds
  png/quiltor-logo-<variant>-<size>.png   the three logos at 16 ... 1024 px
  OFL.txt                           the font's licence; the outlines derive from it

The pictures need nothing at runtime: every letter is a path, no web font is referenced.
Rendering is done here, with Pillow and numpy, so the PNGs do not depend on a browser or a
system font. Running it twice writes the same bytes.

Needs fontTools 4.55.8 (`py -3.12 -m pip install --user fonttools==4.55.8`), Pillow and numpy.

    py -3.12 distribution/tooling/make_brand.py
    py -3.12 distribution/tooling/make_brand.py --check   # checked-in files are current
"""

from __future__ import annotations

import hashlib
import io
import sys
from pathlib import Path

import fontTools.pens.recordingPen as recording_pen  # pyright: ignore[reportMissingImports]
import fontTools.varLib.instancer as instancer  # pyright: ignore[reportMissingImports]

# The brand tooling is not installed for CI's type check; see the docstring.
import numpy as np  # pyright: ignore[reportMissingImports]
from fontTools.pens.basePen import BasePen  # pyright: ignore[reportMissingImports]
from fontTools.pens.svgPathPen import SVGPathPen  # pyright: ignore[reportMissingImports]
from fontTools.pens.transformPen import TransformPen  # pyright: ignore[reportMissingImports]
from fontTools.ttLib import TTFont  # pyright: ignore[reportMissingImports]
from PIL import Image, ImageDraw

REPO_ROOT = Path(__file__).resolve().parents[2]
FONT_DIR = REPO_ROOT / "distribution" / "tooling" / "fonts"
FONT_FILE = FONT_DIR / "PlayfairDisplay[wght].ttf"
# google/fonts at 8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5, ofl/playfairdisplay/
FONT_SHA256 = "c40f2293766a503bc70cce9e512ef844a4ccb7cbcde792fe2ea31d191917d8d6"
OUT_DIR = REPO_ROOT / "distribution" / "assets" / "brand"

INK = "#241f18"
GOLD = "#965f10"
CREAM = "#ede6d8"
GOLD_LIGHT = "#c08a33"
# Plates: top colour, bottom colour, rim (the draft's paperPlate).
PLATE_LIGHT = ("#fffaf1", "#f1e4cc", "#e3d3b4")
PLATE_DARK = ("#2a2520", "#16130f", "#3a332b")

VARIANTS = {
    "light": {"plate": PLATE_LIGHT, "body": INK, "tail": GOLD},
    "dark": {"plate": PLATE_DARK, "body": CREAM, "tail": GOLD_LIGHT},
    "transparent": {"plate": None, "body": INK, "tail": GOLD},
}
PNG_SIZES = [16, 24, 32, 48, 64, 128, 180, 192, 256, 512, 1024]

BOX = 128  # the logo's design grid, as in the draft
SQUIRCLE = [  # the draft's iOS-like squircle, its S commands written out as C
    ((64, 2), (112, 2), (126, 16), (126, 64)),
    ((126, 64), (126, 112), (112, 126), (64, 126)),
    ((64, 126), (16, 126), (2, 112), (2, 64)),
    ((2, 64), (2, 16), (16, 2), (64, 2)),
]
RIM_WIDTH = 1.2
Q_SIZE, Q_CENTRE_X, Q_BASELINE = 96, 64, 92  # the draft's <text x=64 y=92 font-size=96>
# The small form, for 16 and 24 px: at the draft's size the tail shrinks to a smudge of a
# pixel. The Q fills more of the plate, the rim goes, and the tail is drawn a little
# heavier -- an outline of SMALL_TAIL_STROKE grid units around it.
SMALL_Q_SIZE, SMALL_TAIL_STROKE, SMALL_SIZES = 116, 4.0, (16, 24)

WORD_SIZE, WORD_TRACKING, WORD_MARGIN = 88, -1, 4


def _num(value: float) -> str:
    text = f"{value:.2f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


class _Font:
    def __init__(self) -> None:
        data = FONT_FILE.read_bytes()
        if hashlib.sha256(data).hexdigest() != FONT_SHA256:
            raise SystemExit(f"{FONT_FILE} is not the pinned Playfair Display (sha256 differs)")
        self.tt = instancer.instantiateVariableFont(TTFont(io.BytesIO(data)), {"wght": 700})
        self.glyphs = self.tt.getGlyphSet()
        self.cmap = self.tt.getBestCmap()
        self.upm = self.tt["head"].unitsPerEm

    def name(self, char: str) -> str:
        return self.cmap[ord(char)]

    def advance(self, char: str) -> int:
        return self.glyphs[self.name(char)].width

    def kerning(self, left: str, right: str) -> int:
        """The kern feature's pair adjustment, as a browser applies it."""

        gpos = self.tt["GPOS"].table
        a, b = self.name(left), self.name(right)
        total = 0
        for record in gpos.FeatureList.FeatureRecord:
            if record.FeatureTag != "kern":
                continue
            for index in record.Feature.LookupListIndex:
                for sub in gpos.LookupList.Lookup[index].SubTable:
                    value = _pair_value(sub, a, b)
                    if value is not None:
                        total += value
                        break
            break
        return total

    def contours(self, char: str) -> list[list]:
        """Each contour of the glyph as its own pen recording."""

        pen = recording_pen.DecomposingRecordingPen(self.glyphs)
        self.glyphs[self.name(char)].draw(pen)
        out: list[list] = []
        for op, args in pen.value:
            # A contour of off-curve points only starts with qCurveTo(..., None).
            if op == "moveTo" or (op == "qCurveTo" and args[-1] is None):
                out.append([])
            out[-1].append((op, args))
        return out


def _pair_value(sub, a: str, b: str) -> int | None:
    if a not in sub.Coverage.glyphs:
        return None
    if sub.Format == 1:
        pairs = sub.PairSet[sub.Coverage.glyphs.index(a)].PairValueRecord
        for pair in pairs:
            if pair.SecondGlyph == b:
                return getattr(pair.Value1, "XAdvance", 0) or 0
        return None
    class1 = sub.ClassDef1.classDefs.get(a, 0)
    class2 = sub.ClassDef2.classDefs.get(b, 0)
    return getattr(sub.Class1Record[class1].Class2Record[class2].Value1, "XAdvance", 0) or 0


def _replay(recording: list, pen) -> None:
    for op, args in recording:
        getattr(pen, op)(*args)


# ---------------------------------------------------------------- geometry ---


class _Placed:
    """A glyph contour set placed in picture space: (scale, dx, baseline)."""

    def __init__(self, contours: list[list], scale: float, dx: float, baseline: float):
        self.contours = contours
        self.transform = (scale, 0, 0, -scale, dx, baseline)

    def svg_path(self) -> str:
        pen = SVGPathPen(None, ntos=_num)
        tp = TransformPen(pen, self.transform)
        for contour in self.contours:
            _replay(contour, tp)
        return pen.getCommands()

    def polygons(self, factor: float) -> list[list[tuple[float, float]]]:
        flat = _Flattener(factor)
        tp = TransformPen(flat, self.transform)
        for contour in self.contours:
            _replay(contour, tp)
        return flat.polygons


class _Flattener(BasePen):
    """Turns curves into polylines at the raster's resolution."""

    def __init__(self, factor: float, steps: int = 32):
        super().__init__(None)
        self.factor, self.steps = factor, steps
        self.polygons: list[list[tuple[float, float]]] = []
        self.last = (0.0, 0.0)  # in glyph space, before the factor

    def _moveTo(self, pt):
        self.last = pt
        self.polygons.append([(pt[0] * self.factor, pt[1] * self.factor)])

    def _lineTo(self, pt):
        self.last = pt
        self.polygons[-1].append((pt[0] * self.factor, pt[1] * self.factor))

    def _curveToOne(self, pt1, pt2, pt3):
        p0, a, b, c = self.last, pt1, pt2, pt3
        for k in range(1, self.steps + 1):
            t = k / self.steps
            u = 1 - t
            x = u**3 * p0[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t**3 * c[0]
            y = u**3 * p0[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t**3 * c[1]
            self._lineTo((x, y))

    def _qCurveToOne(self, pt1, pt2):
        p0, a, b = self.last, pt1, pt2
        for k in range(1, self.steps + 1):
            t = k / self.steps
            u = 1 - t
            x = u * u * p0[0] + 2 * u * t * a[0] + t * t * b[0]
            y = u * u * p0[1] + 2 * u * t * a[1] + t * t * b[1]
            self._lineTo((x, y))


def _squircle_recording(inset: float = 0.0) -> list:
    k = (62 - inset) / 62

    def p(point):
        return (64 + (point[0] - 64) * k, 64 + (point[1] - 64) * k)

    rec: list[tuple[str, tuple]] = [("moveTo", (p(SQUIRCLE[0][0]),))]
    rec += [("curveTo", (p(c1), p(c2), p(end))) for _, c1, c2, end in SQUIRCLE]
    rec.append(("closePath", ()))
    return rec


def _logo_q(font: _Font, small: bool = False) -> tuple[_Placed, _Placed]:
    """The Q's tail and its body (bowl and counter), placed as in the draft."""

    scale = (SMALL_Q_SIZE if small else Q_SIZE) / font.upm
    dx = Q_CENTRE_X - font.advance("Q") * scale / 2
    # The small form centres the Q's whole height (cap 722 to tail -188) in the plate.
    baseline = BOX / 2 + (722 - 188) / 2 * scale if small else Q_BASELINE
    contours = font.contours("Q")
    tail = [c for c in contours if _lowest(c) < -50]
    body = [c for c in contours if _lowest(c) >= -50]
    if len(tail) != 1 or len(body) != 2:
        raise SystemExit("Playfair's Q is no longer tail + bowl + counter")
    return _Placed(tail, scale, dx, baseline), _Placed(body, scale, dx, baseline)


def _lowest(contour: list) -> float:
    return min(pt[1] for _, args in contour for pt in args if pt is not None)


# --------------------------------------------------------------------- SVG ---


def logo_svg(font: _Font, variant: str, small: bool = False) -> str:
    v = VARIANTS[variant]
    tail, body = _logo_q(font, small)
    # Unique per file: inlined next to each other, two logos must not share a gradient id.
    plate_id = f"quiltor-plate-{variant}{'-small' if small else ''}"
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {BOX} {BOX}" '
        f'width="{BOX}" height="{BOX}" role="img" aria-label="Quiltor">'
    ]
    if v["plate"]:
        top, bottom, rim = v["plate"]
        plate = SVGPathPen(None, ntos=_num)
        _replay(_squircle_recording(), plate)
        parts.append(
            f'<defs><linearGradient id="{plate_id}" x1="0" y1="0" x2="0" y2="1">'
            f'<stop offset="0" stop-color="{top}"/><stop offset="1" stop-color="{bottom}"/>'
            "</linearGradient></defs>"
        )
        parts.append(
            f'<path d="{plate.getCommands()}" fill="url(#{plate_id})"'
            + ("" if small else f' stroke="{rim}" stroke-width="{_num(RIM_WIDTH)}"')
            + "/>"
        )
    heavier = (
        f' stroke="{v["tail"]}" stroke-width="{_num(SMALL_TAIL_STROKE)}" stroke-linejoin="round"'
        if small
        else ""
    )
    parts.append(f'<path d="{tail.svg_path()}" fill="{v["tail"]}"{heavier}/>')
    parts.append(f'<path d="{body.svg_path()}" fill="{v["body"]}"/>')
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


def wordmark_svg(font: _Font, dark: bool) -> str:
    text, scale = "Quiltor", WORD_SIZE / font.upm
    placed, x = [], 0.0
    for i, char in enumerate(text):
        placed.append((char, x))
        x += font.advance(char) * scale + WORD_TRACKING
        if i + 1 < len(text):
            x += font.kerning(char, text[i + 1]) * scale
    width = x - WORD_TRACKING
    ascent, descent = 782.8 * scale, 188 * scale  # tallest letter (l), deepest (the Q's tail)
    w, h = width + 2 * WORD_MARGIN, ascent + descent + 2 * WORD_MARGIN
    baseline = WORD_MARGIN + ascent
    fg, accent = (CREAM, GOLD_LIGHT) if dark else (INK, GOLD)
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {_num(w)} {_num(h)}" '
        f'width="{_num(w)}" height="{_num(h)}" role="img" aria-label="Quiltor">'
    ]
    for char, cx in placed:
        path = _Placed(font.contours(char), scale, WORD_MARGIN + cx, baseline).svg_path()
        parts.append(f'<path d="{path}" fill="{accent if char == "Q" else fg}"/>')
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


# --------------------------------------------------------------------- PNG ---

CANVAS = 4096  # every size is drawn on this canvas and box-filtered down


def _coverage(
    polygons: list[list[tuple[float, float]]], canvas: int = CANVAS, stroke: float = 0
) -> np.ndarray:
    """Non-zero fill: each closed contour adds its winding direction. `stroke` (in canvas
    pixels) adds a round-joined outline around the fill."""

    acc = np.zeros((canvas, canvas), np.int16)
    for poly in polygons:
        if len(poly) < 3:
            continue
        area = sum(
            poly[i][0] * poly[i - 1][1] - poly[i - 1][0] * poly[i][1] for i in range(len(poly))
        )
        mask = Image.new("L", (canvas, canvas), 0)
        ImageDraw.Draw(mask).polygon(poly, fill=1)
        acc += np.asarray(mask, np.int16) * (1 if area > 0 else -1)
    covered = acc != 0
    if stroke:
        outline = Image.new("L", (canvas, canvas), 0)
        draw = ImageDraw.Draw(outline)
        for poly in polygons:
            draw.line([*poly, poly[0]], fill=1, width=round(stroke), joint="curve")
        covered |= np.asarray(outline, bool)
    return covered.astype(np.float32)


def _rgb(hex_colour: str) -> np.ndarray:
    return np.array([int(hex_colour[i : i + 2], 16) for i in (1, 3, 5)], np.float32) / 255


def _over(dst: np.ndarray, colour: np.ndarray, alpha: np.ndarray) -> None:
    """Premultiplied source-over, in place."""

    a = alpha[..., None]
    dst[..., :3] = colour * a + dst[..., :3] * (1 - a)
    dst[..., 3:] = a + dst[..., 3:] * (1 - a)


def logo_master(font: _Font, variant: str, small: bool = False) -> np.ndarray:
    """The logo at CANVAS px (the small form at 1536), premultiplied RGBA floats."""

    canvas = 1536 if small else CANVAS  # 1536 = 96 x 16 = 64 x 24
    v, factor = VARIANTS[variant], canvas / BOX
    img = np.zeros((canvas, canvas, 4), np.float32)
    if v["plate"] and small:
        top, bottom, _ = v["plate"]
        plate = _Placed([_squircle_recording()], 1, 0, 0)
        plate.transform = (1, 0, 0, 1, 0, 0)
        t = (np.arange(canvas, dtype=np.float32) / (canvas - 1))[:, None, None]
        gradient = _rgb(top) * (1 - t) + _rgb(bottom) * t
        a = _coverage(plate.polygons(factor), canvas)[..., None]
        img[..., :3] = gradient * a
        img[..., 3:] = a
    elif v["plate"]:
        top, bottom, rim = v["plate"]
        outer = _Placed([_squircle_recording(-RIM_WIDTH / 2)], 1, 0, 0)
        inner = _Placed([_squircle_recording(RIM_WIDTH / 2)], 1, 0, 0)
        for placed in (outer, inner):  # these are already in picture space
            placed.transform = (1, 0, 0, 1, 0, 0)
        _over(img, _rgb(rim), _coverage(outer.polygons(factor)))
        t = (np.arange(CANVAS, dtype=np.float32) / (CANVAS - 1))[:, None, None]
        gradient = _rgb(top) * (1 - t) + _rgb(bottom) * t
        a = _coverage(inner.polygons(factor))[..., None]
        img[..., :3] = gradient * a + img[..., :3] * (1 - a)
        img[..., 3:] = a + img[..., 3:] * (1 - a)
    tail, body = _logo_q(font, small)
    stroke = SMALL_TAIL_STROKE * factor if small else 0
    _over(img, _rgb(v["tail"]), _coverage(tail.polygons(factor), canvas, stroke))
    _over(img, _rgb(v["body"]), _coverage(body.polygons(factor), canvas))
    return img


def _downsample(master: np.ndarray, size: int) -> Image.Image:
    canvas = master.shape[0]
    k = canvas // size
    if canvas % size:  # 24, 48, 180, 192: box-filter to 1024, then Lanczos
        small = master.reshape(1024, 4, 1024, 4, 4).mean(axis=(1, 3))
        return _to_image(small).resize((size, size), Image.Resampling.LANCZOS)
    return _to_image(master.reshape(size, k, size, k, 4).mean(axis=(1, 3)))


def _to_image(premultiplied: np.ndarray) -> Image.Image:
    alpha = premultiplied[..., 3:]
    rgb = np.where(alpha > 0, premultiplied[..., :3] / np.maximum(alpha, 1e-6), 0)
    out = np.concatenate([rgb, alpha], axis=-1)
    return Image.fromarray(np.round(np.clip(out, 0, 1) * 255).astype(np.uint8))


def _png(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


# ------------------------------------------------------------------- files ---


def brand_files() -> dict[str, bytes]:
    """Every brand file, relative path -> bytes."""

    font = _Font()
    files: dict[str, bytes] = {"OFL.txt": (FONT_DIR / "OFL.txt").read_bytes()}
    for variant in VARIANTS:
        files[f"quiltor-logo-{variant}.svg"] = logo_svg(font, variant).encode()
        files[f"quiltor-logo-{variant}-small.svg"] = logo_svg(font, variant, small=True).encode()
        master = logo_master(font, variant)
        small = logo_master(font, variant, small=True)
        for size in PNG_SIZES:
            picture = _downsample(small if size in SMALL_SIZES else master, size)
            files[f"png/quiltor-logo-{variant}-{size}.png"] = _png(picture)
    files["quiltor-wordmark-light.svg"] = wordmark_svg(font, dark=False).encode()
    files["quiltor-wordmark-dark.svg"] = wordmark_svg(font, dark=True).encode()
    return files


def write(out_dir: Path = OUT_DIR) -> None:
    for name, data in brand_files().items():
        target = out_dir / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    print(f"Wrote {out_dir}")


def check(out_dir: Path = OUT_DIR) -> list[str]:
    problems = []
    for name, data in brand_files().items():
        path = out_dir / name
        if not path.exists():
            problems.append(f"{path} is missing")
        elif path.read_bytes() != data:
            problems.append(f"{path} is out of date")
    return problems


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if args == ["--check"]:
        problems = check()
        for problem in problems:
            print(problem, file=sys.stderr)
        if problems:
            print(
                "Run py -3.12 distribution/tooling/make_brand.py to redraw them.", file=sys.stderr
            )
            return 1
        print("Brand files are current.")
        return 0
    write()
    return 0


if __name__ == "__main__":
    sys.exit(main())
