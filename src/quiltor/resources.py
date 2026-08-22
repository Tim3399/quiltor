"""Locations of versioned application resources in source and built artifacts."""

from __future__ import annotations

from pathlib import Path

SIDECAR_ASSETS = frozenset(
    {
        "pdf/render-book-pdf.mjs",
        "inference/mlx/bridge.py",
        "inference/mlx/requirements.lock",
    }
)

PACKAGE_ROOT = Path(__file__).resolve().parent
_SOURCE_ROOT = PACKAGE_ROOT.parents[1]


def source_root() -> Path:
    """Repository root in a checkout, package root in an installed artifact."""

    return _SOURCE_ROOT if (_SOURCE_ROOT / "VERSION").is_file() else PACKAGE_ROOT


def web_assets() -> Path:
    bundled = PACKAGE_ROOT / "resources" / "web"
    return bundled if bundled.is_dir() else source_root() / "dist"


def sidecars() -> Path:
    """Directory containing reviewed subprocess assets shipped with Quiltor."""

    return PACKAGE_ROOT / "resources" / "sidecars"


def sidecar_asset(relative_path: str) -> Path:
    """Resolve one explicitly shipped sidecar, never an arbitrary repository file."""

    if relative_path not in SIDECAR_ASSETS:
        raise ValueError(f"Unsupported sidecar asset: {relative_path}")
    path = sidecars().joinpath(*relative_path.split("/"))
    if not path.is_file():
        raise RuntimeError(f"The packaged sidecar asset is missing: {relative_path}")
    return path


def version_file() -> Path:
    bundled = PACKAGE_ROOT / "VERSION"
    return bundled if bundled.is_file() else source_root() / "VERSION"


def legal_document(filename: str) -> Path:
    """Resolve one required legal document without permitting arbitrary paths."""

    if filename not in {"LICENSE", "THIRD-PARTY-NOTICES.md"}:
        raise ValueError(f"Unsupported legal document: {filename}")
    bundled = PACKAGE_ROOT / "resources" / "legal" / filename
    path = bundled if bundled.is_file() else source_root() / filename
    if not path.is_file():
        raise RuntimeError(f"The packaged {filename} document is missing.")
    return path


def license_file() -> Path:
    return legal_document("LICENSE")


def third_party_notices() -> Path:
    return legal_document("THIRD-PARTY-NOTICES.md")


def icons() -> Path:
    bundled = PACKAGE_ROOT / "resources" / "icons"
    return bundled if bundled.is_dir() else source_root() / "distribution" / "assets" / "icons"


def mcp_tools_contract() -> Path:
    """Required MCP catalogue in both source and installed artifacts."""

    bundled = PACKAGE_ROOT / "resources" / "contracts" / "mcp" / "tools.v1.json"
    path = (
        bundled
        if bundled.is_file()
        else source_root() / "contracts" / "fixtures" / "mcp" / "tools.v1.json"
    )
    if not path.is_file():
        raise RuntimeError("The packaged MCP tool contract is missing.")
    return path


__all__ = [
    "PACKAGE_ROOT",
    "SIDECAR_ASSETS",
    "icons",
    "legal_document",
    "license_file",
    "mcp_tools_contract",
    "sidecar_asset",
    "sidecars",
    "source_root",
    "third_party_notices",
    "version_file",
    "web_assets",
]
