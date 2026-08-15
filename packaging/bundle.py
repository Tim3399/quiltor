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
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# The build's per-edition decisions come from the very same policy objects the
# running app consults (backend/edition/), so what gets packaged and what the
# code will then be allowed to do cannot drift apart. Excluding Playwright from
# a build whose renderer still expects it is exactly the failure this prevents.
sys.path.insert(0, str(REPO_ROOT))
from backend.edition import contract as edition_contract  # noqa: E402
from backend.edition import direct as _direct, mas as _mas, msstore as _msstore  # noqa: E402

EDITION_POLICIES: dict[str, edition_contract.EditionPolicy] = {
    policy.name: policy for policy in (_direct, _mas, _msstore)
}

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


# --------------------------------------------------------------- Build variant


def build_edition() -> str:
    """Which distribution this build is for, from QUILTOR_EDITION.

    Same variable the running app honours, which is deliberate: one name to
    remember, and `QUILTOR_EDITION=mas` means the same thing in both places.
    They are still separate mechanisms -- at runtime the shipped app decides
    from the sandbox it finds itself in, not from this.
    """
    name = os.environ.get("QUILTOR_EDITION", "").strip().casefold() or edition_contract.DIRECT
    if name not in EDITION_POLICIES:
        raise SystemExit(
            f"Unknown QUILTOR_EDITION={name!r}. Expected one of: {', '.join(EDITION_POLICIES)}")
    return name


def policy(edition: str | None = None) -> edition_contract.EditionPolicy:
    return EDITION_POLICIES[edition or build_edition()]


def excluded_modules(edition: str | None = None) -> list[str]:
    """Python packages to keep out of this build.

    Playwright goes only where the renderer that uses it cannot run
    (backend/pdf/system_browser.py needs to launch an installed Chrome, which
    the App Sandbox refuses). That is worth doing on its own terms: Playwright's
    driver carries a `node` binary, 128 MB of a 165 MB app, and a
    general-purpose JavaScript interpreter inside a Store bundle is a known
    review flashpoint.
    """
    if not policy(edition).allows_external_process:
        return ["playwright"]
    return []


def data_files(edition: str | None = None) -> list[tuple[str, str]]:
    """(source, destination) pairs for PyInstaller's `datas`."""
    files = [
        (str(REPO_ROOT / "dist"), "dist"),
        (str(REPO_ROOT / "VERSION"), "."),
        (str(REPO_ROOT / "packaging" / "icons" / "tray.png"), "packaging/icons"),
    ]
    # scripts/llm-runtime is the MLX bridge and its pinned requirements. MLX is
    # installed by building a venv and pip-installing into it, so any build that
    # may not download executable code can never use it -- shipping the scripts
    # would be dead weight, and a requirements file promising a pip install is a
    # poor thing to hand a reviewer.
    if policy(edition).allows_code_download:
        files.append((str(REPO_ROOT / "scripts" / "llm-runtime"), "scripts/llm-runtime"))
    return files


def bundled_binaries(edition: str | None = None) -> list[tuple[str, str]]:
    """The inference runtime, for builds that may not fetch one at first launch.

    Returned as `binaries` rather than `datas` so it lands in the directory
    `sys._MEIPASS` points at -- which is what backend/llm/runtimes/'s
    `bundled_runtime_dir()` looks in. Under PyInstaller 6 that is
    Contents/Frameworks; `datas` would put it in Contents/Resources, where the
    consumer would never find it.

    Open question for the Store submission: Apple expects nested executables
    under Contents/MacOS or Contents/Library, and Contents/Frameworks is
    conventionally for frameworks and dylibs. If codesign or App Review objects,
    the fix is to move it and teach bundled_runtime_dir() the new location --
    they have to agree, wherever it ends up.
    """
    if policy(edition).allows_code_download:
        return []  # installs its own on first launch, the normal path

    runtime = REPO_ROOT / "runtime"
    binaries = [item for item in sorted(runtime.glob("*")) if item.is_file()] if runtime.is_dir() else []
    if not binaries:
        raise SystemExit(
            f"A '{build_edition()}' build may not download an inference runtime, so one has to ship "
            f"inside it -- but {runtime} is empty. Build llama-server for the target architecture, "
            f"sign it with the same Team ID, and place it (with its ggml/llama libraries) there. "
            f"See packaging/README.md.")
    return [(str(item), "runtime") for item in binaries]
