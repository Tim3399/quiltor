# PyInstaller spec for the Quiltor desktop app (see packaging/build_windows.ps1 /
# build_macos.sh for how this gets invoked). Builds a "onedir" bundle -- faster
# startup and far fewer antivirus false positives than "onefile", at the cost of a
# folder instead of a single binary; wrap the folder in an installer/.dmg separately
# if a single download artifact is wanted later.
#
# Run via the build scripts, not directly, so REPO_ROOT resolves correctly:
#   pyinstaller packaging/quiltor.spec --distpath packaging/dist --workpath packaging/build

from pathlib import Path

REPO_ROOT = Path(SPECPATH).resolve().parent
ICON_DIR = REPO_ROOT / "packaging" / "icons"

block_cipher = None

a = Analysis(
    [str(REPO_ROOT / "desktop.py")],
    pathex=[str(REPO_ROOT)],
    binaries=[],
    datas=[
        (str(REPO_ROOT / "dist"), "dist"),
        (str(REPO_ROOT / "VERSION"), "."),
        (str(REPO_ROOT / "scripts" / "llm-runtime"), "scripts/llm-runtime"),
        (str(ICON_DIR / "tray.png"), "packaging/icons"),
    ],
    # server.py/backend are regular local imports PyInstaller's analysis already
    # follows from `import server` in desktop.py; these are libraries whose
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
    excludes=[],
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
    bundle_identifier="app.quiltor.desktop",
)
