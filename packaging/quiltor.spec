# PyInstaller spec for the Quiltor desktop app (see packaging/build_windows.ps1 /
# build_macos.sh for how this gets invoked). Builds a "onedir" bundle -- faster
# startup and far fewer antivirus false positives than "onefile", at the cost of a
# folder instead of a single binary; wrap the folder in an installer/.dmg separately
# if a single download artifact is wanted later.
#
# Run via the build scripts, not directly, so REPO_ROOT resolves correctly:
#   pyinstaller packaging/quiltor.spec --distpath packaging/dist --workpath packaging/build
#
# One spec for all three distributions, with the differences as data in
# packaging/bundle.py rather than as three near-identical spec files. Set the
# variant with QUILTOR_EDITION -- the same name the running app honours:
#
#   QUILTOR_EDITION=mas pyinstaller packaging/quiltor.spec ...
#
# Duplicating this file per edition would mean maintaining the hiddenimports
# list below in three places, which is precisely the kind of drift the rest of
# this refactor set out to remove.

import os
import sys
from pathlib import Path

REPO_ROOT = Path(SPECPATH).resolve().parent
ICON_DIR = REPO_ROOT / "packaging" / "icons"

# The bundle's identity and Info.plist live in a plain module rather than in
# this file, because a .spec only runs during a real build and is therefore
# untested until someone runs one on the right machine. Getting CFBundleVersion
# wrong is not something to find out at upload time.
sys.path.insert(0, str(REPO_ROOT / "packaging"))
import bundle  # noqa: E402

block_cipher = None

EDITION = bundle.build_edition()
print(f"Building the '{EDITION}' distribution.")

a = Analysis(
    [str(REPO_ROOT / "hosts" / "desktop" / "app.py")],
    pathex=[str(REPO_ROOT)],
    # An inference runtime only where the edition forbids downloading one; the
    # MLX scripts only where it does not.
    binaries=bundle.bundled_binaries(EDITION),
    datas=bundle.data_files(EDITION),
    # server.py/backend are regular local imports PyInstaller's analysis already
    # follows from `import server` in hosts/desktop/app.py; these are libraries whose
    # platform backends are selected dynamically (import machinery PyInstaller's
    # static analysis can't see), so they need to be listed explicitly.
    hiddenimports=[
        "webview.platforms.winforms",
        "webview.platforms.edgechromium",
        "webview.platforms.cocoa",
        "clr",
        "pystray._win32",
        "pystray._darwin",
        "pystray._xorg",
        "pystray._appindicator",
        "PIL._tkinter_finder",
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=bundle.excluded_modules(EDITION),
    cipher=block_cipher,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Quiltor",
    debug=False,
    strip=False,
    upx=False,
    console=False,  # windowed app: no console, see desktop.py's _redirect_null_streams()
    icon=str(ICON_DIR / "icon.ico"),
    # Explicit rather than "whatever the build machine is". arm64 only for now:
    # universal2 would additionally require universal2 wheels for Pillow,
    # pywebview and pystray. Overridable so a build host can say otherwise.
    target_arch=os.environ.get("QUILTOR_TARGET_ARCH") or None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name="Quiltor",
)

app = BUNDLE(
    coll,
    name="Quiltor.app",
    icon=str(ICON_DIR / "icon.icns") if (ICON_DIR / "icon.icns").exists() else None,
    bundle_identifier=bundle.BUNDLE_IDENTIFIER,
    version=bundle.version(),
    info_plist=bundle.info_plist(),
)
