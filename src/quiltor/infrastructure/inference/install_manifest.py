"""Validated, digest-bound artifacts consumed by the local-runtime installer."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import parse_qs, quote, unquote, urlsplit


DigestAlgorithm = Literal["sha256", "git-sha1"]

SHA256_RE = re.compile(r"[0-9a-f]{64}")
GIT_SHA1_RE = re.compile(r"[0-9a-f]{40}")
REPOSITORY_RE = re.compile(
    r"[A-Za-z0-9](?:[A-Za-z0-9._-]{0,95})/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,95})"
)

# Runtime updates are deliberate code changes, not whatever happened to be the
# newest executable when a user clicked the button.  Bump this together with the
# installer tests after checking the upstream release metadata on GitHub.
LLAMA_CPP_RELEASE = "b10218"
LLAMA_CPP_REPOSITORY = "ggml-org/llama.cpp"

MAX_RUNTIME_ARCHIVE_BYTES = 1024 * 1024 * 1024
MAX_MODEL_FILE_BYTES = 16 * 1024 * 1024 * 1024

# Hugging Face rejects a larger page outright -- "Invalid limit for index tree
# pagination", HTTP 400 -- so a repository is read one page at a time and the
# pages are concatenated.  Asking for everything at once used to work and no
# longer does; the page bound below just keeps a broken cursor from looping.
HUGGINGFACE_TREE_PAGE_LIMIT = 100
MAX_HUGGINGFACE_TREE_PAGES = 64

CURSOR_RE = re.compile(r"[A-Za-z0-9+/=_-]{1,4096}")
LINK_NEXT_RE = re.compile(r'<([^>]+)>\s*;\s*[^,]*(?<![A-Za-z])rel\s*=\s*"?next"?', re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class ArtifactManifest:
    """One immutable download decision, including the bytes it is allowed to yield."""

    identifier: str
    version: str
    filename: str
    url: str
    digest_algorithm: DigestAlgorithm
    digest: str
    maximum_bytes: int
    expected_size: int | None = None
    allowed_redirect_origins: tuple[str, ...] = ()
    expected_files: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.identifier or not self.version:
            raise ValueError("Artifact identity and version must not be empty.")
        if self.filename in {"", ".", ".."} or "/" in self.filename or "\\" in self.filename:
            raise ValueError("Artifact filename must be one safe path component.")
        parsed = urlsplit(self.url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Artifact URL must be credential-free HTTPS.")
        expected_pattern = SHA256_RE if self.digest_algorithm == "sha256" else GIT_SHA1_RE
        if expected_pattern.fullmatch(self.digest) is None:
            raise ValueError("Artifact digest is malformed.")
        if self.maximum_bytes <= 0:
            raise ValueError("Artifact size limit must be positive.")
        if self.expected_size is not None and not 0 <= self.expected_size <= self.maximum_bytes:
            raise ValueError("Artifact size is outside the configured limit.")
        for origin in self.allowed_redirect_origins:
            parsed_origin = urlsplit(origin)
            if (
                parsed_origin.scheme != "https"
                or not parsed_origin.hostname
                or parsed_origin.username
                or parsed_origin.password
                or parsed_origin.path not in {"", "/"}
                or parsed_origin.query
                or parsed_origin.fragment
            ):
                raise ValueError("Artifact redirect origins must be credential-free HTTPS origins.")
        if len(set(self.expected_files)) != len(self.expected_files):
            raise ValueError("Artifact expected files must be unique.")
        for expected in self.expected_files:
            if len(safe_relative_path(expected).parts) != 1:
                raise ValueError("Expected artifact files must be safe leaf names.")


def github_release_api_url() -> str:
    return (
        f"https://api.github.com/repos/{LLAMA_CPP_REPOSITORY}/releases/tags/"
        f"{quote(LLAMA_CPP_RELEASE, safe='')}"
    )


def github_runtime_artifact(
    release: dict[str, Any],
    pattern: re.Pattern[str],
    *,
    expected_files: tuple[str, ...] = (),
) -> ArtifactManifest:
    """Select one digest-bearing asset from the pinned llama.cpp release document."""

    if release.get("tag_name") != LLAMA_CPP_RELEASE:
        raise ValueError("llama.cpp release metadata does not match the pinned version.")
    assets = release.get("assets")
    if not isinstance(assets, list):
        raise ValueError("llama.cpp release metadata has no asset list.")
    matches = [
        asset
        for asset in assets
        if isinstance(asset, dict) and pattern.search(str(asset.get("name", "")))
    ]
    if len(matches) != 1:
        raise ValueError("Pinned llama.cpp release must contain exactly one matching asset.")
    asset = matches[0]
    raw_digest = str(asset.get("digest") or "")
    if not raw_digest.startswith("sha256:"):
        raise ValueError("Pinned llama.cpp asset has no published SHA-256 digest.")
    size = asset.get("size")
    if type(size) is not int:
        raise ValueError("Pinned llama.cpp asset has no declared size.")
    filename = str(asset.get("name") or "")
    url = str(asset.get("browser_download_url") or "")
    parsed = urlsplit(url)
    expected_prefix = (
        f"/{LLAMA_CPP_REPOSITORY}/releases/download/{quote(LLAMA_CPP_RELEASE, safe='')}/"
    )
    if (
        parsed.scheme != "https"
        or (parsed.hostname or "").casefold() != "github.com"
        or not parsed.path.startswith(expected_prefix)
        or unquote(parsed.path.rsplit("/", 1)[-1]) != filename
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Pinned llama.cpp asset URL is outside the expected release path.")
    return ArtifactManifest(
        identifier=f"github:{LLAMA_CPP_REPOSITORY}",
        version=LLAMA_CPP_RELEASE,
        filename=filename,
        url=url,
        digest_algorithm="sha256",
        digest=raw_digest.removeprefix("sha256:").lower(),
        maximum_bytes=MAX_RUNTIME_ARCHIVE_BYTES,
        expected_size=size,
        allowed_redirect_origins=(
            "https://release-assets.githubusercontent.com",
            "https://objects.githubusercontent.com",
        ),
        expected_files=expected_files,
    )


def _repository(value: str) -> str:
    if REPOSITORY_RE.fullmatch(value) is None:
        raise ValueError("Model repository must be an owner/name identifier.")
    return value


def _revision(value: str, *, immutable: bool) -> str:
    selected = value.strip()
    if not selected or any(character in selected for character in "?#"):
        raise ValueError("Model revision is invalid.")
    if immutable:
        selected = selected.lower()
    if immutable and GIT_SHA1_RE.fullmatch(selected) is None:
        raise ValueError("Resolved model revision must be an immutable commit SHA.")
    return selected


def huggingface_model_api_url(repository: str, revision: str = "main") -> str:
    selected = _repository(repository)
    requested = _revision(revision, immutable=False)
    return (
        f"https://huggingface.co/api/models/{quote(selected, safe='/')}/revision/"
        f"{quote(requested, safe='')}"
    )


def huggingface_repository_revision(document: Any) -> str:
    if not isinstance(document, dict):
        raise ValueError("Model repository metadata must be an object.")
    return _revision(str(document.get("sha") or ""), immutable=True)


def huggingface_tree_api_url(repository: str, revision: str, *, cursor: str | None = None) -> str:
    selected = _repository(repository)
    commit = _revision(revision, immutable=True)
    url = (
        f"https://huggingface.co/api/models/{quote(selected, safe='/')}/tree/"
        f"{quote(commit, safe='')}?recursive=true&expand=true"
        f"&limit={HUGGINGFACE_TREE_PAGE_LIMIT}"
    )
    if cursor is None:
        return url
    if CURSOR_RE.fullmatch(cursor) is None:
        raise ValueError("Model tree cursor is malformed.")
    return f"{url}&cursor={quote(cursor, safe='')}"


def huggingface_tree_next_cursor(
    link_header: str,
    repository: str,
    revision: str,
) -> str | None:
    """Read the next page's cursor out of the tree endpoint's RFC 8288 Link header.

    Only the cursor travels; the next request is rebuilt from the repository and
    commit we already pinned, so a rewritten "next" link cannot walk the listing
    onto another host or another repository.
    """

    match = LINK_NEXT_RE.search(link_header or "")
    if match is None:
        return None
    parsed = urlsplit(match.group(1).strip())
    expected = urlsplit(huggingface_tree_api_url(repository, revision))
    if (
        parsed.scheme != "https"
        or (parsed.hostname or "").casefold() != expected.hostname
        or parsed.username
        or parsed.password
        or parsed.path != expected.path
    ):
        raise ValueError("Model tree pagination left the pinned repository listing.")
    cursors = parse_qs(parsed.query).get("cursor") or []
    if len(cursors) != 1 or CURSOR_RE.fullmatch(cursors[0]) is None:
        raise ValueError("Model tree pagination carries no usable cursor.")
    return cursors[0]


def huggingface_artifacts(
    repository: str,
    entries: Any,
    *,
    revision: str,
) -> dict[str, ArtifactManifest]:
    """Turn Hugging Face tree metadata into digest-bound file decisions.

    Large LFS/Xet-backed objects publish a SHA-256 content id.  Ordinary Git
    files publish the Git blob id, which is verified with Git's canonical
    ``blob <size>\\0`` prefix after download.
    """

    selected = _repository(repository)
    commit = _revision(revision, immutable=True)
    if not isinstance(entries, list):
        raise ValueError("Model repository metadata must be a list.")
    result: dict[str, ArtifactManifest] = {}
    for entry in entries:
        if not isinstance(entry, dict) or entry.get("type") != "file":
            continue
        path = str(entry.get("path") or "")
        filename = safe_relative_path(path).name
        # ArtifactManifest owns only the leaf name; callers retain the checked
        # repository-relative path as the mapping key and destination.
        lfs = entry.get("lfs")
        raw_sha256 = str(lfs.get("oid") or "") if isinstance(lfs, dict) else ""
        raw_sha256 = raw_sha256.removeprefix("sha256:").lower()
        if SHA256_RE.fullmatch(raw_sha256):
            algorithm: DigestAlgorithm = "sha256"
            digest = raw_sha256
        else:
            raw_oid = str(entry.get("oid") or "").lower()
            if GIT_SHA1_RE.fullmatch(raw_oid) is None:
                raise ValueError(f"Model file {path!r} has no verifiable content digest.")
            algorithm = "git-sha1"
            digest = raw_oid
        size = entry.get("size")
        if type(size) is not int:
            raise ValueError(f"Model file {path!r} has no declared size.")
        result[path] = ArtifactManifest(
            identifier=f"huggingface:{selected}:{path}",
            version=commit,
            filename=filename,
            url=(
                f"https://huggingface.co/{quote(selected, safe='/')}/resolve/"
                f"{quote(commit, safe='')}/{quote(path, safe='/')}"
            ),
            digest_algorithm=algorithm,
            digest=digest,
            maximum_bytes=MAX_MODEL_FILE_BYTES,
            expected_size=size,
            allowed_redirect_origins=(
                "https://cdn-lfs.hf.co",
                "https://cdn-lfs-us-1.hf.co",
                "https://cas-bridge.xethub.hf.co",
                "https://transfer.xethub.hf.co",
            ),
        )
    if not result:
        raise ValueError(f"No verifiable files are published for {selected}.")
    return result


def safe_relative_path(value: str):
    """Return a portable repository-relative path without accepting aliases."""

    from pathlib import PurePosixPath, PureWindowsPath

    if not value or "\\" in value or "\x00" in value:
        raise ValueError("Artifact path is invalid.")
    # pathlib deliberately normalises repeated separators and ``.`` segments;
    # an install manifest must reject those aliases rather than bless a second
    # spelling of the same destination.
    raw_parts = value.split("/")
    if any(part in {"", ".", ".."} for part in raw_parts):
        raise ValueError("Artifact path contains an unsafe component.")
    posix = PurePosixPath(value)
    windows = PureWindowsPath(value)
    if posix.is_absolute() or windows.is_absolute() or windows.drive:
        raise ValueError("Artifact path must be relative.")
    windows_reserved = {
        "CON",
        "PRN",
        "AUX",
        "NUL",
        *(f"COM{index}" for index in range(1, 10)),
        *(f"LPT{index}" for index in range(1, 10)),
    }
    for part in posix.parts:
        if (
            part.endswith((" ", "."))
            or ":" in part
            or any(ord(character) < 32 for character in part)
            or part.split(".", 1)[0].upper() in windows_reserved
        ):
            raise ValueError("Artifact path is not portable across supported platforms.")
    return posix


__all__ = [
    "ArtifactManifest",
    "HUGGINGFACE_TREE_PAGE_LIMIT",
    "LLAMA_CPP_RELEASE",
    "MAX_HUGGINGFACE_TREE_PAGES",
    "github_release_api_url",
    "github_runtime_artifact",
    "huggingface_artifacts",
    "huggingface_model_api_url",
    "huggingface_repository_revision",
    "huggingface_tree_api_url",
    "huggingface_tree_next_cursor",
    "safe_relative_path",
]
