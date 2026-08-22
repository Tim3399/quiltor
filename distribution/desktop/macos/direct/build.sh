#!/usr/bin/env bash
# Builds the macOS Quiltor desktop app: the Quiltor.app bundle, then a .dmg around
# it -- the macOS counterpart to build_windows.ps1's Quiltor-Setup-<version>.exe.
#
#   ./distribution/desktop/macos/direct/build.sh
#
# Requires: a CPython 3.11.9 venv populated from the hash-locked bootstrap and
# macOS arm64 requirements files (see distribution/README.md). The spec analyzes
# the checked-out src/ tree directly; an editable project install is unnecessary.
#
# Code signing and notarization are opt-in via two environment variables, so this
# script keeps working unchanged on a machine without an Apple Developer account:
#
#   QUILTOR_SIGN_IDENTITY   Signing identity, e.g.
#                           "Developer ID Application: Jane Doe (AB12CD34EF)".
#                           `security find-identity -v -p codesigning` lists them.
#   QUILTOR_NOTARY_PROFILE  Name of a notarytool keychain profile, created once with
#                           `xcrun notarytool store-credentials <name> --apple-id ...
#                            --team-id ... --password <app-specific-password>`.
#                           Requires QUILTOR_SIGN_IDENTITY (Apple only notarizes
#                           Developer-ID-signed code).
#   QUILTOR_NOTARY_KEYCHAIN Path of the keychain holding that profile. Only needed
#                           when it is not the login keychain, which is the case in
#                           CI imports the certificate
#                           into a throwaway keychain under RUNNER_TEMP and stores the
#                           profile there, and notarytool looks in the login keychain
#                           unless told otherwise (the search list does not apply).
#
# Without them the build is unsigned and macOS Gatekeeper shows "Apple could not
# verify..." -- usable for local testing, not for handing to other people. With
# both set, the resulting .dmg installs with no warning at all.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"

VERSION="$(tr -d '[:space:]' < VERSION)"
PROFILE="macos-direct"
ARTIFACT_DIR="distribution/artifacts/$PROFILE"
BUILD_DIR="distribution/.build/$PROFILE"
APP="$ARTIFACT_DIR/Quiltor.app"
DMG="$ARTIFACT_DIR/Quiltor-$VERSION.dmg"
ENTITLEMENTS="distribution/desktop/macos/direct/entitlements.plist"

SIGN_IDENTITY="${QUILTOR_SIGN_IDENTITY:-}"
NOTARY_PROFILE="${QUILTOR_NOTARY_PROFILE:-}"
NOTARY_KEYCHAIN="${QUILTOR_NOTARY_KEYCHAIN:-}"
REQUIRE_SIGNING="${QUILTOR_REQUIRE_SIGNING:-0}"

if [ "$(uname -m)" != "arm64" ]; then
    echo "The macos-direct profile currently supports arm64 only; this host is $(uname -m)." >&2
    exit 1
fi

if [ -n "$NOTARY_PROFILE" ] && [ -z "$SIGN_IDENTITY" ]; then
    echo "QUILTOR_NOTARY_PROFILE is set but QUILTOR_SIGN_IDENTITY is not." >&2
    echo "Apple only notarizes code signed with a Developer ID -- set both or neither." >&2
    exit 1
fi

if [ "$REQUIRE_SIGNING" = "1" ] && { [ -z "$SIGN_IDENTITY" ] || [ -z "$NOTARY_PROFILE" ]; }; then
    echo "Release builds require both QUILTOR_SIGN_IDENTITY and QUILTOR_NOTARY_PROFILE." >&2
    echo "Unsigned output is supported only for local development builds." >&2
    exit 1
fi

# Signs every Mach-O binary inside the bundle, then the bundle itself. `codesign
# --deep` would be one line instead of this loop, but Apple explicitly documents it
# as unreliable for exactly this shape of bundle (a frozen interpreter with dozens
# of nested .so/.dylib files), so we sign inside-out by hand.
sign_app() {
    echo "Signing $APP as '$SIGN_IDENTITY'..."
    while IFS= read -r -d '' binary; do
        codesign --force --timestamp --options runtime --sign "$SIGN_IDENTITY" "$binary"
    done < <(find "$APP/Contents" -type f \
        -exec sh -c 'file -b "$1" | grep -q "Mach-O"' _ {} \; -print0)

    # Nested bundles have to be signed as bundles, after their own binaries above.
    if [ -d "$APP/Contents/Frameworks" ]; then
        find "$APP/Contents/Frameworks" -maxdepth 1 -name "*.framework" \
            -exec codesign --force --timestamp --options runtime \
            --sign "$SIGN_IDENTITY" {} +
    fi

    # The entitlements only go on the outer bundle -- that is the signature the
    # Hardened Runtime reads for the whole process.
    codesign --force --timestamp --options runtime \
        --entitlements "$ENTITLEMENTS" --sign "$SIGN_IDENTITY" "$APP"
    codesign --verify --strict --verbose=2 "$APP"
}

