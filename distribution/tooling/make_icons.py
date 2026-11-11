#!/usr/bin/env python3
"""Places Quiltor's logo (logo 3, "Goldener Schwanz") everywhere an icon is expected.

The pictures themselves are drawn by make_brand.py into distribution/assets/brand/png/;
this script only picks the right size for each place, so it needs Pillow and nothing else.
The 16 and 24 px pictures are the logo's small form.

Produces:
  distribution/assets/icons/icon.ico           multi-resolution Windows icon
  distribution/assets/icons/icon.iconset/*.png macOS iconset source images
  distribution/assets/icons/icon.icns          macOS icon (iconutil on macOS, Pillow elsewhere)
  distribution/assets/icons/tray.png           runtime tray/menu-bar icon
  apps/web/public/favicon.ico                  web app favicon (16, 32, 48)
  apps/web/public/favicon-32.png               web app favicon as PNG
  apps/web/public/apple-touch-icon.png         home-screen icon, opaque, 180 px
  apps/web/public/email-logo.png               logo the Keycloak mails load: the brand's
                                               quiltor-logo-light-192.png, byte for byte

    python distribution/tooling/make_icons.py
    python distribution/tooling/make_icons.py --check   # every icon still shows the logo
"""

from __future__ import annotations

import io
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = REPO_ROOT / "distribution" / "assets" / "icons"
ICONSET_DIR = OUT_DIR / "icon.iconset"
WEB_DIR = REPO_ROOT / "apps" / "web" / "public"
BRAND_PNG_DIR = REPO_ROOT / "distribution" / "assets" / "brand" / "png"
# The opaque icons sit on white: dark mail clients and home screens cannot tint it.
WEB_BACKGROUND = (255, 255, 255)

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


def brand_png(size: int, variant: str = "light") -> Path:
    return BRAND_PNG_DIR / f"quiltor-logo-{variant}-{size}.png"


def _brand(size: int) -> Image.Image:
    return Image.open(brand_png(size)).convert("RGBA")


def _ico(sizes: list[int]) -> bytes:
    """An ICO with the brand's own picture at every size, none of them rescaled."""

    pictures = [_brand(size) for size in sizes]
    buffer = io.BytesIO()
    pictures[-1].save(
        buffer, format="ICO", sizes=[(s, s) for s in sizes], append_images=pictures[:-1]
    )
    return buffer.getvalue()


def _write_ico() -> None:
    target = OUT_DIR / "icon.ico"
    target.write_bytes(_ico(ICO_SIZES))
    print(f"Wrote {target}")


def _write_iconset() -> None:
    ICONSET_DIR.mkdir(parents=True, exist_ok=True)
    for name, px in ICONSET_SIZES.items():
        (ICONSET_DIR / name).write_bytes(brand_png(px).read_bytes())
    print(f"Wrote {ICONSET_DIR} ({len(ICONSET_SIZES)} images)")


def _write_tray_png() -> None:
    target = OUT_DIR / "tray.png"
    # 64px source: crisp when a HiDPI tray/menu-bar host downscales it, small
    # enough that bundling it in the frozen app costs nothing worth mentioning.
    target.write_bytes(brand_png(64).read_bytes())
    print(f"Wrote {target}")


def _write_icns_if_available() -> None:
    iconutil = shutil.which("iconutil")
    target = OUT_DIR / "icon.icns"
    if iconutil is None:
        # Pillow writes ICNS too; it takes each size from the images handed to it.
        sizes = [16, 32, 64, 128, 256, 512, 1024]
        pictures = [_brand(size) for size in sizes]
        pictures[-1].save(target, format="ICNS", append_images=pictures[:-1])
        print(f"Wrote {target} (Pillow)")
        return
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


def web_icons() -> dict[str, bytes]:
    """The web icons, taken from the brand's pictures (name -> file bytes)."""

    return {
        "favicon.ico": _ico([16, 32, 48]),
        "favicon-32.png": brand_png(32).read_bytes(),
        "apple-touch-icon.png": _png(_opaque(_brand(180))),
        "email-logo.png": brand_png(192).read_bytes(),
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


def check_web_icons(web_dir: Path = WEB_DIR) -> list[str]:
    """
    Which web icons no longer show the iconset, as messages; empty when all do.

    Pixels are compared, not bytes: the PNG encoder's output can differ between Pillow
    builds while the picture is the same.
    """

    problems = []
    for name, expected in web_icons().items():
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
    _write_ico()
    _write_iconset()
    _write_tray_png()
    _write_icns_if_available()
    _write_web_icons()
    return 0


if __name__ == "__main__":
    sys.exit(main())
