#!/usr/bin/env python3
"""Generates a placeholder desktop app icon from Quiltor's "Q" mark
(src/config/branding.ts) and its paper/ink design tokens (src/design/colors.css).

Produces:
  packaging/icons/icon.ico           multi-resolution Windows icon (Pillow-native)
  packaging/icons/icon.iconset/*.png macOS iconset source images
  packaging/icons/icon.icns          macOS icon (only when run on macOS, via iconutil)
  packaging/icons/tray.png           small icon for the system tray / menu bar,
                                      loaded at runtime by desktop_tray.py (bundled
                                      as a PyInstaller data file, not build-time-only
                                      like the three above)

Swap these files out once real branding exists -- nothing downstream cares how the
icon was produced, only that icon.ico/icon.icns exist at these paths.

    python packaging/make_icons.py
"""
from __future__ import annotations

import platform
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "icons"
ICONSET_DIR = OUT_DIR / "icon.iconset"

# From src/design/colors.css :root -- the warm paper/ink palette Quiltor's light
# theme uses everywhere else, so the icon doesn't introduce a new color language.
PAPER = "#fffdf8"
INK = "#25261f"
GOLD = "#806018"

# Sizes macOS's iconutil expects inside a .iconset (name -> pixel size).
ICONSET_SIZES = {
    "icon_16x16.png": 16, "icon_16x16@2x.png": 32,
    "icon_32x32.png": 32, "icon_32x32@2x.png": 64,
    "icon_128x128.png": 128, "icon_128x128@2x.png": 256,
    "icon_256x256.png": 256, "icon_256x256@2x.png": 512,
    "icon_512x512.png": 512, "icon_512x512@2x.png": 1024,
}
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

_FONT_CANDIDATES = [
    "georgiab.ttf", "Georgia Bold.ttf",
    "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
    "C:/Windows/Fonts/georgiab.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
]


def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in _FONT_CANDIDATES:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def _render_master(size: int = 1024) -> Image.Image:
    """A rounded paper-colored square with an ink 'Q' and a thin gold ring --
    matches the app's warm, literary color language at a glance."""
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    corner = round(size * 0.22)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=corner, fill=PAPER)

    ring_inset = round(size * 0.045)
    ring_width = max(2, round(size * 0.018))
    draw.rounded_rectangle(
        [ring_inset, ring_inset, size - 1 - ring_inset, size - 1 - ring_inset],
        radius=corner - ring_inset, outline=GOLD, width=ring_width,
    )

    font = _load_font(round(size * 0.62))
    text = "Q"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w, text_h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    position = ((size - text_w) / 2 - bbox[0], (size - text_h) / 2 - bbox[1])
    draw.text(position, text, font=font, fill=INK)

    return image


def _write_ico(master: Image.Image) -> None:
    target = OUT_DIR / "icon.ico"
    master.save(target, format="ICO", sizes=[(s, s) for s in ICO_SIZES])
    print(f"Wrote {target}")


def _write_iconset(master: Image.Image) -> None:
    ICONSET_DIR.mkdir(parents=True, exist_ok=True)
    for name, px in ICONSET_SIZES.items():
        master.resize((px, px), Image.LANCZOS).save(ICONSET_DIR / name)
    print(f"Wrote {ICONSET_DIR} ({len(ICONSET_SIZES)} images)")


def _write_tray_png(master: Image.Image) -> None:
    target = OUT_DIR / "tray.png"
    # 64px source: crisp when a HiDPI tray/menu-bar host downscales it, small
    # enough that bundling it in the frozen app costs nothing worth mentioning.
    master.resize((64, 64), Image.LANCZOS).save(target)
    print(f"Wrote {target}")


def _write_icns_if_macos() -> None:
    if platform.system() != "Darwin":
        print("Skipping .icns (needs macOS's iconutil) -- "
              "run this script again on a Mac, or convert icon.iconset manually.")
        return
    target = OUT_DIR / "icon.icns"
    subprocess.run(["iconutil", "-c", "icns", str(ICONSET_DIR), "-o", str(target)], check=True)
    print(f"Wrote {target}")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    master = _render_master()
    _write_ico(master)
    _write_iconset(master)
    _write_tray_png(master)
    _write_icns_if_macos()


if __name__ == "__main__":
    sys.exit(main())
