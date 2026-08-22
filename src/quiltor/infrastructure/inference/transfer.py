"""Bounded, digest-verifying downloads for inference installation artifacts."""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import ssl
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urljoin, urlsplit

from quiltor.infrastructure.inference.install_manifest import ArtifactManifest


MAX_METADATA_BYTES = 4 * 1024 * 1024
MAX_REDIRECTS = 3


def _origin(value: str) -> tuple[str, str, int]:
    parsed = urlsplit(value)
    return (
        parsed.scheme.casefold(),
        (parsed.hostname or "").rstrip(".").casefold(),
        parsed.port or (443 if parsed.scheme.casefold() == "https" else 80),
    )


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None


class _ArtifactRedirect(urllib.request.HTTPRedirectHandler):
    def __init__(self, artifact: ArtifactManifest) -> None:
        super().__init__()
        self._allowed = {
            _origin(artifact.url),
            *(_origin(origin) for origin in artifact.allowed_redirect_origins),
        }
        self._hops = 0

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        self._hops += 1
        destination = urljoin(req.full_url, newurl)
        parsed = urlsplit(destination)
        if (
            self._hops > MAX_REDIRECTS
            or parsed.scheme != "https"
            or parsed.username
            or parsed.password
            or _origin(destination) not in self._allowed
        ):
            raise ValueError("Artifact redirect left its trusted HTTPS origins.")
        return super().redirect_request(req, fp, code, msg, headers, destination)


def _https_opener(*handlers) -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(
        *handlers,
        urllib.request.HTTPSHandler(context=ssl.create_default_context()),
    )


def _open_metadata(request: urllib.request.Request):
    return _https_opener(_NoRedirect()).open(request, timeout=30)


def _open_artifact(request: urllib.request.Request, artifact: ArtifactManifest):
    return _https_opener(_ArtifactRedirect(artifact)).open(request, timeout=30)


def read_json(url: str, *, maximum_bytes: int = MAX_METADATA_BYTES) -> Any:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Metadata URL must be credential-free HTTPS.")
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with _open_metadata(request) as response:
        declared = int(response.headers.get("Content-Length") or 0)
        if declared < 0 or declared > maximum_bytes:
            raise ValueError("Installation metadata exceeds its size limit.")
        payload = response.read(maximum_bytes + 1)
    if len(payload) > maximum_bytes:
        raise ValueError("Installation metadata exceeds its size limit.")
    document = json.loads(payload.decode("utf-8"))
    if not isinstance(document, (dict, list)):
        raise ValueError("Installation metadata must be a JSON object or list.")
    return document


def _digest(path: Path, algorithm: str) -> str:
    if algorithm == "sha256":
        checksum = hashlib.sha256()
    elif algorithm == "git-sha1":
        checksum = hashlib.sha1()  # noqa: S324 - verifies the upstream Git object id
        checksum.update(f"blob {path.stat().st_size}\0".encode("ascii"))
    else:  # pragma: no cover - ArtifactManifest validates this before download
        raise ValueError("Unsupported artifact digest algorithm.")
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            checksum.update(chunk)
    return checksum.hexdigest()


def download(
    artifact: ArtifactManifest,
    dest: Path,
    label: str,
    on_progress: Callable[[str, int], None] | None = None,
) -> None:
    """Resume into a staging file, then publish only verified bytes atomically."""

    print(f"Downloading {label} ...")
    dest.parent.mkdir(parents=True, exist_ok=True)
    partial = dest.with_name(dest.name + ".part")
    resume_from = partial.stat().st_size if partial.exists() else 0
    if resume_from > artifact.maximum_bytes:
        partial.unlink(missing_ok=True)
        raise ValueError("Partial artifact exceeds its size limit.")

    request = urllib.request.Request(artifact.url)
    if resume_from:
        request.add_header("Range", f"bytes={resume_from}-")
    try:
        with _open_artifact(request, artifact) as response:
            if response.status not in {200, 206}:
                raise ValueError("Artifact server returned an unsupported status.")
            resumed = bool(resume_from) and response.status == 206
            if resume_from and not resumed:
                resume_from = 0
            remaining = int(response.headers.get("Content-Length") or 0)
            if remaining < 0:
                raise ValueError("Artifact server returned an invalid size.")
            if resumed:
                content_range = response.headers.get("Content-Range") or ""
                match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+|\*)", content_range)
                range_start = int(match.group(1)) if match else -1
                range_end = int(match.group(2)) if match else -1
                range_total = match.group(3) if match else ""
                if (
                    match is None
                    or range_start != resume_from
                    or range_end < range_start
                    or (remaining and range_end - range_start + 1 != remaining)
                    or (
                        range_total != "*"
                        and (
                            int(range_total) <= range_end
                            or (
                                artifact.expected_size is not None
                                and int(range_total) != artifact.expected_size
                            )
                        )
                    )
                ):
                    raise ValueError("Artifact server returned an invalid resume range.")
            total = resume_from + remaining if remaining else 0
            if total and total > artifact.maximum_bytes:
                raise ValueError("Artifact exceeds its size limit.")
            done = resume_from
            with partial.open("ab" if resumed else "wb") as handle:
                while True:
                    chunk = response.read(1 << 20)
                    if not chunk:
                        break
                    done += len(chunk)
                    if done > artifact.maximum_bytes:
                        raise ValueError("Artifact exceeds its size limit.")
                    handle.write(chunk)
                    if total:
                        percent = min(100, done * 100 // total)
                        print(
                            f"\r  {percent:3d}% ({done // (1024 * 1024)} MB / "
                            f"{total // (1024 * 1024)} MB)",
                            end="",
                            flush=True,
                        )
                        if on_progress:
                            on_progress(label, percent)
    except Exception:
        # A network interruption keeps a bounded partial file for Range resume;
        # a rejected length never leaves oversized bytes behind.
        if partial.exists() and partial.stat().st_size > artifact.maximum_bytes:
            partial.unlink(missing_ok=True)
        raise
    print()

    size = partial.stat().st_size
    if artifact.expected_size is not None and size != artifact.expected_size:
        partial.unlink(missing_ok=True)
        raise ValueError("Downloaded artifact does not match its declared size.")
    actual = _digest(partial, artifact.digest_algorithm)
    if not hmac.compare_digest(actual, artifact.digest):
        partial.unlink(missing_ok=True)
        raise ValueError("Downloaded artifact failed integrity verification.")
    partial.replace(dest)


__all__ = ["MAX_METADATA_BYTES", "download", "read_json"]
