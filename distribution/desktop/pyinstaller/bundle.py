"""Everything about the macOS app bundle that is a decision rather than a
PyInstaller invocation.

Lives outside the .spec files, and imports nothing from PyInstaller, for one
reason: a .spec is only ever executed by a real build, so anything written
inside one is untested until somebody runs that build on the right machine.
The Info.plist is exactly the kind of thing that must not be discovered wrong
at upload time -- App Store Connect rejects a missing CFBundleVersion before a
human ever sees the app. So the decisions live here and
tests/python/test_distribution.py checks them anywhere.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
TOOLING_ROOT = REPO_ROOT / "distribution" / "tooling"
SOURCE_ROOT = REPO_ROOT / "src"
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(SOURCE_ROOT))
sys.path.insert(0, str(TOOLING_ROOT))

from profile_contract import (  # noqa: E402
    ProfileError,
    load_profile,
    materialize_profile,
    validate_profile,
)

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
#: decision goes that way; see quiltor.infrastructure.pdf.wkwebview.
MINIMUM_SYSTEM_VERSION = "11.0"

#: The app speaks German and English in full (locales/de and locales/en),
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
            f"Apple wants one to three dot-separated integers, e.g. 1, 1.2 or 1.2.3."
        )
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
        # questionnaire. Quiltor uses standard HTTPS and OIDC signature
        # verification primitives, not custom or content-encryption crypto.
        # Revisit if snapshot encryption lands (the backup snapshot manifest
        # writes "encryption": "none" today).
        "ITSAppUsesNonExemptEncryption": False,
        # The server binds loopback only and the assistant runtime binds a second
        # loopback port; nothing here talks to the network in the clear. Without
        # this, macOS's ATS defaults would still permit it, but being explicit
        # keeps a reviewer from having to ask.
        "NSAppTransportSecurity": {"NSAllowsLocalNetworking": True},
    }


# --------------------------------------------------------------- Build profile


def build_profile_id() -> str:
    """The explicit target selected by the platform build entrypoint.

    No default is intentional. A PyInstaller invocation detached from a target
    script must fail instead of silently producing an artifact with the wrong
    sandbox or update channel.
    """

    profile_id = os.environ.get("QUILTOR_BUILD_PROFILE_ID", "").strip().casefold()
    if not profile_id:
        raise SystemExit(
            "QUILTOR_BUILD_PROFILE_ID is required. Run a target build script under "
            "distribution/desktop instead of invoking PyInstaller directly."
        )
    try:
        selected = load_profile(profile_id)
        validate_profile(selected, REPO_ROOT / "distribution" / "profiles" / f"{profile_id}.json")
    except ProfileError as error:
        raise SystemExit(str(error)) from error
    if selected["build"]["status"] != "supported":
        raise SystemExit(f"Distribution profile {profile_id!r} is a scaffold, not a build target.")
    return profile_id


def profile(profile_id: str | None = None) -> dict[str, object]:
    selected_id = profile_id or build_profile_id()
    try:
        selected = load_profile(selected_id)
        validate_profile(selected, REPO_ROOT / "distribution" / "profiles" / f"{selected_id}.json")
    except ProfileError as error:
        raise SystemExit(str(error)) from error
    return selected


def excluded_modules(profile_id: str | None = None) -> list[str]:
    """Python packages to keep out of this build.

    Playwright ships only where the renderer that needs it is the one being
    used. quiltor.infrastructure.pdf decides that, and is asked rather than
    second-guessed, so
    a build can never drop the library its own renderer imports.

    On macOS the answer is always "leave it out": WKWebView prints there, and
    Playwright's driver carries a `node` binary worth ~128 MB -- most of the
    bundle, for a code path that never runs.
    """
    from quiltor.infrastructure import pdf
    from quiltor.infrastructure.platform import system

    selected = profile(profile_id)
    sandboxed = selected["security"]["sandbox"] not in {"none", "python-environment"}
    renderer = pdf.desktop_renderer_name(os_name=system.os_name(), sandboxed=sandboxed)
    if renderer != pdf.SYSTEM_BROWSER:
        return ["playwright"]
    return []


def data_files(profile_id: str | None = None) -> list[tuple[str, str]]:
    """(source, destination) pairs for PyInstaller's `datas`."""
    selected = profile(profile_id)
    embedded = materialize_profile(selected["id"])
    files = [
        (str(REPO_ROOT / "dist"), "quiltor/resources/web"),
        (str(REPO_ROOT / "VERSION"), "quiltor"),
        (str(REPO_ROOT / "LICENSE"), "quiltor/resources/legal"),
        (str(REPO_ROOT / "THIRD-PARTY-NOTICES.md"), "quiltor/resources/legal"),
        (
            str(REPO_ROOT / "distribution" / "assets" / "icons" / "tray.png"),
            "quiltor/resources/icons",
        ),
        (str(embedded), "quiltor/infrastructure/platform"),
    ]
    # The MLX sidecar and its pinned requirements ship only where the target
    # may assemble that optional runtime. MLX is
    # installed by building a venv and pip-installing into it, so any build that
    # may not download executable code can never use it -- shipping the sidecars
    # would be dead weight, and a requirements file promising a pip install is a
    # poor thing to hand a reviewer.
    if selected["capabilities"]["codeDownload"] and selected["target"]["platform"] == "macos":
        for filename in ("bridge.py", "requirements.lock"):
            files.append(
                (
                    str(
                        REPO_ROOT
                        / "src"
                        / "quiltor"
                        / "resources"
                        / "sidecars"
                        / "inference"
                        / "mlx"
                        / filename
                    ),
                    "quiltor/resources/sidecars/inference/mlx",
                )
            )
    return files


def bundled_binaries(profile_id: str | None = None) -> list[tuple[str, str]]:
    """The inference runtime, for builds that may not fetch one at first launch.

    Returned as `binaries` rather than `datas` so it lands in the directory
    `sys._MEIPASS` points at -- which is what quiltor.infrastructure.inference.runtimes'
    `bundled_runtime_dir()` looks in. Under PyInstaller 6 that is
    Contents/Frameworks; `datas` would put it in Contents/Resources, where the
    consumer would never find it.

    Open question for the Store submission: Apple expects nested executables
    under Contents/MacOS or Contents/Library, and Contents/Frameworks is
    conventionally for frameworks and dylibs. If codesign or App Review objects,
    the fix is to move it and teach bundled_runtime_dir() the new location --
    they have to agree, wherever it ends up.
    """
    selected = profile(profile_id)
    if selected["capabilities"]["codeDownload"]:
        return []  # installs its own on first launch, the normal path

    runtime = REPO_ROOT / "runtime"
    binaries = (
        [item for item in sorted(runtime.glob("*")) if item.is_file()] if runtime.is_dir() else []
    )
    if not binaries:
        raise SystemExit(
            f"A '{selected['id']}' build may not download an inference runtime, so one has to ship "
            f"inside it -- but {runtime} is empty. Build llama-server for the target architecture, "
            f"sign it with the same Team ID, and place it (with its ggml/llama libraries) there. "
            f"See distribution/README.md."
        )
    return [(str(item), "runtime") for item in binaries]
