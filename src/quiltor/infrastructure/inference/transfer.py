"""Bounded, digest-verifying downloads for inference installation artifacts."""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urljoin, urlsplit

from quiltor.infrastructure.inference.install_manifest import ArtifactManifest


MAX_METADATA_BYTES = 4 * 1024 * 1024
MAX_REDIRECTS = 3
MEGABYTE = 1024 * 1024

# A bar that only exists while a terminal redraws it tells a `docker logs`
# reader nothing, so a non-interactive console gets whole lines at coarse steps
# instead of one carriage-returned line it will never see finished.
PROGRESS_STEP_PERCENT = 10

# Enough of a rejection body to carry the server's own explanation -- Hugging
# Face and GitHub both say why in one short sentence -- and not enough to turn
# a log line into a page.
MAX_ERROR_DETAIL_BYTES = 512


class TransferError(OSError):
    """A failed request, named by what it asked for rather than by a bare status.

    Kept in the OSError family that urllib raises from, so callers that already
    treat network trouble as recoverable keep doing so.
    """


def _describe(url: str, error: Exception) -> str:
    if not isinstance(error, urllib.error.HTTPError):
        return f"{url} is unreachable: {getattr(error, 'reason', error)}"
    try:
        body = error.read(MAX_ERROR_DETAIL_BYTES).decode("utf-8", "replace")
    except Exception:  # noqa: BLE001 - a failed error body must not mask the failure
        body = ""
    explanation = " ".join(body.split())
    return f"HTTP {error.code} {error.reason} from {url}" + (
        f" -- {explanation}" if explanation else ""
    )


def _human_size(value: int) -> str:
    """Sizes a reader can compare at a glance -- "2.3 GB", not "2381 MB"."""

    if value >= 1024 * MEGABYTE:
        return f"{value / (1024 * MEGABYTE):.1f} GB"
    if value >= MEGABYTE:
        return f"{value / MEGABYTE:.0f} MB"
    return f"{value / 1024:.0f} KB"


def _interactive_console() -> bool:
    try:
        return bool(sys.stdout.isatty())
    except (AttributeError, ValueError):
        return False


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


def _open(opener: urllib.request.OpenerDirector, request: urllib.request.Request, url: str):
    try:
        return opener.open(request, timeout=30)
    except urllib.error.URLError as error:  # HTTPError included -- it subclasses this
        raise TransferError(_describe(url, error)) from error


def _open_metadata(request: urllib.request.Request):
    return _open(_https_opener(_NoRedirect()), request, request.full_url)


def _open_artifact(request: urllib.request.Request, artifact: ArtifactManifest):
    # Reported against the artifact URL, not the request's: a rejected download
    # has usually been redirected to a signed CDN URL by then, and that
    # signature has no business in a log line.
    return _open(_https_opener(_ArtifactRedirect(artifact)), request, artifact.url)


def read_json(url: str, *, maximum_bytes: int = MAX_METADATA_BYTES) -> Any:
    return read_json_page(url, maximum_bytes=maximum_bytes)[0]


def read_json_page(url: str, *, maximum_bytes: int = MAX_METADATA_BYTES) -> tuple[Any, str]:
    """The metadata document plus its ``Link`` header, for cursor-paginated APIs."""

    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Metadata URL must be credential-free HTTPS.")
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with _open_metadata(request) as response:
        declared = int(response.headers.get("Content-Length") or 0)
        if declared < 0 or declared > maximum_bytes:
            raise ValueError("Installation metadata exceeds its size limit.")
        link = str(response.headers.get("Link") or "")
        payload = response.read(maximum_bytes + 1)
    if len(payload) > maximum_bytes:
        raise ValueError("Installation metadata exceeds its size limit.")
    document = json.loads(payload.decode("utf-8"))
    if not isinstance(document, (dict, list)):
        raise ValueError("Installation metadata must be a JSON object or list.")
    return document, link


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

    dest.parent.mkdir(parents=True, exist_ok=True)
    partial = dest.with_name(dest.name + ".part")
    resume_from = partial.stat().st_size if partial.exists() else 0
    if resume_from > artifact.maximum_bytes:
        partial.unlink(missing_ok=True)
        raise ValueError("Partial artifact exceeds its size limit.")

    # Where the bytes come from and how many of them there are, before the first
    # one arrives: a download that never starts should still say what it wanted.
    announced = f"Downloading {label}"
    if artifact.expected_size:
        announced += f" ({_human_size(artifact.expected_size)})"
    announced += f" from {urlsplit(artifact.url).hostname}"
    if resume_from:
        announced += f", resuming at {_human_size(resume_from)}"
    print(f"{announced} ...", flush=True)
    interactive = _interactive_console()
    next_report = 0

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
                        measured = f"{_human_size(done)} / {_human_size(total)}"
                        if interactive:
                            print(f"\r  {percent:3d}% ({measured})", end="", flush=True)
                        elif percent >= next_report:
                            next_report = (
                                percent - percent % PROGRESS_STEP_PERCENT + PROGRESS_STEP_PERCENT
                            )
                            print(f"  {label} {percent:3d}% ({measured})", flush=True)
                        if on_progress:
                            on_progress(label, percent)
    except Exception:
        # A network interruption keeps a bounded partial file for Range resume;
        # a rejected length never leaves oversized bytes behind.
        if partial.exists() and partial.stat().st_size > artifact.maximum_bytes:
            partial.unlink(missing_ok=True)
        raise
    if interactive:
        print()

    size = partial.stat().st_size
    if artifact.expected_size is not None and size != artifact.expected_size:
        partial.unlink(missing_ok=True)
        raise ValueError("Downloaded artifact does not match its declared size.")
    # Hashing multiple gigabytes takes long enough to look like a hung process
    # if the log falls silent between the last percentage and "Installed".
    print(f"  {label}: verifying {_human_size(size)} ...", flush=True)
    actual = _digest(partial, artifact.digest_algorithm)
    if not hmac.compare_digest(actual, artifact.digest):
        partial.unlink(missing_ok=True)
        raise ValueError("Downloaded artifact failed integrity verification.")
    partial.replace(dest)


__all__ = ["MAX_METADATA_BYTES", "TransferError", "download", "read_json", "read_json_page"]