# Uploads to Apple, waits for the verdict, then staples the ticket into the file so
# Gatekeeper accepts it without a network round trip on the user's machine. Each
# submission typically takes a few minutes.
notarize() {
    local target="$1"
    local upload="$1"

    # notarytool accepts .dmg/.pkg/.zip only, so a bare .app gets zipped first.
    if [[ "$target" == *.app ]]; then
        upload="${target%.app}-notarize.zip"
        ditto -c -k --keepParent "$target" "$upload"
    fi

    echo "Notarizing $target (this takes a few minutes)..."
    # Spelled out twice rather than assembled, because an empty "${array[@]}"
    # under `set -u` is an error in the bash 3.2 that ships with macOS.
    if [ -n "$NOTARY_KEYCHAIN" ]; then
        xcrun notarytool submit "$upload" --keychain-profile "$NOTARY_PROFILE" \
            --keychain "$NOTARY_KEYCHAIN" --wait
    else
        xcrun notarytool submit "$upload" --keychain-profile "$NOTARY_PROFILE" --wait
    fi
    [ "$upload" = "$target" ] || rm -f "$upload"
    xcrun stapler staple "$target"
    xcrun stapler validate "$target"
}

# Prefers create-dmg (https://github.com/create-dmg/create-dmg, `brew install
# create-dmg`) for a laid-out window with an Applications drop target, and falls
# back to plain hdiutil so a .dmg is always produced -- the installer is the point,
# the icon placement is cosmetic.
build_dmg() {
    rm -f "$DMG"  # create-dmg and hdiutil both refuse to overwrite.

    if command -v create-dmg >/dev/null 2>&1; then
        create-dmg \
            --volname "Quiltor" \
            --volicon "distribution/assets/icons/icon.icns" \
            --window-size 660 400 \
            --icon-size 100 \
            --icon "Quiltor.app" 180 170 \
            --app-drop-link 480 170 \
            "$DMG" "$APP"
        return
    fi

    echo "create-dmg not found -- building a plain .dmg with hdiutil instead."
    local staging
    staging="$(mktemp -d)"
    # ditto, not cp -R: it preserves the extended attributes a signed bundle
    # carries, which cp can drop and thereby invalidate the signature.
    ditto "$APP" "$staging/Quiltor.app"
    ln -s /Applications "$staging/Applications"
    hdiutil create -volname "Quiltor" -srcfolder "$staging" \
        -ov -format UDZO "$DMG" >/dev/null
    rm -rf "$staging"
}

if [ ! -f distribution/assets/icons/icon.icns ]; then
    python3 distribution/tooling/make_icons.py
fi

python3 distribution/tooling/profile_contract.py validate "$PROFILE"
npm run build
mkdir -p "$ARTIFACT_DIR" "$BUILD_DIR"

# Pinned, not inherited: a stale shell cannot turn this into a Store artifact.
QUILTOR_BUILD_PROFILE_ID="$PROFILE" pyinstaller distribution/desktop/pyinstaller/quiltor.spec \
    --distpath "$ARTIFACT_DIR" \
    --workpath "$BUILD_DIR/pyinstaller" \
    --noconfirm

echo
echo "Built $APP"

if [ -n "$SIGN_IDENTITY" ]; then
    sign_app
    # The .app is notarized and stapled before the .dmg is built, so the copy the
    # user drags to /Applications carries its own ticket and passes Gatekeeper even
    # offline. The .dmg is then notarized separately for the download itself.
    if [ -n "$NOTARY_PROFILE" ]; then
        notarize "$APP"
    fi
fi

build_dmg
echo "Built $DMG"

if [ -n "$SIGN_IDENTITY" ]; then
    codesign --force --timestamp --sign "$SIGN_IDENTITY" "$DMG"
    codesign --verify --strict --verbose=2 "$DMG"
    if [ -n "$NOTARY_PROFILE" ]; then
        notarize "$DMG"
        echo
        echo "Gatekeeper assessment:"
        spctl --assess --type execute --verbose=4 "$APP"
    fi
fi

if [ -z "$SIGN_IDENTITY" ]; then
    echo
    echo "Unsigned build -- Gatekeeper will show \"unidentified developer\"."
    echo "Users bypass it once via right-click -> Open; set QUILTOR_SIGN_IDENTITY"
    echo "and QUILTOR_NOTARY_PROFILE (see the header of this script) to remove it."
fi
