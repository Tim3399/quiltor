"""Everything about the macOS app bundle that is a decision rather than a
PyInstaller invocation.

Lives outside the .spec files, and imports nothing from PyInstaller, for one
reason: a .spec is only ever executed by a real build, so anything written
inside one is untested until somebody runs that build on the right machine.
The Info.plist is exactly the kind of thing that must not be discovered wrong
at upload time -- App Store Connect rejects a missing CFBundleVersion before a
human ever sees the app. So the decisions live here and
tests/backend/test_packaging.py checks them anywhere.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

BUNDLE_IDENTIFIER = "app.quiltor.desktop"
APP_NAME = "Quiltor"

#: Apple's category for the App Store listing and Finder. Quiltor is a writing
#: workspace, so productivity rather than the more specific
#: public.app-category.reference or ...education.
APPLICATION_CATEGORY = "public.app-category.productivity"

#: WKWebView's print operation is the Store build's only PDF route, and WebKit
#: shipped CSS @page margin boxes -- the book's page numbers -- in Safari 18.2,
#: which is macOS 15.2. Below that the export loses its page numbering, so this
#: is a product floor, not just a build setting. Raise it to "15.2" if the
#: decision goes that way; see backend/pdf/wkwebview.py.
MINIMUM_SYSTEM_VERSION = "11.0"

#: The app speaks German and English in full (src/language/de, src/language/en),
#: German by default. Declaring both is what lets macOS pick by system locale
#: and lets App Store Connect offer both listing languages.
LOCALIZATIONS = ("de", "en")
DEVELOPMENT_REGION = "de"

COPYRIGHT = "Copyright (c) 2026 Tim Ratermann. See LICENSE."


def version() -> str:
    """The marketing version, from the single source of truth every other part
    of the build already reads."""
    return (REPO_ROOT / "VERSION").read_text(encoding="utf-8").strip()


def build_number() -> str:
    """CFBundleVersion: must increase with every upload, and is independent of
    the marketing version -- a rejected build burns a number even though
    VERSION has not moved.

    CI passes its run number via QUILTOR_BUILD_NUMBER. A local build has no
    such counter and does not need one (nothing local is uploaded), so it falls
    back to "0", which is valid and obviously not a real submission.
    """
    supplied = os.environ.get("QUILTOR_BUILD_NUMBER", "").strip()
    if not supplied:
        return "0"
    if not re.fullmatch(r"[0-9]+(\.[0-9]+){0,2}", supplied):
        raise SystemExit(
            f"QUILTOR_BUILD_NUMBER={supplied!r} is not a valid CFBundleVersion. "
            f"Apple wants one to three dot-separated integers, e.g. 1, 1.2 or 1.2.3.")
    return supplied


def info_plist() -> dict[str, object]:
    """The Info.plist keys PyInstaller does not write for us.

    PyInstaller emits a nine-key minimum (identifier, name, executable, icon,
    NSHighResolutionCapable and friends) and CFBundleShortVersionString as
    "0.0.0" unless told otherwise. Everything below is either required for a
    Store upload or wrong if left to the default.
    """
    return {
        "CFBundleShortVersionString": version(),
        "CFBundleVersion": build_number(),
        "LSApplicationCategoryType": APPLICATION_CATEGORY,
        "LSMinimumSystemVersion": MINIMUM_SYSTEM_VERSION,
        "NSHumanReadableCopyright": COPYRIGHT,
        "CFBundleDevelopmentRegion": DEVELOPMENT_REGION,
        "CFBundleLocalizations": list(LOCALIZATIONS),
        # Declared false so every upload does not stall on the export-compliance
        # questionnaire. Accurate: Quiltor's only cryptography is HTTPS via the
        # standard library and the OS, which is exempt. Revisit if snapshot
        # encryption lands (backend/backup/snapshots.py writes
        # "encryption": "none" today).
        "ITSAppUsesNonExemptEncryption": False,
        # The server binds loopback only and the assistant runtime binds a second
        # loopback port; nothing here talks to the network in the clear. Without
        # this, macOS's ATS defaults would still permit it, but being explicit
        # keeps a reviewer from having to ask.
        "NSAppTransportSecurity": {"NSAllowsLocalNetworking": True},
    }
