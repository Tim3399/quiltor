#!/usr/bin/env python3
"""Generates a placeholder desktop app icon from Quiltor's "Q" mark
(packages/client/src/config/branding.ts) and its paper/ink design tokens
(packages/client/src/design/colors.css).

Produces:
  distribution/assets/icons/icon.ico           multi-resolution Windows icon
  distribution/assets/icons/icon.iconset/*.png macOS iconset source images
  distribution/assets/icons/icon.icns          macOS icon (generated on macOS)
  distribution/assets/icons/tray.png           runtime tray/menu-bar icon
  apps/web/public/favicon.ico                  web app favicon (16, 32, 48)
  apps/web/public/favicon-32.png               web app favicon as PNG
  apps/web/public/apple-touch-icon.png         home-screen icon, opaque, 180 px
  apps/web/public/email-logo.png               logo the Keycloak mails load, opaque, 192 px

The web icons are derived from the iconset images, not drawn again, so a logo change
carries over to them and they stay the desktop icon at another size.

Swap these files out once real branding exists -- nothing downstream cares how the
icon was produced, only that icon.ico/icon.icns exist at these paths.

    python distribution/tooling/make_icons.py
    python distribution/tooling/make_icons.py --check   # web icons still match the iconset
"""

from __future__ import annotations

import io
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = REPO_ROOT / "distribution" / "assets" / "icons"
ICONSET_DIR = OUT_DIR / "icon.iconset"
WEB_DIR = REPO_ROOT / "apps" / "web" / "public"
# The opaque icons sit on white: dark mail clients and home screens cannot tint it.
WEB_BACKGROUND = (255, 255, 255)

# From packages/client/src/design/colors.css :root -- the warm paper/ink palette Quiltor's light
# theme uses everywhere else, so the icon doesn't introduce a new color language.
PAPER = "#fffdf8"
INK = "#25261f"
GOLD = "#806018"

# Sizes macOS's iconutil expects inside a .iconset (name -> pixel size).
ICONSET_SIZES = {
    "icon_16x16.png": 16,
    "icon_16x16@2x.png": 32,
    "icon_32x32.png": 32,
    "icon_32x32@2x.png": 64,
    "icon_128x128.png": 128,
    "icon_128x128@2x.png": 256,
    "icon_256x256.png": 256,
    "icon_256x256@2x.png": 512,
    "icon_512x512.png": 512,
    "icon_512x512@2x.png": 1024,
}
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

_FONT_CANDIDATES = [
    "georgiab.ttf",
    "Georgia Bold.ttf",
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
        radius=corner - ring_inset,
        outline=GOLD,
        width=ring_width,
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
        master.resize((px, px), Image.Resampling.LANCZOS).save(ICONSET_DIR / name)
    print(f"Wrote {ICONSET_DIR} ({len(ICONSET_SIZES)} images)")


def _write_tray_png(master: Image.Image) -> None:
    target = OUT_DIR / "tray.png"
    # 64px source: crisp when a HiDPI tray/menu-bar host downscales it, small
    # enough that bundling it in the frozen app costs nothing worth mentioning.
    master.resize((64, 64), Image.Resampling.LANCZOS).save(target)
    print(f"Wrote {target}")


def _write_icns_if_available() -> None:
    iconutil = shutil.which("iconutil")
    if iconutil is None:
        print(
            "Skipping .icns (needs macOS's iconutil) -- "
            "run this script again on a Mac, or convert icon.iconset manually."
        )
        return
    target = OUT_DIR / "icon.icns"
    subprocess.run([iconutil, "-c", "icns", str(ICONSET_DIR), "-o", str(target)], check=True)
    print(f"Wrote {target}")


def _opaque(image: Image.Image) -> Image.Image:
    flat = Image.new("RGB", image.size, WEB_BACKGROUND)
    flat.paste(image, mask=image.getchannel("A"))
    return flat


def _png(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def web_icons(iconset_dir: Path = ICONSET_DIR) -> dict[str, bytes]:
    """The web icons, derived from the iconset images (name -> file bytes)."""

    large = Image.open(iconset_dir / "icon_512x512.png").convert("RGBA")
    medium = Image.open(iconset_dir / "icon_256x256.png").convert("RGBA")
    ico = io.BytesIO()
    large.save(ico, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    lanczos = Image.Resampling.LANCZOS
    return {
        "favicon.ico": ico.getvalue(),
        "favicon-32.png": _png(large.resize((32, 32), lanczos)),
        "apple-touch-icon.png": _png(_opaque(large).resize((180, 180), lanczos)),
        "email-logo.png": _png(_opaque(medium.resize((192, 192), lanczos))),
    }


def _frames(data: bytes) -> list[tuple[str, tuple[int, int], bytes]]:
    """Every picture a file holds, as (mode, size, pixels); an ICO holds one per size."""

    image = Image.open(io.BytesIO(data))
    if image.format != "ICO":
        return [(image.mode, image.size, image.tobytes())]
    frames = []
    for size in sorted(image.info["sizes"]):
        # IcoImageFile keeps every size in `ico`; the base class it is typed as does not.
        frame = getattr(image, "ico").getimage(size)  # noqa: B009
        frames.append((frame.mode, frame.size, frame.tobytes()))
    return frames


def check_web_icons(iconset_dir: Path = ICONSET_DIR, web_dir: Path = WEB_DIR) -> list[str]:
    """
    Which web icons no longer show the iconset, as messages; empty when all do.

    Pixels are compared, not bytes: the PNG encoder's output can differ between Pillow
    builds while the picture is the same.
    """

    problems = []
    for name, expected in web_icons(iconset_dir).items():
        path = web_dir / name
        if not path.exists():
            problems.append(f"{path} is missing")
        elif _frames(path.read_bytes()) != _frames(expected):
            problems.append(f"{path} does not match the app icon")
    return problems


def _write_web_icons() -> None:
    for name, data in web_icons().items():
        (WEB_DIR / name).write_bytes(data)
    print(f"Wrote {WEB_DIR} (favicon.ico, favicon-32.png, apple-touch-icon.png, email-logo.png)")


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if args == ["--check"]:
        problems = check_web_icons()
        for problem in problems:
            print(problem, file=sys.stderr)
        if problems:
            print("Run python distribution/tooling/make_icons.py to redraw them.", file=sys.stderr)
            return 1
        print("Web icons match the app icon.")
        return 0
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    master = _render_master()
    _write_ico(master)
    _write_iconset(master)
    _write_tray_png(master)
    _write_icns_if_available()
    _write_web_icons()
    return 0


if __name__ == "__main__":
    sys.exit(main())
