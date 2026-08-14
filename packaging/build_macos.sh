#!/usr/bin/env bash
# Builds the macOS Quiltor.app desktop app (onedir/.app bundle), and a .dmg if
# `create-dmg` (https://github.com/create-dmg/create-dmg, `brew install create-dmg`)
# is available.
#
#   ./packaging/build_macos.sh
#
# Requires: a Python 3.11+ venv with `pip install -e ".[desktop]"` and
# `pip install pyinstaller` already done in it (see README section "Desktop app" for
# the one-time setup). Unsigned build for v1 -- macOS Gatekeeper will show an
# "unidentified developer" warning; right-click -> Open bypasses it once. Signing
# with a paid Apple Developer ID + notarization removes that warning entirely and
# is also the only realistic path to distributing Quiltor outside the Mac App Store
# without a sandboxing rework (see packaging/README.md).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f packaging/icons/icon.icns ]; then
    python3 packaging/make_icons.py
fi

npm run build

pyinstaller packaging/quiltor.spec \
    --distpath packaging/dist \
    --workpath packaging/build \
    --noconfirm

# macOS quarantines nothing here (only downloaded files get com.apple.quarantine),
# but a fresh unsigned .app still needs Gatekeeper's one-time right-click -> Open.
echo
echo "Built packaging/dist/Quiltor.app"

if command -v create-dmg >/dev/null 2>&1; then
    # create-dmg refuses to overwrite an existing output file.
    rm -f packaging/dist/Quiltor.dmg
    create-dmg \
        --volname "Quiltor" \
        --volicon "packaging/icons/icon.icns" \
        --window-size 660 400 \
        --icon-size 100 \
        --icon "Quiltor.app" 180 170 \
        --app-drop-link 480 170 \
        "packaging/dist/Quiltor.dmg" \
        "packaging/dist/Quiltor.app"
    echo "Built packaging/dist/Quiltor.dmg"
else
    echo "create-dmg not found -- skipping .dmg (brew install create-dmg to enable it)."
fi
