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

# The SHA-256 of every asset the installer may pick, recorded from the release
# metadata when LLAMA_CPP_RELEASE was bumped. The digest the API publishes at install
# time is only compared against this table, never trusted on its own: whoever can
# replace an asset can also replace the digest next to it.
LLAMA_CPP_ASSET_SHA256: dict[str, str] = {
    "llama-b10218-bin-win-cpu-x64.zip": "678d67405b12abd8ea3541ec6f501c10c9c15ba3cd0767bf090f79eb51168a17",
    "llama-b10218-bin-win-cpu-arm64.zip": "8407f05d4cc6e614eb8391de4c39af549428a6341603f1023355f5bd326611ba",
    "llama-b10218-bin-macos-arm64.tar.gz": "f3e87f1664c09183a861f16758c55a5adc925672705cd3a47e3dc4444504c914",
    "llama-b10218-bin-macos-x64.tar.gz": "3cfdcb4c0a2071b470577cf26e182baf9a51edff09a8c89d9252d2d5c7d4b849",
    "llama-b10218-bin-ubuntu-x64.tar.gz": "78ec7a1964710918030e85c132a0995b10b07e4f43001bdf54fe0fd48d1eb85b",
    "llama-b10218-bin-ubuntu-arm64.tar.gz": "9692bd7147325654b69c62fb7780118c0a2579945a014dda53ca909b3bc7829e",
}


@dataclass(frozen=True)
class PinnedModel:
    """A model repository the installer offers by default, fixed in the repository.

    ``revision`` is the commit every file URL is built from; ``files`` maps each
    repository-relative path the installer may fetch to its digest
    (``sha256:<hex>`` for LFS/Xet objects, ``git-sha1:<hex>`` for Git blobs).
    """

    revision: str
    files: dict[str, str]


PINNED_MODELS: dict[str, PinnedModel] = {
    "Qwen/Qwen3-4B-GGUF": PinnedModel(
        revision="bc640142c66e1fdd12af0bd68f40445458f3869b",
        files={
            "Qwen3-4B-Q4_K_M.gguf": "sha256:7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5",
        },
    ),
    "mlx-community/Qwen3-4B-4bit": PinnedModel(
        revision="4dcb3d101c2a062e5c1d4bb173588c54ea6c4d25",
        files={
            ".gitattributes": "git-sha1:52373fe24473b1aa44333d318f578ae6bf04b49b",
            "README.md": "git-sha1:56a0296b7d72cd9b0438f99913ca38b200a22ce3",
            "added_tokens.json": "git-sha1:b54f9135e44c1e81047e8d05cb027af8bc039eed",
            "config.json": "git-sha1:032ad326a0daaaeeec00f2a585262acf5f692861",
            "merges.txt": "git-sha1:31349551d90c7606f325fe0f11bbb8bd5fa0d7c7",
            "model.safetensors": "sha256:e240c0bdc0ebb0681bf0da0f98d9719fd6ebe269a3633f81542c13e81345651d",
            "model.safetensors.index.json": "git-sha1:07e230a328dd17a09d96ee045d49b27596656aff",
            "special_tokens_map.json": "git-sha1:ac23c0aaa2434523c494330aeb79c58395378103",
            "tokenizer.json": "sha256:aeb13307a71acd8fe81861d94ad54ab689df773318809eed3cbe794b4492dae4",
            "tokenizer_config.json": "git-sha1:7345216a0785dc7086e8c245b2a9d3896ce2b756",
            "vocab.json": "git-sha1:4783fe10ac3adce15ac8f358ef5462739852c569",
        },
    ),
}


def pinned_model_artifacts(
    repository: str, artifacts: dict[str, ArtifactManifest]
) -> dict[str, ArtifactManifest]:
    """Keep only the pinned files of a pinned repository, each with its pinned digest."""

    pin = PINNED_MODELS[repository]
    result: dict[str, ArtifactManifest] = {}
    for path, expected in pin.files.items():
        artifact = artifacts.get(path)
        if artifact is None:
            raise ValueError(f"Pinned model file {path!r} is missing from {repository}.")
        if f"{artifact.digest_algorithm}:{artifact.digest}" != expected:
            raise ValueError(f"Model file {path!r} does not match its pinned digest.")
        result[path] = artifact
    return result


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
    pinned_digest = LLAMA_CPP_ASSET_SHA256.get(filename)
    if pinned_digest is None:
        raise ValueError(f"llama.cpp asset {filename!r} has no digest pinned in the repository.")
    if raw_digest.removeprefix("sha256:").lower() != pinned_digest:
        raise ValueError("llama.cpp release metadata does not match the pinned asset digest.")
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
        digest=pinned_digest,
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
                "https://us.aws.cdn.hf.co",
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
    "HUGGINGFACE_TREE_PAGE_LIMIT",
    "LLAMA_CPP_ASSET_SHA256",
    "LLAMA_CPP_RELEASE",
    "MAX_HUGGINGFACE_TREE_PAGES",
    "PINNED_MODELS",
    "ArtifactManifest",
    "PinnedModel",
    "github_release_api_url",
    "github_runtime_artifact",
    "huggingface_artifacts",
    "huggingface_model_api_url",
    "huggingface_repository_revision",
    "huggingface_tree_api_url",
    "huggingface_tree_next_cursor",
    "pinned_model_artifacts",
    "safe_relative_path",
]
