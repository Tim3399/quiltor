#!/usr/bin/env python3
"""Securely download the latest earlier stable desktop release artifact.

The caller still verifies the platform signature before executing the artifact.
Exit status 3 is reserved for the explicit first-release/bootstrap case.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

BOOTSTRAP_EXIT = 3
_VERSION = re.compile(r"^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")
_REPOSITORY = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")


class PreviousReleaseError(RuntimeError):
    """The release history could not be trusted or downloaded."""


@dataclass(frozen=True)
class SelectedRelease:
    """The one immediate stable predecessor and its canonical platform asset."""

    tag: str
    version: str
    asset: dict[str, Any]


def semantic_version(value: str) -> tuple[int, int, int]:
    match = _VERSION.fullmatch(value.strip())
    if match is None:
        raise PreviousReleaseError(f"invalid semantic version: {value!r}")
    return tuple(int(part) for part in match.groups())  # type: ignore[return-value]


def canonical_name(kind: str, version: tuple[int, int, int]) -> str:
    text = ".".join(str(part) for part in version)
    if kind == "macos-dmg":
        return f"Quiltor-{text}.dmg"
    if kind == "windows-installer":
        return f"Quiltor-Setup-{text}.exe"
    raise PreviousReleaseError(f"unknown artifact kind: {kind}")


def stable_history_versions(
    releases: list[dict[str, Any]], tags: list[str] | None = None
) -> set[tuple[int, int, int]]:
    """Return semantic versions belonging to published stable releases or tags."""

    versions: set[tuple[int, int, int]] = set()
    for release in releases:
        if release.get("draft") is True or release.get("prerelease") is True:
            continue
        tag = release.get("tag_name")
        if not isinstance(tag, str):
            continue
        try:
            versions.add(semantic_version(tag))
        except PreviousReleaseError:
            continue
    for tag in tags or []:
        try:
            versions.add(semantic_version(tag))
        except PreviousReleaseError:
            continue
    return versions


def require_monotonic_version(
    current_version: str,
    releases: list[dict[str, Any]],
    tags: list[str] | None = None,
) -> tuple[int, int, int] | None:
    """Require current to be newer than every stable release and semantic tag."""

    current = semantic_version(current_version)
    history = stable_history_versions(releases, tags)
    if not history:
        return None
    highest = max(history)
    if current <= highest:
        highest_text = ".".join(str(part) for part in highest)
        raise PreviousReleaseError(
            f"current version {current_version} must be newer than stable history {highest_text}"
        )
    return highest


def require_not_older_version(
    current_version: str,
    releases: list[dict[str, Any]],
    tags: list[str] | None = None,
) -> tuple[int, int, int] | None:
    """Require current to remain at least as new as stable history.

    This second publication-boundary check permits the current draft/tag created
    by the same release run, but prevents a concurrently published newer version
    from being displaced as ``latest``.
    """

    current = semantic_version(current_version)
    history = stable_history_versions(releases, tags)
    if not history:
        return None
    highest = max(history)
    if current < highest:
        highest_text = ".".join(str(part) for part in highest)
        raise PreviousReleaseError(
            f"current version {current_version} is older than stable history {highest_text}"
        )
    return highest


def select_previous(
    releases: list[dict[str, Any]],
    current_version: str,
    kind: str,
    tags: list[str] | None = None,
) -> SelectedRelease | None:
    """Select the immediate stable predecessor or prove this is a bootstrap."""

    highest = require_monotonic_version(current_version, releases, tags)
    if highest is None:
        return None

    predecessors: list[tuple[str, dict[str, Any]]] = []
    for release in releases:
        if release.get("draft") is True or release.get("prerelease") is True:
            continue
        tag = release.get("tag_name")
        if not isinstance(tag, str):
            continue
        try:
            version = semantic_version(tag)
        except PreviousReleaseError:
            continue
        if version == highest:
            predecessors.append((tag, release))
    highest_text = ".".join(str(part) for part in highest)
    if len(predecessors) != 1:
        raise PreviousReleaseError(
            f"stable predecessor {highest_text} must have exactly one published release"
        )

    tag, release = predecessors[0]
    expected = canonical_name(kind, highest)
    assets = release.get("assets")
    matches = (
        [
            asset
            for asset in assets
            if isinstance(asset, dict)
            and asset.get("name") == expected
            and isinstance(asset.get("url"), str)
        ]
        if isinstance(assets, list)
        else []
    )
    if len(matches) != 1:
        raise PreviousReleaseError(
            f"immediate stable predecessor {tag} must contain exactly one {expected} asset"
        )
    return SelectedRelease(
        tag=tag,
        version=highest_text,
        asset=matches[0],
    )


def _request(url: str, token: str, accept: str) -> urllib.request.Request:
    return urllib.request.Request(
        url,
        headers={
            "Accept": accept,
            "Authorization": f"Bearer {token}",
            "User-Agent": "quiltor-native-release-smoke",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )


def fetch_releases(repository: str, token: str) -> list[dict[str, Any]]:
    if _REPOSITORY.fullmatch(repository) is None:
        raise PreviousReleaseError("repository must be an owner/name GitHub repository")
    releases: list[dict[str, Any]] = []
    for page in range(1, 21):
        url = f"https://api.github.com/repos/{repository}/releases?per_page=100&page={page}"
        try:
            with urllib.request.urlopen(
                _request(url, token, "application/vnd.github+json"), timeout=30
            ) as response:
                payload = json.load(response)
        except (OSError, urllib.error.HTTPError, json.JSONDecodeError) as error:
            raise PreviousReleaseError(f"cannot read GitHub release history: {error}") from error
        if not isinstance(payload, list) or any(not isinstance(item, dict) for item in payload):
            raise PreviousReleaseError("GitHub release history returned an invalid document")
        releases.extend(payload)
        if len(payload) < 100:
            return releases
    raise PreviousReleaseError("GitHub release history exceeded the bounded 2000-release scan")


def fetch_tags(repository: str, token: str) -> list[str]:
    if _REPOSITORY.fullmatch(repository) is None:
        raise PreviousReleaseError("repository must be an owner/name GitHub repository")
    tags: list[str] = []
    for page in range(1, 21):
        url = f"https://api.github.com/repos/{repository}/tags?per_page=100&page={page}"
        try:
            with urllib.request.urlopen(
                _request(url, token, "application/vnd.github+json"), timeout=30
            ) as response:
                payload = json.load(response)
        except (OSError, urllib.error.HTTPError, json.JSONDecodeError) as error:
            raise PreviousReleaseError(f"cannot read GitHub tag history: {error}") from error
        if not isinstance(payload, list) or any(
            not isinstance(item, dict) or not isinstance(item.get("name"), str) for item in payload
        ):
            raise PreviousReleaseError("GitHub tag history returned an invalid document")
        tags.extend(item["name"] for item in payload)
        if len(payload) < 100:
            return tags
    raise PreviousReleaseError("GitHub tag history exceeded the bounded 2000-tag scan")


def download_asset(repository: str, asset: dict[str, Any], token: str, output: Path) -> None:
    url = asset.get("url")
    expected_prefix = f"https://api.github.com/repos/{repository}/releases/assets/"
    if not isinstance(url, str) or not url.startswith(expected_prefix):
        raise PreviousReleaseError("selected asset URL is not a GitHub asset in this repository")
    output.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(prefix=f".{output.name}.", dir=output.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(handle, "wb") as destination:
            request = _request(url, token, "application/octet-stream")
            opener = urllib.request.build_opener(_NoRedirectHandler())
            try:
                response = opener.open(request, timeout=120)
            except urllib.error.HTTPError as redirect:
                if redirect.code not in {301, 302, 303, 307, 308}:
                    raise
                location = redirect.headers.get("Location", "")
                redirect.close()
                parsed = urllib.parse.urlsplit(location)
                if (
                    parsed.scheme != "https"
                    or parsed.hostname is None
                    or not parsed.hostname.endswith(".githubusercontent.com")
                ):
                    raise PreviousReleaseError("GitHub asset redirect left its trusted host")
                # Never forward the repository token to the signed object URL.
                response = urllib.request.urlopen(
                    urllib.request.Request(
                        location, headers={"User-Agent": "quiltor-native-release-smoke"}
                    ),
                    timeout=120,
                )
            with response:
                content_type = response.headers.get_content_type()
                if content_type in {"application/json", "text/json"}:
                    raise PreviousReleaseError("GitHub returned metadata instead of artifact bytes")
                while chunk := response.read(1024 * 1024):
                    destination.write(chunk)
            destination.flush()
            os.fsync(destination.fileno())
        if temporary.stat().st_size == 0:
            raise PreviousReleaseError("downloaded release artifact is empty")
        os.replace(temporary, output)
    except Exception as error:
        temporary.unlink(missing_ok=True)
        if isinstance(error, PreviousReleaseError):
            raise
        raise PreviousReleaseError(f"cannot download previous release artifact: {error}") from error


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None


def write_metadata(selected: SelectedRelease, kind: str, output: Path) -> None:
    """Atomically expose the selected tag/version contract to platform scripts."""

    document = {
        "schemaVersion": 1,
        "tag": selected.tag,
        "version": selected.version,
        "kind": kind,
        "asset": selected.asset["name"],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(prefix=f".{output.name}.", dir=output.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(document, stream, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, output)
    except Exception as error:
        temporary.unlink(missing_ok=True)
        raise PreviousReleaseError(f"cannot write predecessor metadata: {error}") from error


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    check = parser.add_mutually_exclusive_group()
    check.add_argument("--check-monotonic", action="store_true")
    check.add_argument("--check-not-older", action="store_true")
    parser.add_argument("--kind", choices=("macos-dmg", "windows-installer"))
    parser.add_argument("--current-version", required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--metadata-output", type=Path)
    parser.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY", ""))
    args = parser.parse_args(argv)
    token = os.environ.get("GH_TOKEN", "")
    if not token:
        parser.error("GH_TOKEN is required to authenticate the release lookup")
    try:
        releases = fetch_releases(args.repository, token)
        tags = fetch_tags(args.repository, token)
        if args.check_monotonic or args.check_not_older:
            if args.kind is not None or args.output is not None or args.metadata_output is not None:
                parser.error("version checks cannot be combined with artifact options")
            highest = (
                require_monotonic_version(args.current_version, releases, tags)
                if args.check_monotonic
                else require_not_older_version(args.current_version, releases, tags)
            )
            history = "none" if highest is None else ".".join(str(part) for part in highest)
            print(f"HIGHEST_STABLE_VERSION={history}")
            return 0
        if args.kind is None or args.output is None or args.metadata_output is None:
            parser.error("artifact lookup requires --kind, --output and --metadata-output")
        selected = select_previous(releases, args.current_version, args.kind, tags)
        if selected is None:
            print(
                "BOOTSTRAP: no earlier stable release exists",
                file=sys.stderr,
            )
            return BOOTSTRAP_EXIT
        if args.output.resolve() == args.metadata_output.resolve():
            raise PreviousReleaseError("artifact and metadata outputs must be different paths")
        download_asset(args.repository, selected.asset, token, args.output)
        write_metadata(selected, args.kind, args.metadata_output)
        print(f"PREVIOUS_RELEASE_VERSION={selected.version}")
        return 0
    except PreviousReleaseError as error:
        print(f"previous release lookup failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
